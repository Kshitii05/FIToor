// Reviews and reports (Step 8), written before the code.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { REVIEW_WINDOW_DAYS } from '../../config/policy.js';
import { createTestContext, db, registerVerifiedUser, resetDb } from '../../../test/helpers.js';
import { completedOrder, deliveredOrder } from '../../../test/disputes.js';
import { registerAdmin, sellable, signInAgain } from '../../../test/orders.js';
import { PNG } from '../../../test/listings.js';
import { sendMessage, startChat } from '../../../test/messaging.js';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const API = '/api/v1';
const ratings = { overall: 5, communication: 4, handover: 5, condition: 4 };

function review(ctx, account, data, photos = 0) {
  const req = request(ctx.app)
    .post(`${API}/reviews`)
    .set(account.bearer)
    .field('data', JSON.stringify(data));
  for (let i = 0; i < photos; i += 1) req.attach('photos', PNG, `review-${i}.png`);
  return req;
}

const report = (ctx, account, body) =>
  request(ctx.app).post(`${API}/reports`).set(account.bearer).send(body);

describe('reviews', () => {
  it('only after a completed transaction, once per person, and both sides can review', async () => {
    const ctx = createTestContext();
    const early = await deliveredOrder(ctx);
    expect(
      (await review(ctx, early.buyer, { orderId: early.order.id, ...ratings })).body.error.code,
    ).toBe('NOT_REVIEWABLE');

    const { seller, buyer, order } = await completedOrder(ctx);
    const stranger = await signInAgain(ctx, await registerVerifiedUser(ctx));
    const first = await review(
      ctx,
      buyer,
      { orderId: order.id, ...ratings, text: 'Lovely kurta.' },
      2,
    );
    expect(first.status).toBe(201);
    expect(first.body.review).toMatchObject({ overall: 5, verified: true, authorRole: 'BUYER' });
    expect(first.body.review.photos).toHaveLength(2);
    expect((await review(ctx, buyer, { orderId: order.id, ...ratings })).body.error.code).toBe(
      'ALREADY_REVIEWED',
    );
    expect((await review(ctx, stranger, { orderId: order.id, ...ratings })).status).toBe(404);

    // A seller reviewing a buyer is not asked about the item's condition.
    expect((await review(ctx, seller, { orderId: order.id, ...ratings })).status).toBe(400);
    const { condition, ...noCondition } = ratings;
    expect(condition).toBe(4);
    expect((await review(ctx, seller, { orderId: order.id, ...noCondition })).status).toBe(201);

    expect((await review(ctx, buyer, { orderId: order.id, ...ratings, overall: 6 })).status).toBe(
      400,
    );
  });

  it('the database refuses a second review even if two arrive at once', async () => {
    const ctx = createTestContext();
    const { buyer, order } = await completedOrder(ctx);
    const results = await Promise.all(
      [1, 2, 3].map(() => review(ctx, buyer, { orderId: order.id, ...ratings })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await db.review.count()).toBe(1);
  });

  it('closes 30 days after completion', async () => {
    const ctx = createTestContext();
    let { buyer, order } = await completedOrder(ctx);
    ctx.clock.advance({ days: REVIEW_WINDOW_DAYS });
    buyer = await signInAgain(ctx, buyer);
    expect((await review(ctx, buyer, { orderId: order.id, ...ratings })).body.error.code).toBe(
      'NOT_REVIEWABLE',
    );
  });

  it('shows on the public profile with averages; hidden reviews drop out; pending ones are listed', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await completedOrder(ctx);
    const pending = await request(ctx.app).get(`${API}/me/reviews/pending`).set(buyer.bearer);
    expect(pending.body.items).toHaveLength(1);
    expect(pending.body.items[0]).toMatchObject({
      orderId: order.id,
      subject: { id: seller.user.id },
    });

    const made = await review(ctx, buyer, { orderId: order.id, ...ratings, overall: 4 });
    const pub = await request(ctx.app).get(`${API}/users/${seller.user.id}/reviews`);
    expect(pub.status).toBe(200);
    expect(pub.body.summary).toMatchObject({ count: 1, overall: 4 });
    expect(pub.body.items[0].author).not.toHaveProperty('email');
    expect(
      (await request(ctx.app).get(`${API}/me/reviews/pending`).set(buyer.bearer)).body.items,
    ).toHaveLength(0);

    const admin = await registerAdmin(ctx);
    const hideUrl = `${API}/admin/reviews/${made.body.review.id}/hide`;
    expect((await request(ctx.app).post(hideUrl).set(admin.bearer).send({})).status).toBe(400);
    expect(
      (await request(ctx.app).post(hideUrl).set(buyer.bearer).send({ reason: 'Abusive language' }))
        .status,
    ).toBe(403);
    expect(
      (await request(ctx.app).post(hideUrl).set(admin.bearer).send({ reason: 'Abusive language' }))
        .status,
    ).toBe(200);
    const after = await request(ctx.app).get(`${API}/users/${seller.user.id}/reviews`);
    expect(after.body.summary.count).toBe(0);
    expect(after.body.items).toHaveLength(0);
    expect(await db.adminAuditLog.count({ where: { targetId: made.body.review.id } })).toBe(1);
  });
});

