import { COMMISSION_RATE_BPS } from '../config/policy.js';

// Money is whole paise everywhere. These helpers use integer arithmetic only.

/**
 * The platform commission on an items subtotal: 10% (COMMISSION_RATE_BPS basis
 * points), rounded to the nearest paisa with halves rounded up. Delivery charges
 * are never part of the base (SPEC 12).
 */
export function commissionOn(itemsSubtotalPaise) {
  if (!Number.isInteger(itemsSubtotalPaise) || itemsSubtotalPaise < 0) {
    throw new RangeError('itemsSubtotalPaise must be a non-negative integer');
  }
  return Math.floor((itemsSubtotalPaise * COMMISSION_RATE_BPS + 5000) / 10000);
}

/**
 * How a refund splits between the platform and the seller. Commission is
 * recalculated on what remains of the items subtotal, so many partial refunds add up
 * exactly to one full refund. Returns the commission and seller-payable reversals.
 */
export function refundSplit({
  itemsSubtotalPaise,
  itemsRefundedBeforePaise,
  refundPaise,
  itemsPartPaise,
}) {
  const before = commissionOn(itemsSubtotalPaise - itemsRefundedBeforePaise);
  const after = commissionOn(itemsSubtotalPaise - itemsRefundedBeforePaise - itemsPartPaise);
  const commissionReversalPaise = before - after;
  return {
    commissionReversalPaise,
    sellerPayableReversalPaise: refundPaise - commissionReversalPaise,
  };
}
