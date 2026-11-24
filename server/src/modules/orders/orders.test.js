import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { APPEAL_WINDOW_DAYS, DISPATCH_WARNING_HOURS } from '../../config/policy.js';
import { addBusinessDays, addHours } from '../../lib/clock.js';
import { createTestContext, db, registerVerifiedUser, resetDb } from '../../../test/helpers.js';
import {
  adminAction,
  buyerAction,
  buyerView,
  ledgerTotals,
  paidOrder,
  registerAdmin,
  sellerAction,
  sellerView,
  sendWebhook,
  signInAgain,
} from '../../../test/orders.js';
import { PNG } from '../../../test/listings.js';
import { adminDispute, runDisputeJobs } from '../../../test/disputes.js';
import { runOrderJobs } from './order.jobs.js';

const API = '/api/v1';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const jobs = (ctx) => runOrderJobs(ctx.app.locals.deps);

describe('who can see and do what', () => {
  it('only the buyer and seller of an order can see it, each from their side', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await paidOrder(ctx);
    const stranger = await registerVerifiedUser(ctx);

    for (const path of [`/me/orders/${order.id}`, `/me/sales/${order.id}`]) {
      expect((await request(ctx.app).get(`${API}${path}`).set(stranger.bearer)).status).toBe(404);
    }
    expect(
      (await request(ctx.app).get(`${API}/me/sales/${order.id}`).set(buyer.bearer)).status,
    ).toBe(404);
    expect(
      (await request(ctx.app).get(`${API}/me/orders/${order.id}`).set(seller.bearer)).status,
    ).toBe(404);
    expect((await sellerAction(ctx, buyer, order.id, 'dispatch')).status).toBe(404);
    expect((await buyerAction(ctx, seller, order.id, 'cancel')).status).toBe(404);
    expect((await request(ctx.app).get(`${API}/me/orders/${order.id}`)).status).toBe(401);
  });

  it('admin actions need the admin role', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await paidOrder(ctx);

    for (const account of [seller, buyer]) {
      const res = await adminAction(ctx, account, order.id, 'cancel', {
        reason: 'Trying to cheat',
      });
      expect(res.status).toBe(403);
    }
    expect((await request(ctx.app).get(`${API}/admin/orders`).set(buyer.bearer)).status).toBe(403);
    expect((await db.order.findUnique({ where: { id: order.id } })).status).toBe(
      'AWAITING_DISPATCH',
    );
  });

  it('the seller sees the delivery address and buyer’s phone, and money they will receive', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await paidOrder(ctx);

    const forSeller = await sellerView(ctx, seller, order.id);
    expect(forSeller.deliveryAddress).toMatchObject({
      line1: '12, 3rd Cross, HAL 2nd Stage',
      pincode: '560038',
    });
    expect(forSeller.buyer.phone).toBe(buyer.details.phone);
    expect(forSeller).toMatchObject({
      commissionPaise: 12000,
      sellerPayablePaise: 116000,
      payoutEligible: false,
    });

    const forBuyer = await buyerView(ctx, buyer, order.id);
    expect(forBuyer.seller.phone).toBe(seller.details.phone);
    expect(forBuyer).not.toHaveProperty('commissionPaise');
  });

  it('pickup buyers get the exact spot; contact details stop once the order ends', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order, listing } = await paidOrder(ctx, { fulfilment: 'PICKUP' });

    const before = await buyerView(ctx, buyer, order.id);
    expect(before.items[0].pickup).toEqual({
      lat: listing.pinLat,
      lng: listing.pinLng,
      locality: 'Indiranagar',
    });

    await buyerAction(ctx, buyer, order.id, 'cancel');
    const after = await buyerView(ctx, buyer, order.id);
    expect(after.items[0].pickup).toBeNull();
    expect(after.seller.phone).toBeNull();
    expect((await sellerView(ctx, seller, order.id)).buyer.phone).toBeNull();
  });
});