describe('reports', () => {
  it("a listing can be reported once while the report is open, never one's own", async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await sellable(seller);
    const someone = await registerVerifiedUser(ctx);
    const body = {
      targetType: 'LISTING',
      targetId: listing.id,
      reason: 'COUNTERFEIT',
      details: 'Fake logo',
    };
    expect((await report(ctx, someone, body)).status).toBe(201);
    expect((await report(ctx, someone, body)).body.error.code).toBe('ALREADY_REPORTED');
    expect((await report(ctx, seller, body)).status).toBe(400);
    // Reporting does not hide anything by itself.
    expect((await db.listing.findUnique({ where: { id: listing.id } })).status).toBe('ACTIVE');
  });

  it('a message can be reported only by the other person in its chat', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const buyer = await registerVerifiedUser(ctx);
    const listing = await sellable(seller);
    const chat = (await startChat(ctx, buyer, { listingId: listing.id })).body.conversation;
    const message = (await sendMessage(ctx, buyer, chat.id, { body: 'Pay me outside the app' }))
      .body.message;
    const stranger = await registerVerifiedUser(ctx);
    const body = { targetType: 'MESSAGE', targetId: message.id, reason: 'SCAM' };
    expect((await report(ctx, stranger, body)).status).toBe(404);
    expect((await report(ctx, buyer, body)).status).toBe(400);
    expect((await report(ctx, seller, body)).status).toBe(201);
  });

  it('a reported review stays published until an admin hides it through the report', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await completedOrder(ctx);
    const made = (await review(ctx, buyer, { orderId: order.id, ...ratings, text: 'Rude seller' }))
      .body.review;
    const filed = await report(ctx, seller, {
      targetType: 'REVIEW',
      targetId: made.id,
      reason: 'HARASSMENT',
    });
    expect(filed.status).toBe(201);
    expect((await db.review.findUnique({ where: { id: made.id } })).status).toBe('PUBLISHED');

    const admin = await registerAdmin(ctx);
    const queue = await request(ctx.app).get(`${API}/admin/reports?status=OPEN`).set(admin.bearer);
    expect(queue.body.items.map((r) => r.id)).toContain(filed.body.report.id);
    const resolved = await request(ctx.app)
      .post(`${API}/admin/reports/${filed.body.report.id}/resolve`)
      .set(admin.bearer)
      .send({ action: 'HIDE_REVIEW', reason: 'Personal attack, not about the order' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.report.status).toBe('ACTIONED');
    expect((await db.review.findUnique({ where: { id: made.id } })).status).toBe('HIDDEN');
  });

  it('an admin can remove a reported listing or dismiss a report; others cannot', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await sellable(seller);
    const one = await registerVerifiedUser(ctx);
    const two = await registerVerifiedUser(ctx);
    const a = (
      await report(ctx, one, {
        targetType: 'LISTING',
        targetId: listing.id,
        reason: 'PROHIBITED_ITEM',
      })
    ).body.report;
    const b = (
      await report(ctx, two, { targetType: 'USER', targetId: seller.user.id, reason: 'SPAM' })
    ).body.report;
    const admin = await registerAdmin(ctx);

    const resolve = (account, id, body) =>
      request(ctx.app).post(`${API}/admin/reports/${id}/resolve`).set(account.bearer).send(body);
    expect((await resolve(one, a.id, { action: 'DISMISS', reason: 'Not allowed' })).status).toBe(
      403,
    );
    expect(
      (
        await resolve(admin, a.id, {
          action: 'REMOVE_LISTING',
          reason: 'Sale of a prohibited item',
        })
      ).status,
    ).toBe(200);
    expect((await db.listing.findUnique({ where: { id: listing.id } })).status).toBe('REMOVED');
    const dismissed = await resolve(admin, b.id, { action: 'DISMISS', reason: 'No sign of spam' });
    expect(dismissed.body.report.status).toBe('DISMISSED');
    expect(await db.adminAuditLog.count({ where: { action: { in: ['RESOLVE_REPORT'] } } })).toBe(2);
  });
});
