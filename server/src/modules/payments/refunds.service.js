import { REFUND_RETRY_AFTER_MINUTES, REFUND_RETRY_MAX_ATTEMPTS } from '../../config/policy.js';
import { addMinutes } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { recordLedger } from '../../lib/ledger.js';
import { refundSplit } from '../../lib/money.js';
import { notify } from '../orders/order.emails.js';
import { notifyBooking } from '../rentals/rental.emails.js';

// Refunds. A refund row is created in the same transaction as the order change that
// causes it, then sent to the gateway afterwards. Its `key` means each refund can
// happen only once; our refund id travels to the gateway as its reference, so a
// retry can find a refund the gateway already made instead of making a second one.
// Ledger rows are written when the gateway reports the refund processed.

/**
 * Creates a refund inside `tx`. Locks the payment row so refunds can never add up
 * to more than was paid. Returns the existing refund if `key` was already used.
 */
export async function createRefund(
  tx,
  now,
  {
    key,
    checkoutId,
    orderId,
    bookingId,
    paymentId,
    amountPaise,
    itemsAmountPaise,
    depositAmountPaise = 0,
    reason,
  },
) {
  const existing = await tx.refund.findUnique({ where: { key } });
  if (existing) return existing;

  const [payment] = await tx.$queryRaw`
    SELECT amount_paise FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
  const [{ refunded }] = await tx.$queryRaw`
    SELECT coalesce(sum(amount_paise), 0)::int AS refunded FROM refunds
    WHERE payment_id = ${paymentId}::uuid AND status <> 'FAILED'`;
  if (refunded + amountPaise > payment.amount_paise) {
    throw new AppError(
      409,
      'REFUND_TOO_LARGE',
      'That is more than is left to refund on this payment',
    );
  }

  return tx.refund.create({
    data: {
      key,
      checkoutId: checkoutId ?? null,
      orderId: orderId ?? null,
      bookingId: bookingId ?? null,
      paymentId,
      amountPaise,
      itemsAmountPaise,
      depositAmountPaise,
      reason,
      createdAt: now,
    },
  });
}

/** Records a refund as processed: once, with its ledger rows. */
export async function markRefundProcessed(deps, refundId) {
  const { db, clock } = deps;
  const now = clock.now();
  const done = await db.$transaction(async (tx) => {
    const { count } = await tx.refund.updateMany({
      where: { id: refundId, status: { not: 'PROCESSED' } },
      data: { status: 'PROCESSED', processedAt: now },
    });
    if (count !== 1) return null;
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    if (refund.bookingId && !UNACCEPTED_PAYMENT.includes(refund.reason)) {
      return { refund, booking: await applyBookingRefund(tx, now, refund) };
    }

    const rows = [
      {
        key: `refund:${refund.id}:paid-out`,
        type: 'BUYER_REFUND',
        amountPaise: refund.amountPaise,
        checkoutId: refund.checkoutId,
        orderId: refund.orderId,
        bookingId: refund.bookingId,
        paymentId: refund.paymentId,
        refundId: refund.id,
      },
    ];

    let order = null;
    if (refund.orderId) {
      // Locked so two refunds of one order split commission in a consistent order.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${refund.orderId}::uuid FOR UPDATE`;
      order = await tx.order.findUniqueOrThrow({ where: { id: refund.orderId } });
      const split = refundSplit({
        itemsSubtotalPaise: order.itemsSubtotalPaise,
        itemsRefundedBeforePaise: order.itemsRefundedPaise,
        refundPaise: refund.amountPaise,
        itemsPartPaise: refund.itemsAmountPaise,
      });
      rows.push(
        {
          key: `refund:${refund.id}:commission-reversal`,
          type: 'COMMISSION_REVERSAL',
          amountPaise: split.commissionReversalPaise,
          checkoutId: refund.checkoutId,
          orderId: order.id,
          refundId: refund.id,
          sellerId: order.sellerId,
        },
        {
          key: `refund:${refund.id}:seller-payable-reversal`,
          type: 'SELLER_PAYABLE_REVERSAL',
          amountPaise: split.sellerPayableReversalPaise,
          checkoutId: refund.checkoutId,
          orderId: order.id,
          refundId: refund.id,
          sellerId: order.sellerId,
        },
      );
      order = await tx.order.update({
        where: { id: order.id },
        data: {
          refundedPaise: { increment: refund.amountPaise },
          itemsRefundedPaise: { increment: refund.itemsAmountPaise },
        },
      });
    }
    await recordLedger(tx, now, rows);
    return { refund, order };
  });

  if (done?.order) {
    await notify(deps, done.order, 'buyer', 'refunded', done.refund.amountPaise, done.refund.id);
  }
  if (done?.booking) {
    await notifyBooking(
      deps,
      done.booking,
      'renter',
      'refunded',
      done.refund.amountPaise,
      done.refund.id,
    );
    if (done.booking.completed) await notifyBooking(deps, done.booking, 'owner', 'completedOwner');
  }
  return done;
}

// A payment the booking never accepted (late, or a second one) goes back whole: no
// part of it was a deposit or a fee, so it is recorded like a checkout refund.
const UNACCEPTED_PAYMENT = ['LATE_PAYMENT', 'DUPLICATE_PAYMENT'];