describe('seller steps', () => {
  it('a seller can cancel before dispatch with a reason; the buyer is refunded and stock returns', async () => {
    const ctx = createTestContext();
    const { seller, order, listing } = await paidOrder(ctx);

    expect((await sellerAction(ctx, seller, order.id, 'cancel')).status).toBe(400);
    const res = await sellerAction(ctx, seller, order.id, 'cancel', {
      reason: 'Found a stain while packing',
    });

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('CANCELLED');
    expect((await db.refund.findFirstOrThrow()).reason).toBe('SELLER_CANCELLED');
    expect((await db.listing.findUnique({ where: { id: listing.id } })).quantity).toBe(1);
  });

  it('dispatching records the courier reference and tells the buyer', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await paidOrder(ctx);

    const res = await sellerAction(ctx, seller, order.id, 'dispatch', {
      courierReference: 'DTDC 7788',
    });

    expect(res.body.order).toMatchObject({ status: 'DISPATCHED', courierReference: 'DTDC 7788' });
    expect(ctx.lastEmailTo(buyer.details.email).text).toContain('DTDC 7788');
    expect((await sellerAction(ctx, seller, order.id, 'dispatch')).status).toBe(409);
  });

  it('an extension needs the buyer’s yes, and resets the deadline', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await paidOrder(ctx);
    const originalDue = order.dispatchDueAt;

    const asked = await sellerAction(ctx, seller, order.id, 'extension', { businessDays: 2 });
    expect(asked.body.order.extension.status).toBe('REQUESTED');
    expect(
      (await sellerAction(ctx, seller, order.id, 'extension', { businessDays: 1 })).status,
    ).toBe(409);
    expect((await buyerView(ctx, buyer, order.id)).actions).toContain('extension');

    const accepted = await buyerAction(ctx, buyer, order.id, 'extension', { accept: true });
    expect(accepted.body.order.extension.status).toBe('ACCEPTED');
    expect(new Date(accepted.body.order.dispatchDueAt)).toEqual(addBusinessDays(originalDue, 2));

    // At the original deadline nothing is overdue any more.
    ctx.clock.set(originalDue);
    await jobs(ctx);
    expect(
      (await buyerView(ctx, await signInAgain(ctx, buyer), order.id)).cancellationOffered,
    ).toBe(false);
  });

  it('reminds the seller a day before the dispatch deadline, once', async () => {
    const ctx = createTestContext();
    const { seller, order } = await paidOrder(ctx);

    ctx.clock.set(addHours(order.dispatchDueAt, -DISPATCH_WARNING_HOURS));
    expect((await jobs(ctx)).dispatchReminders).toBe(1);
    expect((await jobs(ctx)).dispatchReminders).toBe(0);
    expect(ctx.lastEmailTo(seller.details.email).subject).toMatch(/send order/i);
  });
});

