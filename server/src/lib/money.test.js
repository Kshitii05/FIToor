import { describe, expect, it } from 'vitest';
import { commissionOn, refundSplit } from './money.js';

describe('commission', () => {
  it('is 10% of the items subtotal, to the nearest paisa', () => {
    expect(commissionOn(200000)).toBe(20000);
    expect(commissionOn(12345)).toBe(1235); // 1234.5 rounds up
    expect(commissionOn(12344)).toBe(1234); // 1234.4 rounds down
    expect(commissionOn(0)).toBe(0);
  });

  it('refuses fractions and negatives', () => {
    expect(() => commissionOn(10.5)).toThrow(RangeError);
    expect(() => commissionOn(-1)).toThrow(RangeError);
  });
});

describe('splitting a refund', () => {
  it('reverses commission on the refunded items only', () => {
    expect(
      refundSplit({
        itemsSubtotalPaise: 200000,
        itemsRefundedBeforePaise: 0,
        refundPaise: 50000,
        itemsPartPaise: 50000,
      }),
    ).toEqual({ commissionReversalPaise: 5000, sellerPayableReversalPaise: 45000 });
  });

  it('returns the delivery charge entirely to the buyer from the seller’s share', () => {
    // Full refund of ₹2,000 items + ₹80 delivery.
    expect(
      refundSplit({
        itemsSubtotalPaise: 200000,
        itemsRefundedBeforePaise: 0,
        refundPaise: 208000,
        itemsPartPaise: 200000,
      }),
    ).toEqual({ commissionReversalPaise: 20000, sellerPayableReversalPaise: 188000 });
  });

  it('adds up exactly when an order is refunded in several parts', () => {
    const subtotal = 12345;
    let refunded = 0;
    let reversed = 0;
    for (const part of [3333, 3333, 3333, 2346]) {
      reversed += refundSplit({
        itemsSubtotalPaise: subtotal,
        itemsRefundedBeforePaise: refunded,
        refundPaise: part,
        itemsPartPaise: part,
      }).commissionReversalPaise;
      refunded += part;
    }
    expect(reversed).toBe(commissionOn(subtotal));
  });
});
