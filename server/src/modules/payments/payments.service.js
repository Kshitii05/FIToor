import crypto from 'node:crypto';
import { DISPATCH_DEADLINE_BUSINESS_DAYS, HANDOVER_CODE_LENGTH } from '../../config/policy.js';
import { addBusinessDays } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { recordLedger } from '../../lib/ledger.js';
import { commissionOn } from '../../lib/money.js';
import { reserveStock } from '../checkout/checkout.service.js';
import { notify } from '../orders/order.emails.js';
import { confirmBookingPayment } from '../rentals/rental.payments.js';
import {
  createRefund,
  markRefundFailed,
  markRefundProcessed,
  processRefund,
} from './refunds.service.js';

// Confirming payments. Both the gateway's webhook and the buyer's browser report a
// payment; both lead to confirmPayment, which is idempotent: whichever arrives
// first creates the orders and ledger rows, and every later report changes nothing.

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function orderRef() {
  let ref = 'ORD-';
  for (let i = 0; i < 8; i += 1) ref += REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)];
  return ref;
}

const handoverCode = () =>
  String(crypto.randomInt(0, 10 ** HANDOVER_CODE_LENGTH)).padStart(HANDOVER_CODE_LENGTH, '0');

/** Creates one order per seller group of a paid checkout, with ledger rows. In `tx`. */
async function createOrders(tx, now, checkout, payment) {
  const groups = await tx.checkoutGroup.findMany({
    where: { checkoutId: checkout.id },
    include: { items: { include: { listing: true } } },
  });
  const created = [];
  for (const group of groups) {
    const commissionPaise = commissionOn(group.itemsSubtotalPaise);
    const totalPaise = group.itemsSubtotalPaise + group.deliveryChargePaise;
    const pickup = group.fulfilment === 'PICKUP';
    const order = await tx.order.create({
      data: {
        ref: orderRef(),
        checkoutId: checkout.id,
        buyerId: checkout.buyerId,
        sellerId: group.sellerId,
        status: pickup ? 'AWAITING_PICKUP' : 'AWAITING_DISPATCH',
        fulfilment: group.fulfilment,
        itemsSubtotalPaise: group.itemsSubtotalPaise,
        deliveryChargePaise: group.deliveryChargePaise,
        totalPaise,
        commissionPaise,
        // The seller arranges delivery, so the delivery charge is theirs (SPEC 6).
        sellerPayablePaise: totalPaise - commissionPaise,
        deliveryAddress: group.deliveryAddress ?? undefined,
        handoverCode: pickup ? handoverCode() : null,
        dispatchDueAt: pickup ? null : addBusinessDays(now, DISPATCH_DEADLINE_BUSINESS_DAYS),
        createdAt: now,
        items: {
          create: group.items.map((item) => ({
            listingId: item.listingId,
            title: item.title,
            unitPricePaise: item.unitPricePaise,
            quantity: item.quantity,
            // Pickup: the exact spot, shared with the buyer now that they have paid.
            pickupLat: pickup ? item.listing.pinLat : null,
            pickupLng: pickup ? item.listing.pinLng : null,
            pickupLocality: pickup ? item.listing.locality : null,
          })),
        },
        events: {
          create: {
            actorRole: 'SYSTEM',
            action: 'PAID',
            toStatus: pickup ? 'AWAITING_PICKUP' : 'AWAITING_DISPATCH',
            createdAt: now,
          },
        },
      },
    });
    await recordLedger(tx, now, [
      {
        key: `order:${order.id}:commission`,
        type: 'COMMISSION',
        amountPaise: commissionPaise,
        checkoutId: checkout.id,
        orderId: order.id,
        paymentId: payment.id,
        sellerId: order.sellerId,
      },
      {
        key: `order:${order.id}:seller-payable`,
        type: 'SELLER_PAYABLE',
        amountPaise: order.sellerPayablePaise,
        checkoutId: checkout.id,
        orderId: order.id,
        paymentId: payment.id,
        sellerId: order.sellerId,
      },
    ]);
    created.push(order);
  }

  // What was bought leaves the buyer's cart.
  await tx.cartItem.deleteMany({
    where: {
      userId: checkout.buyerId,
      listingId: { in: groups.flatMap((g) => g.items.map((i) => i.listingId)) },
    },
  });
  return created;
}

/**
 * Applies a payment the gateway reported. `entity` is the gateway's payment object
 * (amount in paise). Returns `{ checkoutId, orders, refundIds }`.
 */