describe('admin decisions', () => {
  // Admin decisions now go through the dispute and take effect after the appeal
  // window (I81); these check the money once they have.
  async function decideAndWait(ctx, admin, orderId, body) {
    const dispute = await db.dispute.findFirstOrThrow({ where: { orderId } });
    const res = await adminDispute(ctx, await signInAgain(ctx, admin), dispute.id, 'decide', body);
    ctx.clock.advance({ days: APPEAL_WINDOW_DAYS });
    await runDisputeJobs(ctx);
    return res;
  }

  it('a parcel lost in transit is refunded and not put back on sale', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order, listing } = await paidOrder(ctx);
    const admin = await registerAdmin(ctx);
    await sellerAction(ctx, seller, order.id, 'deliver');
    await buyerAction(ctx, buyer, order.id, 'not-received', { reason: 'Nothing came' });

    // An open dispute is decided, not cancelled around.
    const blocked = await adminAction(ctx, admin, order.id, 'cancel', {
      reason: 'Courier lost it',
    });
    expect(blocked.body.error.code).toBe('DISPUTE_OPEN');
    await decideAndWait(ctx, admin, order.id, {
      outcome: 'REFUND',
      reason: 'Courier lost the parcel',
    });

    expect((await db.order.findUnique({ where: { id: order.id } })).status).toBe('CANCELLED');
    expect((await db.refund.findFirstOrThrow()).reason).toBe('NOT_DELIVERED');
    expect((await db.listing.findUnique({ where: { id: listing.id } })).quantity).toBe(0);
    expect(await ledgerTotals({ orderId: order.id })).toMatchObject({
      BUYER_REFUND: 128000,
      COMMISSION_REVERSAL: 12000,
      SELLER_PAYABLE_REVERSAL: 116000,
    });
  });

  it('a full refund for an issue returns everything; a rejection completes the order', async () => {
    const ctx = createTestContext();
    const admin = await registerAdmin(ctx);
    const report = async () => {
      const paid = await paidOrder(ctx);
      await sellerAction(ctx, paid.seller, paid.order.id, 'deliver');
      await buyerAction(ctx, paid.buyer, paid.order.id, 'confirm');
      await request(ctx.app)
        .post(`${API}/me/orders/${paid.order.id}/issue`)
        .set(paid.buyer.bearer)
        .field(
          'data',
          JSON.stringify({ kind: 'WRONG_ITEM', description: 'This is a different kurta.' }),
        )
        .attach('photos', PNG, 'photo.png');
      return paid;
    };

    const full = await report();
    const rejected = await report();
    await decideAndWait(ctx, admin, full.order.id, {
      outcome: 'FULL_REFUND',
      reason: 'Wrong item sent, confirmed from photos',
    });
    const refunded = await db.order.findUnique({ where: { id: full.order.id } });
    expect(refunded.status).toBe('REFUNDED');
    expect(refunded.refundedPaise).toBe(128000);

    await decideAndWait(ctx, admin, rejected.order.id, {
      outcome: 'REJECTED',
      reason: 'Photos show the item as described',
    });
    // Rejected within the 7-day window: the order is back to received.
    expect((await db.order.findUnique({ where: { id: rejected.order.id } })).status).toBe(
      'DELIVERED',
    );
    expect(await db.refund.count({ where: { orderId: rejected.order.id } })).toBe(0);
    expect(await db.adminAuditLog.count()).toBe(2);
  });

  it('refuses a partial refund of the whole amount or nothing', async () => {
    const ctx = createTestContext();
    const admin = await registerAdmin(ctx);
    const { seller, buyer, order } = await paidOrder(ctx);
    await sellerAction(ctx, seller, order.id, 'deliver');
    await buyerAction(ctx, buyer, order.id, 'confirm');
    await request(ctx.app)
      .post(`${API}/me/orders/${order.id}/issue`)
      .set(buyer.bearer)
      .field('data', JSON.stringify({ kind: 'DAMAGED', description: 'Torn along the hem.' }))
      .attach('photos', PNG, 'photo.png');
    const dispute = await db.dispute.findFirstOrThrow({ where: { orderId: order.id } });
    const resolve = (refundPaise) =>
      adminDispute(ctx, admin, dispute.id, 'decide', {
        outcome: 'PARTIAL_REFUND',
        refundPaise,
        reason: 'Partial refund agreed',
      });

    expect((await resolve(120000)).status).toBe(400);
    expect((await resolve(0)).status).toBe(400);
    expect((await db.order.findUnique({ where: { id: order.id } })).status).toBe('ISSUE_OPEN');
  });

  it('an issue needs at least one photo', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await paidOrder(ctx);
    await sellerAction(ctx, seller, order.id, 'deliver');
    await buyerAction(ctx, buyer, order.id, 'confirm');

    const res = await request(ctx.app)
      .post(`${API}/me/orders/${order.id}/issue`)
      .set(buyer.bearer)
      .field('data', JSON.stringify({ kind: 'DAMAGED', description: 'Torn along the hem.' }));

    expect(res.status).toBe(400);
    expect((await db.order.findUnique({ where: { id: order.id } })).status).toBe('DELIVERED');
  });
});

