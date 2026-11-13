// The nine checks the build playbook asks for in Step 5, written before the code.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  HANDOVER_MAX_ATTEMPTS,
  RECEIPT_WINDOW_HOURS,
  ISSUE_REPORT_WINDOW_DAYS,
} from '../../config/policy.js';
import { addBusinessDays } from '../../lib/clock.js';
import { createTestContext, db, registerVerifiedUser, resetDb } from '../../../test/helpers.js';
import {
  addToCart,
  adminAction,
  buyerAction,
  buyerView,
  ledgerTotals,
  paidOrder,
  payCheckout,
  registerAdmin,
  saveAddress,
  sellable,
  sellerAction,
  sellerView,
  sendWebhook,
  signInAgain,
  startCheckout,
} from '../../../test/orders.js';
import { PNG } from '../../../test/listings.js';
import { runOrderJobs } from './order.jobs.js';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const jobs = (ctx) => runOrderJobs(ctx.app.locals.deps);

describe('1. overselling', () => {
  it('10 concurrent checkouts for a quantity-1 listing: exactly one succeeds', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await sellable(seller);
    const buyers = [];
    for (let i = 0; i < 10; i += 1) {
      const buyer = await registerVerifiedUser(ctx);
      await addToCart(ctx, buyer, listing.id);
      buyers.push(buyer);
    }

    const results = await Promise.all(
      buyers.map((buyer) =>
        startCheckout(ctx, buyer, [{ sellerId: seller.user.id, fulfilment: 'PICKUP' }]),
      ),
    );

    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    const refused = results.filter((res) => res.status !== 201);
    expect(refused).toHaveLength(9);
    expect(
      refused.every((res) => res.status === 409 && res.body.error.code === 'OUT_OF_STOCK'),
    ).toBe(true);
    const row = await db.listing.findUnique({ where: { id: listing.id } });
    expect(row.quantity).toBe(0);
    expect(await db.checkout.count({ where: { status: 'OPEN' } })).toBe(1);
  });
});

describe('2. duplicate webhooks', () => {
  it('the same webhook delivered 3 times creates one order and one set of ledger rows', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const buyer = await registerVerifiedUser(ctx);
    const listing = await sellable(seller);
    await addToCart(ctx, buyer, listing.id);
    const { body } = await startCheckout(ctx, buyer, [
      { sellerId: seller.user.id, fulfilment: 'PICKUP' },
    ]);
    const entity = ctx.gateway.pay(body.checkout.payment.gatewayOrderId);

    const deliveries = [];
    for (let i = 0; i < 3; i += 1) {
      deliveries.push(
        await sendWebhook(ctx, { event: 'payment.captured', entity, eventId: 'evt_1' }),
      );
    }
    // The gateway also sends a differently named event for the same payment, and the
    // browser reports it too: neither may add anything.
    await sendWebhook(ctx, { event: 'order.paid', entity, eventId: 'evt_2' });
    await request(ctx.app)
      .post(`/api/v1/checkouts/${body.checkout.id}/verify`)
      .set(buyer.bearer)
      .send({
        gatewayOrderId: entity.order_id,
        gatewayPaymentId: entity.id,
        signature: ctx.gateway.paymentSignature(entity.order_id, entity.id),
      });

    expect(deliveries.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(await db.order.count()).toBe(1);
    expect(await db.payment.count()).toBe(1);
    expect(await db.paymentEvent.count()).toBe(2);
    const rows = await db.ledgerEntry.findMany();
    // The gateway's fee is the platform's own cost, recorded once like the rest.
    expect(rows.map((row) => row.type).sort()).toEqual([
      'BUYER_PAYMENT',
      'COMMISSION',
      'GATEWAY_FEE',
      'SELLER_PAYABLE',
    ]);
  });
});

