import { AppError } from '../../lib/errors.js';
import { rupees } from '../../lib/csv.js';
import { createRefund, processRefund } from '../payments/refunds.service.js';
import { dayRange, writeAudit } from './admin.query.js';

// Financial operations (SPEC Module 10): payments, refunds (with a retry for those
// that failed) and rental deposits. Everything is read from the stored records;
// nothing here changes an amount.

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export function paymentsWhere({ status, from, to, q }) {
  const where = {};
  if (status) where.status = status;
  const created = dayRange({ from, to });
  if (created) where.createdAt = created;
  if (q) where.gatewayPaymentId = { contains: q };
  return where;
}

export const paymentInclude = {
  checkout: { select: { id: true, buyer: { select: { email: true } } } },
  booking: { select: { id: true, ref: true, renter: { select: { email: true } } } },
};

export function toAdminPayment(p) {
  return {
    id: p.id,
    gatewayPaymentId: p.gatewayPaymentId,
    amountPaise: p.amountPaise,
    feePaise: p.feePaise,
    status: p.status,
    method: p.method,
    kind: p.bookingId ? 'rental' : 'checkout',
    checkoutId: p.checkoutId,
    bookingId: p.bookingId,
    bookingRef: p.booking?.ref ?? null,
    payerEmail: p.checkout?.buyer.email ?? p.booking?.renter.email ?? null,
    createdAt: p.createdAt.toISOString(),
    capturedAt: p.capturedAt?.toISOString() ?? null,
  };
}

export const paymentColumns = [
  ['id', (p) => p.id],
  ['gateway payment', (p) => p.gatewayPaymentId],
  ['kind', (p) => (p.bookingId ? 'rental' : 'checkout')],
  ['amount (rupees)', (p) => rupees(p.amountPaise)],
  ['gateway fee (rupees)', (p) => rupees(p.feePaise)],
  ['status', (p) => p.status],
  ['payer', (p) => p.checkout?.buyer.email ?? p.booking?.renter.email],
  ['captured', (p) => p.capturedAt],
];

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export function refundsWhere({ status, reason, from, to }) {
  const where = {};
  if (status) where.status = status;
  if (reason) where.reason = reason;
  const created = dayRange({ from, to });
  if (created) where.createdAt = created;
  return where;
}

export const refundInclude = {
  order: { select: { ref: true } },
  booking: { select: { ref: true } },
};

export function toAdminRefund(r) {
  return {
    id: r.id,
    amountPaise: r.amountPaise,
    itemsAmountPaise: r.itemsAmountPaise,
    depositAmountPaise: r.depositAmountPaise,
    reason: r.reason,
    status: r.status,
    attempts: r.attempts,
    lastError: r.lastError,
    orderId: r.orderId,
    orderRef: r.order?.ref ?? null,
    bookingId: r.bookingId,
    bookingRef: r.booking?.ref ?? null,
    checkoutId: r.checkoutId,
    gatewayRefundId: r.gatewayRefundId,
    createdAt: r.createdAt.toISOString(),
    processedAt: r.processedAt?.toISOString() ?? null,
  };
}

export const refundColumns = [
  ['id', (r) => r.id],
  ['order', (r) => r.order?.ref],
  ['booking', (r) => r.booking?.ref],
  ['reason', (r) => r.reason],
  ['status', (r) => r.status],
  ['amount (rupees)', (r) => rupees(r.amountPaise)],
  ['deposit part (rupees)', (r) => rupees(r.depositAmountPaise)],
  ['attempts', (r) => r.attempts],
  ['last error', (r) => r.lastError],
  ['created', (r) => r.createdAt],
  ['processed', (r) => r.processedAt],
];

/**
 * Retries a refund that did not go through (I104). One still waiting with no
 * gateway answer is sent again under the same reference, so the gateway can never
 * make it twice. One the gateway reported failed is replaced by a new refund for
 * the same amount and parts, under a new key; the failed one no longer counts
 * against the payment.
 */