describe('refunds that do not go through at once', () => {
  it('a refund the gateway refuses is retried with the same reference, and paid once', async () => {
    const ctx = createTestContext();
    const { buyer, order } = await paidOrder(ctx);
    ctx.gateway.refundOutcome = 'error';

    await buyerAction(ctx, buyer, order.id, 'cancel');
    const pending = await db.refund.findFirstOrThrow();
    expect(pending).toMatchObject({ status: 'PENDING', attempts: 1, gatewayRefundId: null });
    expect(await ledgerTotals({ orderId: order.id })).not.toHaveProperty('BUYER_REFUND');

    ctx.gateway.refundOutcome = 'processed';
    ctx.clock.advance({ minutes: 1 });
    expect((await jobs(ctx)).refundsRetried).toBe(0);
    ctx.clock.advance({ minutes: 2 });
    expect((await jobs(ctx)).refundsRetried).toBe(1);

    expect((await db.refund.findFirstOrThrow()).status).toBe('PROCESSED');
    expect(ctx.gateway.refunds).toHaveLength(1);
    expect((await ledgerTotals({ orderId: order.id })).BUYER_REFUND).toBe(128000);
  });

  it('a pending refund is completed by the gateway’s webhook, once', async () => {
    const ctx = createTestContext();
    const { buyer, order } = await paidOrder(ctx);
    ctx.gateway.refundOutcome = 'pending';

    await buyerAction(ctx, buyer, order.id, 'cancel');
    const refund = await db.refund.findFirstOrThrow();
    expect(refund.status).toBe('PENDING');
    const entity = { ...ctx.gateway.refunds[0], status: 'processed' };

    for (const eventId of ['evt_r1', 'evt_r1', 'evt_r2']) {
      expect((await sendWebhook(ctx, { event: 'refund.processed', entity, eventId })).status).toBe(
        200,
      );
    }

    expect((await db.refund.findFirstOrThrow()).status).toBe('PROCESSED');
    const rows = await db.ledgerEntry.findMany({ where: { refundId: refund.id } });
    expect(rows.map((row) => row.type).sort()).toEqual([
      'BUYER_REFUND',
      'COMMISSION_REVERSAL',
      'SELLER_PAYABLE_REVERSAL',
    ]);
  });
});

describe('money adds up', () => {
  it('payments equal commission plus seller payables, and refunds equal reversals', async () => {
    const ctx = createTestContext();
    const admin = await registerAdmin(ctx);
    const orders = [];
    for (let i = 0; i < 3; i += 1)
      orders.push(await paidOrder(ctx, { listing: { pricePaise: 99999 + i * 1111 } }));
    await buyerAction(ctx, orders[0].buyer, orders[0].order.id, 'cancel');
    const third = orders[2];
    await sellerAction(ctx, third.seller, third.order.id, 'deliver');
    await buyerAction(ctx, third.buyer, third.order.id, 'confirm');
    await request(ctx.app)
      .post(`${API}/me/orders/${third.order.id}/issue`)
      .set(third.buyer.bearer)
      .field('data', JSON.stringify({ kind: 'DAMAGED', description: 'Button missing.' }))
      .attach('photos', PNG, 'photo.png');
    const dispute = await db.dispute.findFirstOrThrow({ where: { orderId: third.order.id } });
    const decided = await adminDispute(ctx, admin, dispute.id, 'decide', {
      outcome: 'PARTIAL_REFUND',
      refundPaise: 33333,
      reason: 'Missing button, partial refund',
    });
    expect(decided.status).toBe(200);
    ctx.clock.advance({ days: APPEAL_WINDOW_DAYS });
    await runDisputeJobs(ctx);
    expect((await db.order.findUnique({ where: { id: third.order.id } })).refundedPaise).toBe(
      33333,
    );

    const t = await ledgerTotals({});
    expect(t.BUYER_PAYMENT).toBe(t.COMMISSION + t.SELLER_PAYABLE);
    expect(t.BUYER_REFUND).toBe(t.COMMISSION_REVERSAL + t.SELLER_PAYABLE_REVERSAL);
    const ordersNow = await db.order.findMany();
    for (const order of ordersNow) {
      const rows = await ledgerTotals({ orderId: order.id });
      expect(rows.COMMISSION + rows.SELLER_PAYABLE).toBe(order.totalPaise);
      expect(rows.BUYER_REFUND ?? 0).toBe(order.refundedPaise);
    }
  });
});