describe('3. webhook signatures', () => {
  it('a webhook with a bad signature is rejected', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const buyer = await registerVerifiedUser(ctx);
    const listing = await sellable(seller);
    await addToCart(ctx, buyer, listing.id);
    const { body } = await startCheckout(ctx, buyer, [
      { sellerId: seller.user.id, fulfilment: 'PICKUP' },
    ]);
    const entity = ctx.gateway.pay(body.checkout.payment.gatewayOrderId);

    const forged = await sendWebhook(ctx, {
      event: 'payment.captured',
      entity,
      signature: 'f'.repeat(64),
    });
    const missing = await request(ctx.app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(ctx.gateway.webhookBody('payment.captured', entity)));

    expect(forged.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(await db.order.count()).toBe(0);
    expect(await db.paymentEvent.count()).toBe(0);
    expect(await db.ledgerEntry.count()).toBe(0);
  });
});

describe('4. multi-seller checkout', () => {
  it('a two-seller cart creates two seller orders; commission is 10% of items only', async () => {
    const ctx = createTestContext();
    const sellerA = await registerVerifiedUser(ctx);
    const sellerB = await registerVerifiedUser(ctx);
    const buyer = await registerVerifiedUser(ctx);
    const kurta = await sellable(sellerA, { pricePaise: 120000, deliveryChargePaise: 8000 });
    const scarf = await sellable(sellerA, { pricePaise: 80000, deliveryChargePaise: 5000 });
    const bag = await sellable(sellerB, { pricePaise: 50000 });
    for (const listing of [kurta, scarf, bag]) await addToCart(ctx, buyer, listing.id);
    const address = await saveAddress(ctx, buyer);

    const started = await startCheckout(ctx, buyer, [
      { sellerId: sellerA.user.id, fulfilment: 'DELIVERY', addressId: address.id },
      { sellerId: sellerB.user.id, fulfilment: 'PICKUP' },
    ]);
    expect(started.status).toBe(201);
    // Items ₹2,000 + delivery ₹80 (the highest of the two charges) + ₹500 pickup.
    expect(started.body.checkout.totalPaise).toBe(258000);
    await payCheckout(ctx, started.body.checkout);

    const orders = await db.order.findMany({ where: { checkoutId: started.body.checkout.id } });
    expect(orders).toHaveLength(2);
    const a = orders.find((order) => order.sellerId === sellerA.user.id);
    const b = orders.find((order) => order.sellerId === sellerB.user.id);
    expect(a).toMatchObject({
      itemsSubtotalPaise: 200000,
      deliveryChargePaise: 8000,
      totalPaise: 208000,
      commissionPaise: 20000,
      sellerPayablePaise: 188000,
      status: 'AWAITING_DISPATCH',
    });
    expect(b).toMatchObject({
      itemsSubtotalPaise: 50000,
      deliveryChargePaise: 0,
      commissionPaise: 5000,
      sellerPayablePaise: 45000,
      status: 'AWAITING_PICKUP',
    });
    expect(await ledgerTotals({ checkoutId: started.body.checkout.id })).toEqual({
      BUYER_PAYMENT: 258000,
      COMMISSION: 25000,
      SELLER_PAYABLE: 233000,
      // The simulated gateway charges 2%; it is the platform's cost, not the sellers'.
      GATEWAY_FEE: 5160,
    });
  });
});