/**
 * Ledger rows for a processed booking refund, in `tx`. The deposit part is a deposit
 * refund, never a buyer refund; the fee part reverses commission, recalculated on
 * what remains of the fee. A processed deposit refund completes a settling booking.
 */
async function applyBookingRefund(tx, now, refund) {
  await tx.$queryRaw`SELECT id FROM rental_bookings WHERE id = ${refund.bookingId}::uuid FOR UPDATE`;
  const booking = await tx.rentalBooking.findUniqueOrThrow({ where: { id: refund.bookingId } });
  const otherPaise = refund.amountPaise - refund.depositAmountPaise;
  const split = refundSplit({
    itemsSubtotalPaise: booking.feePaise,
    itemsRefundedBeforePaise: booking.feeRefundedPaise,
    refundPaise: otherPaise,
    itemsPartPaise: refund.itemsAmountPaise,
  });
  const common = { bookingId: booking.id, paymentId: refund.paymentId, refundId: refund.id };
  await recordLedger(tx, now, [
    {
      key: `refund:${refund.id}:paid-out`,
      type: 'BUYER_REFUND',
      amountPaise: otherPaise,
      ...common,
    },
    {
      key: `refund:${refund.id}:deposit`,
      type: 'DEPOSIT_REFUND',
      amountPaise: refund.depositAmountPaise,
      ...common,
    },
    {
      key: `refund:${refund.id}:commission-reversal`,
      type: 'COMMISSION_REVERSAL',
      amountPaise: split.commissionReversalPaise,
      ...common,
      sellerId: booking.ownerId,
    },
    {
      key: `refund:${refund.id}:seller-payable-reversal`,
      type: 'SELLER_PAYABLE_REVERSAL',
      amountPaise: split.sellerPayableReversalPaise,
      ...common,
      sellerId: booking.ownerId,
    },
  ]);
  const completes = refund.reason === 'DEPOSIT_RETURN' && booking.status === 'SETTLING';
  const updated = await tx.rentalBooking.update({
    where: { id: booking.id },
    data: {
      refundedPaise: { increment: otherPaise },
      feeRefundedPaise: { increment: refund.itemsAmountPaise },
      depositRefundedPaise: { increment: refund.depositAmountPaise },
      ...(completes ? { status: 'COMPLETED', completedAt: now } : {}),
    },
  });
  if (completes) {
    await tx.bookingEvent.create({
      data: {
        bookingId: booking.id,
        actorRole: 'SYSTEM',
        action: 'DEPOSIT_REFUNDED',
        fromStatus: 'SETTLING',
        toStatus: 'COMPLETED',
        createdAt: now,
      },
    });
  }
  return Object.assign(updated, { completed: completes });
}

/**
 * Sends a refund to the gateway. Safe to call again: it first looks for a refund the
 * gateway already made with this reference. Failures are recorded for a retry.
 */
export async function processRefund(deps, refundId) {
  const { db, clock, paymentGateway, logger } = deps;
  const refund = await db.refund.findUnique({
    where: { id: refundId },
    include: { payment: true },
  });
  if (!refund || refund.status !== 'PENDING' || refund.gatewayRefundId) return refund;

  const reference = refund.id;
  try {
    const sent =
      (refund.attempts > 0
        ? await paymentGateway.findRefund({ paymentId: refund.payment.gatewayPaymentId, reference })
        : null) ??
      (await paymentGateway.createRefund({
        paymentId: refund.payment.gatewayPaymentId,
        amountPaise: refund.amountPaise,
        reference,
      }));
    await db.refund.update({
      where: { id: refund.id },
      data: {
        gatewayRefundId: sent.id,
        attempts: { increment: 1 },
        lastAttemptAt: clock.now(),
        lastError: null,
      },
    });
    if (sent.status === 'processed') await markRefundProcessed(deps, refund.id);
  } catch (error) {
    logger.error(error);
    await db.refund.update({
      where: { id: refund.id },
      data: {
        attempts: { increment: 1 },
        lastAttemptAt: clock.now(),
        lastError: String(error.message).slice(0, 500),
      },
    });
  }
  return db.refund.findUnique({ where: { id: refund.id } });
}

/** Retries refunds the gateway has not accepted yet. Run on a schedule. */
export async function retryRefunds(deps) {
  const { db, clock } = deps;
  const due = await db.refund.findMany({
    where: {
      status: 'PENDING',
      gatewayRefundId: null,
      attempts: { lt: REFUND_RETRY_MAX_ATTEMPTS },
      OR: [
        { lastAttemptAt: null },
        { lastAttemptAt: { lte: addMinutes(clock.now(), -REFUND_RETRY_AFTER_MINUTES) } },
      ],
    },
    select: { id: true },
  });
  for (const { id } of due) await processRefund(deps, id);
  return due.length;
}

/** The gateway reported a refund as failed: keep it for an admin to act on. */
export async function markRefundFailed({ db }, gatewayRefundId, message) {
  await db.refund.updateMany({
    where: { gatewayRefundId, status: 'PENDING' },
    data: {
      status: 'FAILED',
      lastError: message?.slice(0, 500) ?? 'Reported failed by the gateway',
    },
  });
}