export async function retryRefund(deps, adminId, refundId, { reason }) {
  const { db, clock } = deps;
  const refund = await db.refund.findUnique({ where: { id: refundId } });
  if (!refund) throw AppError.notFound('Refund not found');
  const now = clock.now();

  let targetId = refund.id;
  if (refund.status === 'PENDING' && !refund.gatewayRefundId) {
    await writeAudit(db, now, {
      adminId,
      action: 'RETRY_REFUND',
      targetType: 'refund',
      targetId: refund.id,
      reason,
    });
  } else if (refund.status === 'FAILED') {
    targetId = await db.$transaction(async (tx) => {
      const tries = await tx.refund.count({
        where: { key: { startsWith: `${refund.key}:retry-` } },
      });
      const replacement = await createRefund(tx, now, {
        key: `${refund.key}:retry-${tries + 1}`,
        checkoutId: refund.checkoutId,
        orderId: refund.orderId,
        bookingId: refund.bookingId,
        paymentId: refund.paymentId,
        amountPaise: refund.amountPaise,
        itemsAmountPaise: refund.itemsAmountPaise,
        depositAmountPaise: refund.depositAmountPaise,
        reason: refund.reason,
      });
      await writeAudit(tx, now, {
        adminId,
        action: 'RETRY_REFUND',
        targetType: 'refund',
        targetId: refund.id,
        reason,
        details: { replacement: replacement.id },
      });
      return replacement.id;
    });
  } else {
    throw new AppError(
      409,
      'REFUND_NOT_RETRYABLE',
      'This refund is processed or already with the gateway',
    );
  }
  await processRefund(deps, targetId);
  return toAdminRefund(
    await db.refund.findUniqueOrThrow({ where: { id: targetId }, include: refundInclude }),
  );
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

const DEPOSIT_STAGES = {
  held: ['CONFIRMED', 'ACTIVE', 'RETURNED', 'CLAIM_OPEN', 'ADMIN_REVIEW', 'SETTLING'],
  settled: ['COMPLETED'],
};

/** Bookings that collected a deposit, with what came back and what was deducted. */
export function depositsWhere({ stage, from, to, q }) {
  const where = { depositPaise: { gt: 0 }, paidAt: { not: null } };
  if (stage) where.status = { in: DEPOSIT_STAGES[stage] };
  const paid = dayRange({ from, to });
  if (paid) where.paidAt = { ...where.paidAt, ...paid };
  if (q) where.ref = { contains: q, mode: 'insensitive' };
  return where;
}

export const DEPOSIT_STAGE_NAMES = Object.keys(DEPOSIT_STAGES);

export function toAdminDeposit(b) {
  return {
    bookingId: b.id,
    ref: b.ref,
    title: b.title,
    status: b.status,
    depositPaise: b.depositPaise,
    refundedPaise: b.depositRefundedPaise,
    deductedPaise: b.depositDeductedPaise,
    // Still to settle: collected, less what came back and what was deducted.
    outstandingPaise: b.depositPaise - b.depositRefundedPaise - b.depositDeductedPaise,
    owedPaise: b.owedPaise,
    returnedAt: b.returnedAt?.toISOString() ?? null,
    inspectionEndsAt: b.inspectionEndsAt?.toISOString() ?? null,
    settledAt: b.settledAt?.toISOString() ?? null,
    paidAt: b.paidAt.toISOString(),
  };
}

export const depositColumns = [
  ['booking', (b) => b.ref],
  ['title', (b) => b.title],
  ['status', (b) => b.status],
  ['deposit (rupees)', (b) => rupees(b.depositPaise)],
  ['refunded (rupees)', (b) => rupees(b.depositRefundedPaise)],
  ['deducted (rupees)', (b) => rupees(b.depositDeductedPaise)],
  [
    'outstanding (rupees)',
    (b) => rupees(b.depositPaise - b.depositRefundedPaise - b.depositDeductedPaise),
  ],
  ['owed beyond deposit (rupees)', (b) => rupees(b.owedPaise)],
  ['paid', (b) => b.paidAt],
  ['settled', (b) => b.settledAt],
];