describe('5. cancelling', () => {
  it('cancelling before dispatch refunds; after dispatch it is refused', async () => {
    const ctx = createTestContext();
    const first = await paidOrder(ctx);

    const cancelled = await buyerAction(ctx, first.buyer, first.order.id, 'cancel', {
      reason: 'Changed my mind',
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order.status).toBe('CANCELLED');
    const refund = await db.refund.findFirstOrThrow({ where: { orderId: first.order.id } });
    expect(refund).toMatchObject({ status: 'PROCESSED', amountPaise: 128000 });
    expect(await ledgerTotals({ orderId: first.order.id })).toMatchObject({
      COMMISSION: 12000,
      SELLER_PAYABLE: 116000,
      BUYER_REFUND: 128000,
      COMMISSION_REVERSAL: 12000,
      SELLER_PAYABLE_REVERSAL: 116000,
    });
    // The stock goes back on sale.
    expect((await db.listing.findUnique({ where: { id: first.listing.id } })).quantity).toBe(1);

    const second = await paidOrder(ctx);
    expect((await sellerAction(ctx, second.seller, second.order.id, 'dispatch')).status).toBe(200);
    const refused = await buyerAction(ctx, second.buyer, second.order.id, 'cancel');
    expect(refused.status).toBe(409);
    expect(await db.refund.count({ where: { orderId: second.order.id } })).toBe(0);
  });
});

describe('6. delivery confirmation', () => {
  it('a seller marking delivered does not complete the order; the buyer does', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await paidOrder(ctx);

    await sellerAction(ctx, seller, order.id, 'dispatch');
    const reported = await sellerAction(ctx, seller, order.id, 'deliver');
    expect(reported.body.order.status).toBe('DELIVERY_REPORTED');
    expect((await buyerView(ctx, buyer, order.id)).status).toBe('DELIVERY_REPORTED');

    const confirmed = await buyerAction(ctx, buyer, order.id, 'confirm');
    expect(confirmed.body.order.status).toBe('DELIVERED');
  });

  it('after 48 hours without an answer it goes to admin review, never completes on its own', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await paidOrder(ctx);
    const admin = await registerAdmin(ctx);
    await sellerAction(ctx, seller, order.id, 'deliver');

    ctx.clock.advance({ hours: RECEIPT_WINDOW_HOURS - 1 });
    await jobs(ctx);
    expect((await db.order.findUnique({ where: { id: order.id } })).status).toBe(
      'DELIVERY_REPORTED',
    );

    ctx.clock.advance({ hours: 1 });
    await jobs(ctx);
    expect((await db.order.findUnique({ where: { id: order.id } })).status).toBe('ADMIN_REVIEW');

    // Much later, still in review: nothing completes it automatically.
    ctx.clock.advance({ days: 30 });
    await jobs(ctx);
    expect((await db.order.findUnique({ where: { id: order.id } })).status).toBe('ADMIN_REVIEW');

    const fresh = await signInAgain(ctx, admin);
    const noReason = await adminAction(ctx, fresh, order.id, 'verify-delivery', {});
    expect(noReason.status).toBe(400);
    const verified = await adminAction(ctx, fresh, order.id, 'verify-delivery', {
      reason: 'Courier proof of delivery checked',
    });
    expect(verified.status).toBe(200);
    expect(verified.body.order.status).toBe('DELIVERED');
    expect(await db.adminAuditLog.count({ where: { targetId: order.id } })).toBe(1);
    expect((await buyerView(ctx, await signInAgain(ctx, buyer), order.id)).status).toBe(
      'DELIVERED',
    );
  });
});

describe('7. pickup handover', () => {
  it('local pickup completes only with the correct one-time handover code', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await paidOrder(ctx, { fulfilment: 'PICKUP' });
    const { handoverCode } = await buyerView(ctx, buyer, order.id);
    expect(handoverCode).toMatch(/^\d{6}$/);
    expect(await sellerView(ctx, seller, order.id)).not.toHaveProperty('handoverCode');

    const wrong = handoverCode === '000000' ? '000001' : '000000';
    const refused = await sellerAction(ctx, seller, order.id, 'handover', { code: wrong });
    expect(refused.status).toBe(400);
    expect((await db.order.findUnique({ where: { id: order.id } })).status).toBe('AWAITING_PICKUP');

    const accepted = await sellerAction(ctx, seller, order.id, 'handover', { code: handoverCode });
    expect(accepted.status).toBe(200);
    expect(accepted.body.order.status).toBe('DELIVERED');
    const again = await sellerAction(ctx, seller, order.id, 'handover', { code: handoverCode });
    expect(again.status).toBe(409);
  });

  it('locks the code after too many wrong tries', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await paidOrder(ctx, { fulfilment: 'PICKUP' });
    const { handoverCode } = await buyerView(ctx, buyer, order.id);
    const wrong = handoverCode === '000000' ? '000001' : '000000';

    for (let i = 0; i < HANDOVER_MAX_ATTEMPTS; i += 1) {
      await sellerAction(ctx, seller, order.id, 'handover', { code: wrong });
    }
    const locked = await sellerAction(ctx, seller, order.id, 'handover', { code: handoverCode });

    expect(locked.status).toBe(429);
    expect((await db.order.findUnique({ where: { id: order.id } })).status).toBe('AWAITING_PICKUP');
  });
});

