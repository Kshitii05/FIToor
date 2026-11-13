import { recordLedger } from '../../lib/ledger.js';
import { createRefund, processRefund } from '../payments/refunds.service.js';
import { notifyBooking } from './rental.emails.js';
import { oneTimeCode } from './rental.rules.js';
import { loadBooking, PAID_STATUSES } from './rental.service.js';

// Paying for an approved booking: the rental fee, the deposit and any delivery
// charge arrive in one payment (SPEC 13) and are recorded apart. The deposit is
// written as DEPOSIT_COLLECTED, never as a buyer payment, so it is never revenue.
// As for checkouts, the webhook and the browser can both report the payment; the
// first one confirms the booking and every later report changes nothing.

/**
 * Applies a gateway payment for a booking's gateway order. Late payments (after the
 * booking expired or was cancelled) and second payments are refunded in full.
 */
export async function confirmBookingPayment(deps, entity) {
  const { db, clock } = deps;
  const now = clock.now();

  const outcome = await db.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw`
      SELECT id FROM rental_bookings WHERE gateway_order_id = ${entity.order_id} FOR UPDATE`;
    const booking = await tx.rentalBooking.findUniqueOrThrow({ where: { id: locked.id } });

    const known = await tx.payment.findUnique({ where: { gatewayPaymentId: entity.id } });
    if (known && (known.status === 'CAPTURED' || entity.status !== 'captured')) {
      return { booking, confirmed: false, refundId: null };
    }
    if (entity.status !== 'captured') {
      await tx.payment.create({
        data: {
          bookingId: booking.id,
          gatewayOrderId: entity.order_id,
          gatewayPaymentId: entity.id,
          amountPaise: entity.amount,
          status: 'FAILED',
          method: entity.method ?? null,
          createdAt: now,
        },
      });
      return { booking, confirmed: false, refundId: null };
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
            bookingId: booking.id,
            gatewayOrderId: entity.order_id,
            gatewayPaymentId: entity.id,
            createdAt: now,
          },
        });
    const common = { bookingId: booking.id, paymentId: payment.id };
    // Gateway charges are the platform's cost (SPEC 6), never the owner's.
    const gatewayFee = {
      key: `payment:${payment.id}:gateway-fee`,
      type: 'GATEWAY_FEE',
      amountPaise: payment.feePaise ?? 0,
      ...common,
    };

    const accepted = booking.status === 'APPROVED' && payment.amountPaise === booking.totalPaise;
    if (!accepted) {
      if (booking.status === 'APPROVED') {
        deps.logger.error(
          new Error(`Payment ${payment.id} amount differs from booking ${booking.id}`),
        );
      }
      await recordLedger(tx, now, [
        {
          key: `payment:${payment.id}:received`,
          type: 'BUYER_PAYMENT',
          amountPaise: payment.amountPaise,
          ...common,
        },
        gatewayFee,
      ]);
      const paidAlready = PAID_STATUSES.includes(booking.status);
      const reason =
        paidAlready || booking.status === 'APPROVED' ? 'DUPLICATE_PAYMENT' : 'LATE_PAYMENT';
      const refund = await createRefund(tx, now, {
        key: `payment:${payment.id}:${reason.toLowerCase()}`,
        bookingId: booking.id,
        paymentId: payment.id,
        amountPaise: payment.amountPaise,
        itemsAmountPaise: 0,
        reason,
      });
      return { booking, confirmed: false, refundId: refund.id };
    }

    await recordLedger(tx, now, [
      {
        key: `payment:${payment.id}:received`,
        type: 'BUYER_PAYMENT',
        amountPaise: booking.feePaise + booking.deliveryChargePaise,
        ...common,
      },
      {
        key: `payment:${payment.id}:deposit`,
        type: 'DEPOSIT_COLLECTED',
        amountPaise: booking.depositPaise,
        ...common,
      },
      gatewayFee,
      {
        key: `booking:${booking.id}:commission`,
        type: 'COMMISSION',
        amountPaise: booking.commissionPaise,
        ...common,
        sellerId: booking.ownerId,
      },
      {
        key: `booking:${booking.id}:seller-payable`,
        type: 'SELLER_PAYABLE',
        amountPaise: booking.ownerPayablePaise,
        ...common,
        sellerId: booking.ownerId,
      },
    ]);

    const listing = await tx.listing.findUniqueOrThrow({ where: { id: booking.listingId } });
    const pickup = booking.fulfilment === 'PICKUP';
    const { count } = await tx.rentalBooking.updateMany({
      where: { id: booking.id, status: 'APPROVED' },
      data: {
        status: 'CONFIRMED',
        paidAt: now,
        handoverCode: oneTimeCode(),
        returnCode: oneTimeCode(),
        // The exact spot, now that the renter has paid (I41).
        pickupLat: pickup ? listing.pinLat : null,
        pickupLng: pickup ? listing.pinLng : null,
        pickupLocality: pickup ? listing.locality : null,
      },
    });
    if (count !== 1) throw new Error(`Booking ${booking.id} changed while being paid`);
    // The request's hold gives way to the booking itself.
    await tx.rentalDateHold.updateMany({
      where: { bookingId: booking.id, releasedAt: null },
      data: { releasedAt: now },
    });
    await tx.bookingEvent.create({
      data: {
        bookingId: booking.id,
        actorRole: 'SYSTEM',
        action: 'PAID',
        fromStatus: 'APPROVED',
        toStatus: 'CONFIRMED',
        createdAt: now,
      },
    });
    return { booking, confirmed: true, refundId: null };
  });

  if (outcome.refundId) await processRefund(deps, outcome.refundId);
  if (outcome.confirmed) {
    const booking = await loadBooking(db, outcome.booking.id);
    await notifyBooking(deps, booking, 'renter', 'confirmedRenter');
    await notifyBooking(deps, booking, 'owner', 'confirmedOwner');
  }
  return {
    bookingId: outcome.booking.id,
    confirmed: outcome.confirmed,
    refundId: outcome.refundId,
  };
}
