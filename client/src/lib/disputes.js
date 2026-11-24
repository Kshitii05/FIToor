// Labels for disputes, reviews and reports. The server decides what is allowed and
// sends it as `actions`; these only choose words.
import { formatPaise } from './money.js';

export const DISPUTE_STATUS = {
  OPEN: { label: 'Waiting for an answer', tone: 'notice' },
  UNDER_REVIEW: { label: 'With our team', tone: 'notice' },
  DECIDED: { label: 'Decided: appeal window', tone: 'neutral' },
  APPEALED: { label: 'Appealed', tone: 'notice' },
  RESOLVED: { label: 'Settled by agreement', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'success' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
};

export const DISPUTE_KIND = {
  SALE_ISSUE: 'Problem with the item',
  NOT_DELIVERED: 'Did not arrive',
  RENTAL_DEPOSIT: 'Rental deposit',
  NOT_RETURNED: 'Not returned',
};

export const DISPUTE_FILTERS = [
  { value: '', label: 'All' },
  { value: 'OPEN', label: 'Waiting for an answer' },
  { value: 'UNDER_REVIEW', label: 'With our team' },
  { value: 'DECIDED', label: 'Decided' },
  { value: 'CLOSED', label: 'Closed' },
];

export const UNFINISHED = ['OPEN', 'UNDER_REVIEW', 'DECIDED', 'APPEALED'];

export const ISSUE_CATEGORY = {
  WRONG_ITEM: 'Wrong item',
  DAMAGED: 'Damaged',
  NOT_AS_DESCRIBED: 'Not as described',
};

/** A decision in plain words. */
export function decisionText(decision) {
  if (!decision) return null;
  switch (decision.outcome) {
    case 'FULL_REFUND':
      return 'Full refund to the buyer';
    case 'PARTIAL_REFUND':
      return `Partial refund of ${formatPaise(decision.refundPaise)}`;
    case 'REJECTED':
      return 'No refund';
    case 'DELIVERED':
      return 'Treated as delivered';
    case 'REFUND':
      return 'Cancelled with a full refund';
    case 'RETURNED':
      return 'Treated as returned';
    case 'SETTLE':
      return `From the deposit: ${formatPaise(decision.damagePaise)} for damage and ${formatPaise(
        decision.lateFeePaise,
      )} late fee`;
    default:
      return decision.outcome;
  }
}

/** What "agree" means, said to the person agreeing. */
export function agreeText(dispute) {
  switch (dispute.kind) {
    case 'SALE_ISSUE':
      return 'Agree to give the buyer a full refund.';
    case 'NOT_DELIVERED':
      return 'Agree it did not arrive: the order is cancelled and the buyer refunded in full.';
    case 'NOT_RETURNED':
      return 'Agree the item was not returned: the owner keeps the deposit.';
    default:
      return dispute.claimedDamagePaise !== null
        ? `Accept the claim of ${formatPaise(dispute.claimedDamagePaise)} from your deposit.`
        : 'Waive the late fee.';
  }
}

/** Where the order or rental lives for this person. */
export function subjectLink(dispute) {
  const s = dispute.subject;
  if (!s) return null;
  const path = {
    buyer: `/orders/${dispute.orderId}`,
    seller: `/sales/${dispute.orderId}`,
    renter: `/rentals/${dispute.bookingId}`,
    owner: `/rented-out/${dispute.bookingId}`,
  }[s.side];
  return { path, label: s.type === 'order' ? `Order ${s.ref}` : `Rental ${s.ref}` };
}

export const REPORT_REASONS = [
  { value: 'PROHIBITED_ITEM', label: 'Prohibited item' },
  { value: 'COUNTERFEIT', label: 'Counterfeit' },
  { value: 'SCAM', label: 'Scam or fraud' },
  { value: 'HARASSMENT', label: 'Harassment' },
  { value: 'INAPPROPRIATE', label: 'Inappropriate' },
  { value: 'SPAM', label: 'Spam' },
  { value: 'OTHER', label: 'Something else' },
];

export const RATING_FIELDS = [
  { key: 'overall', label: 'Overall' },
  { key: 'condition', label: 'Condition of the item' },
  { key: 'communication', label: 'Communication' },
  { key: 'handover', label: 'Delivery or handover' },
];