describe('8. issues after delivery', () => {
  async function deliveredOrder(ctx) {
    const paid = await paidOrder(ctx);
    await sellerAction(ctx, paid.seller, paid.order.id, 'deliver');
    await buyerAction(ctx, paid.buyer, paid.order.id, 'confirm');
    return paid;
  }

  function reportIssue(ctx, buyer, orderId) {
    return request(ctx.app)
      .post(`/api/v1/me/orders/${orderId}/issue`)
      .set(buyer.bearer)
      .field(
        'data',
        JSON.stringify({ kind: 'DAMAGED', description: 'A seam is torn at the shoulder.' }),
      )
      .attach('photos', PNG, 'tear.png');
  }

  it('an issue within 7 days opens a dispute and blocks payout; a refund reverses commission', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await deliveredOrder(ctx);
    const admin = await registerAdmin(ctx);

    ctx.clock.advance({ days: ISSUE_REPORT_WINDOW_DAYS - 1 });
    const fresh = await signInAgain(ctx, buyer);
    const reported = await reportIssue(ctx, fresh, order.id);
    expect(reported.status).toBe(201);
    expect(reported.body.order.status).toBe('ISSUE_OPEN');

    // The window closes, but an open issue keeps the order from completing.
    ctx.clock.advance({ days: 2 });
    await jobs(ctx);
    const blocked = await sellerView(ctx, await signInAgain(ctx, seller), order.id);
    expect(blocked.status).toBe('ISSUE_OPEN');
    expect(blocked.payoutEligible).toBe(false);

    const resolved = await adminAction(
      ctx,
      await signInAgain(ctx, admin),
      order.id,
      'resolve-issue',
      {
        resolution: 'PARTIAL_REFUND',
        refundPaise: 50000,
        reason: 'Damage confirmed from photos; seller agreed to a partial refund',
      },
    );
    expect(resolved.status).toBe(200);
    expect(resolved.body.order.status).toBe('COMPLETED');
    expect(await ledgerTotals({ orderId: order.id })).toMatchObject({
      COMMISSION: 12000,
      BUYER_REFUND: 50000,
      COMMISSION_REVERSAL: 5000,
      SELLER_PAYABLE_REVERSAL: 45000,
    });
  });

  it('refuses an issue after the 7 days', async () => {
    const ctx = createTestContext();
    const { buyer, order } = await deliveredOrder(ctx);

    ctx.clock.advance({ days: ISSUE_REPORT_WINDOW_DAYS, minutes: 1 });
    const late = await reportIssue(ctx, await signInAgain(ctx, buyer), order.id);

    expect(late.status).toBe(409);
  });
});

describe('9. dispatch deadline', () => {
  it('a missed 3-business-day dispatch deadline offers the buyer a cancellation', async () => {
    const ctx = createTestContext();
    const { buyer, order } = await paidOrder(ctx);
    const before = await buyerView(ctx, buyer, order.id);
    expect(before.cancellationOffered).toBe(false);
    expect(new Date(before.dispatchDueAt)).toEqual(addBusinessDays(order.createdAt, 3));

    ctx.clock.set(addBusinessDays(order.createdAt, 3));
    await jobs(ctx);

    const after = await buyerView(ctx, await signInAgain(ctx, buyer), order.id);
    expect(after.status).toBe('AWAITING_DISPATCH');
    expect(after.cancellationOffered).toBe(true);
    expect(after.actions).toContain('cancel');
    expect(ctx.lastEmailTo(buyer.details.email).subject).toMatch(/not been sent/i);
  });
});