export async function confirmPayment(deps, entity) {
  const { db, clock } = deps;
  const now = clock.now();

  // A rental booking's payment has its own rules (rental.payments.js).
  const booking = await db.rentalBooking.findUnique({
    where: { gatewayOrderId: entity.order_id },
    select: { id: true },
  });
  if (booking) return confirmBookingPayment(deps, entity);

  const outcome = await db.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw`
      SELECT id FROM checkouts WHERE gateway_order_id = ${entity.order_id} FOR UPDATE`;
    if (!locked) throw AppError.notFound('No checkout for this payment');
    const checkout = await tx.checkout.findUniqueOrThrow({ where: { id: locked.id } });

    const known = await tx.payment.findUnique({ where: { gatewayPaymentId: entity.id } });
    if (known && (known.status === 'CAPTURED' || entity.status !== 'captured')) {
      return { checkout, orders: [], refundIds: [] };
    }

    if (entity.status !== 'captured') {
      await tx.payment.create({
        data: {
          checkoutId: checkout.id,
          gatewayOrderId: entity.order_id,
          gatewayPaymentId: entity.id,
          amountPaise: entity.amount,
          status: 'FAILED',
          method: entity.method ?? null,
          createdAt: now,
        },
      });
      return { checkout, orders: [], refundIds: [] };
    }

    const paymentData = {
      status: 'CAPTURED',
      amountPaise: entity.amount,
      method: entity.method ?? null,
      feePaise: entity.fee ?? null,
      capturedAt: now,
    };
    const payment = known
      ? await tx.payment.update({ where: { id: known.id }, data: paymentData })
      : await tx.payment.create({
          data: {
            ...paymentData,
            checkoutId: checkout.id,
            gatewayOrderId: entity.order_id,
            gatewayPaymentId: entity.id,
            createdAt: now,
          },
        });

    await recordLedger(tx, now, [
      {
        key: `payment:${payment.id}:received`,
        type: 'BUYER_PAYMENT',
        amountPaise: payment.amountPaise,
        checkoutId: checkout.id,
        paymentId: payment.id,
      },
      // Gateway charges are the platform's cost (SPEC 6), never the seller's.
      {
        key: `payment:${payment.id}:gateway-fee`,
        type: 'GATEWAY_FEE',
        amountPaise: payment.feePaise ?? 0,
        checkoutId: checkout.id,
        paymentId: payment.id,
      },
    ]);

    const refundAll = async (reason) => {
      const refund = await createRefund(tx, now, {
        key: `payment:${payment.id}:${reason.toLowerCase()}`,
        checkoutId: checkout.id,
        paymentId: payment.id,
        amountPaise: payment.amountPaise,
        itemsAmountPaise: 0,
        reason,
      });
      return { checkout, orders: [], refundIds: [refund.id] };
    };

    // Paid twice (a second attempt went through): the later payment goes back.
    if (checkout.status === 'PAID') return refundAll('DUPLICATE_PAYMENT');

    if (payment.amountPaise !== checkout.totalPaise) {
      deps.logger.error(
        new Error(`Payment ${payment.id} amount differs from checkout ${checkout.id}`),
      );
      return refundAll('DUPLICATE_PAYMENT');
    }

    // Paid after the reservation ran out: keep it only if the stock is still there.
    if (checkout.status === 'EXPIRED') {
      const items = await tx.checkoutItem.findMany({ where: { checkoutId: checkout.id } });
      if (!(await reserveWithin(tx, items))) return refundAll('LATE_PAYMENT');
    }

    await tx.checkout.update({ where: { id: checkout.id }, data: { status: 'PAID', paidAt: now } });
    const orders = await createOrders(tx, now, checkout, payment);
    return { checkout, orders, refundIds: [] };
  });

  for (const refundId of outcome.refundIds) await processRefund(deps, refundId);
  for (const order of outcome.orders) {
    await notify(deps, order, 'buyer', 'orderPlacedBuyer');
    await notify(deps, order, 'seller', 'orderPlacedSeller');
  }
  return { checkoutId: outcome.checkout.id, orders: outcome.orders, refundIds: outcome.refundIds };
}

/**
 * Takes the stock for a late payment, all or nothing. A failed attempt puts back
 * whatever it took, inside the same transaction.
 */
async function reserveWithin(tx, items) {
  const taken = [];
  for (const item of items) {
    if (!(await reserveStock(tx, [item]))) {
      for (const done of taken) {
        await tx.$executeRaw`
          UPDATE listings SET quantity = quantity + ${done.quantity} WHERE id = ${done.listingId}::uuid`;
      }
      return false;
    }
    taken.push(item);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/**
 * Handles a webhook whose signature has already been checked. Each gateway event
 * is stored once; an event seen and processed before is acknowledged and ignored.
 */
export async function handleWebhook(deps, { eventId, body }) {
  const { db, clock } = deps;
  await db.paymentEvent.createMany({
    data: [
      {
        gatewayEventId: eventId,
        type: String(body.event ?? 'unknown'),
        payload: body,
        receivedAt: clock.now(),
      },
    ],
    skipDuplicates: true,
  });
  const stored = await db.paymentEvent.findUniqueOrThrow({ where: { gatewayEventId: eventId } });
  if (stored.processedAt) return { duplicate: true };

  const payment = body.payload?.payment?.entity;
  const refund = body.payload?.refund?.entity;
  switch (body.event) {
    case 'payment.captured':
    case 'order.paid':
    case 'payment.failed':
      if (payment) await confirmPayment(deps, payment);
      break;
    case 'refund.processed': {
      const row = await findRefundFor(db, refund);
      if (row) await markRefundProcessed(deps, row.id);
      break;
    }
    case 'refund.failed':
      if (refund) await markRefundFailed(deps, refund.id, refund.error_description);
      break;
    default:
      // Other events are stored for the record only.
      break;
  }

  await db.paymentEvent.update({ where: { id: stored.id }, data: { processedAt: clock.now() } });
  return { duplicate: false };
}

async function findRefundFor(db, refund) {
  if (!refund) return null;
  const byGatewayId = await db.refund.findUnique({ where: { gatewayRefundId: refund.id } });
  if (byGatewayId) return byGatewayId;
  const reference = refund.notes?.reference;
  if (!reference) return null;
  const byReference = await db.refund.findUnique({ where: { id: reference } }).catch(() => null);
  if (byReference && !byReference.gatewayRefundId) {
    await db.refund.update({ where: { id: byReference.id }, data: { gatewayRefundId: refund.id } });
  }
  return byReference;
}
