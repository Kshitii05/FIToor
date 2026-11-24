import { AppError } from '../../lib/errors.js';
import {
  cancelUndelivered,
  confirmDelivery,
  loadOrder,
  partialRefundLimit,
  resolveIssue,
  restoreAfterIssue,
} from '../orders/order.service.js';
import {
  confirmReturned,
  loadBooking,
  moveClaimToReview,
  resumeActive,
  resumeDeposit,
  settleDeposit,
} from '../rentals/rental.service.js';

// What each kind of dispute means for its order or booking (I79): the outcomes an
// admin may choose, what agreeing or withdrawing does, and how a decision takes
// effect. The effects are the order and rental functions; each changes its subject
// only from an allowed state, so applying one twice changes nothing more.

const amount = (value) => Number.isInteger(value) && value >= 0;

function requireAmounts(decision) {
  if (!amount(decision.damagePaise) || !amount(decision.lateFeePaise)) {
    throw AppError.badRequest(
      'Give the damage and the late fee to take from the deposit, in paise',
    );
  }
}

/** A rental deposit dispute asking for one thing only can be agreed to or withdrawn. */
const singleAsk = (dispute) => !(dispute.claimedDamagePaise !== null && dispute.lateFeeDisputed);

export const KINDS = {
  SALE_ISSUE: {
    subject: 'order',
    outcomes: ['FULL_REFUND', 'PARTIAL_REFUND', 'REJECTED'],
    check(decision, order) {
      if (decision.outcome !== 'PARTIAL_REFUND') return;
      const max = partialRefundLimit(order);
      if (!(
        Number.isInteger(decision.refundPaise) &&
        decision.refundPaise > 0 &&
        decision.refundPaise <= max
      )) {
        throw AppError.badRequest(
          'A partial refund must be more than ₹0 and less than the items left to refund',
          { maxPaise: max },
        );
      }
    },
    canAgree: () => true,
    canWithdraw: () => true,
    agree: (deps, dispute, order, actor) =>
      resolveIssue(
        deps,
        order,
        { resolution: 'FULL_REFUND' },
        actor,
        'The seller agreed to a refund',
      ),
    withdraw: (deps, dispute, order, actor) => restoreAfterIssue(deps, order, actor),
    apply: (deps, dispute, order, decision, actor, reason) =>
      resolveIssue(
        deps,
        order,
        { resolution: decision.outcome, refundPaise: decision.refundPaise },
        actor,
        reason,
      ),
  },

  NOT_DELIVERED: {
    subject: 'order',
    outcomes: ['DELIVERED', 'REFUND'],
    check: () => {},
    canAgree: () => true,
    canWithdraw: () => true,
    agree: (deps, dispute, order, actor) =>
      cancelUndelivered(deps, order, actor, 'The seller agreed it did not arrive'),
    withdraw: (deps, dispute, order, actor) =>
      confirmDelivery(deps, order, actor, 'The buyer says it arrived'),
    apply: (deps, dispute, order, decision, actor, reason) =>
      decision.outcome === 'DELIVERED'
        ? confirmDelivery(deps, order, actor, reason)
        : cancelUndelivered(deps, order, actor, reason),
  },

  RENTAL_DEPOSIT: {
    subject: 'booking',
    outcomes: ['SETTLE'],
    check: requireAmounts,
    canAgree: singleAsk,
    canWithdraw: singleAsk,
    // The renter accepts the owner's claim, or the owner waives the disputed late fee.
    agree: (deps, dispute, booking, actor) =>
      dispute.claimedDamagePaise !== null
        ? settleDeposit(
            deps,
            booking,
            { damagePaise: dispute.claimedDamagePaise, lateFeePaise: booking.lateFeePaise ?? 0 },
            actor,
            'The renter accepted the claim',
          )
        : resumeDeposit(deps, booking, actor, { waiveLateFee: true }),
    withdraw: (deps, dispute, booking, actor) => resumeDeposit(deps, booking, actor),
    apply: (deps, dispute, booking, decision, actor, reason) =>
      settleDeposit(deps, booking, decision, actor, reason),
    onReview: (deps, dispute, booking) => moveClaimToReview(deps, booking),
  },

  NOT_RETURNED: {
    subject: 'booking',
    outcomes: ['RETURNED', 'SETTLE'],
    check: (decision) => {
      if (decision.outcome === 'SETTLE') requireAmounts(decision);
    },
    canAgree: () => true,
    canWithdraw: () => true,
    // The renter admits it is not coming back: the owner keeps the deposit.
    agree: (deps, dispute, booking, actor) =>
      settleDeposit(
        deps,
        booking,
        { damagePaise: booking.depositPaise, lateFeePaise: 0 },
        actor,
        'The renter agreed the item was not returned',
      ),
    withdraw: (deps, dispute, booking, actor) => resumeActive(deps, booking, actor),
    apply: (deps, dispute, booking, decision, actor, reason) =>
      decision.outcome === 'RETURNED'
        ? confirmReturned(deps, booking, actor, reason)
        : settleDeposit(deps, booking, decision, actor, reason),
  },
};

/** The order or booking a dispute is about, freshly loaded. */
export const loadSubject = (db, dispute) =>
  dispute.orderId ? loadOrder(db, dispute.orderId) : loadBooking(db, dispute.bookingId);

/** Checks an admin decision against the dispute's kind and its subject. */
export function checkDecision(dispute, subject, decision) {
  const kind = KINDS[dispute.kind];
  if (!kind.outcomes.includes(decision.outcome)) {
    throw AppError.badRequest(`Choose one of: ${kind.outcomes.join(', ')}`, {
      outcomes: kind.outcomes,
    });
  }
  kind.check(decision, subject);
}

/** Keeps only the fields a decision of this outcome uses. */
export function cleanDecision(decision) {
  const { outcome, refundPaise, damagePaise, lateFeePaise } = decision;
  if (outcome === 'PARTIAL_REFUND') return { outcome, refundPaise };
  if (outcome === 'SETTLE') return { outcome, damagePaise, lateFeePaise };
  return { outcome };
}
