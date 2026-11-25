// SPEC 11 and 18: every admin action needs a written reason and leaves exactly one
// row in the append-only audit log, naming the admin and the reason. This file goes
// through every admin action in the app, across all modules.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, db, registerVerifiedUser, resetDb } from '../../../test/helpers.js';
import { completedOrder, deliveredOrder, reportIssue } from '../../../test/disputes.js';
import { insertListing } from '../../../test/listings.js';
import {
  buyerAction,
  buyerView,
  paidOrder,
  registerAdmin,
  sellerAction,
  signInAgain,
} from '../../../test/orders.js';
import { BANK, saveBank } from '../../../test/payouts.js';
import { bookingUpTo } from '../../../test/rentals.js';
import { markRefundFailed } from '../payments/refunds.service.js';

const API = '/api/v1';
const ID = '00000000-0000-4000-8000-000000000000';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

// Every admin action that takes a reason, as [path, extra body].
const REASONED = [
  [`/admin/orders/${ID}/verify-delivery`],
  [`/admin/orders/${ID}/cancel`],
  [`/admin/orders/${ID}/reset-handover-code`],
  [`/admin/rentals/${ID}/verify-handover`],
  [`/admin/rentals/${ID}/verify-return`],
  [`/admin/rentals/${ID}/cancel`],
  [`/admin/disputes/${ID}/decide`, { outcome: 'REJECTED' }],
  [`/admin/disputes/${ID}/decide-appeal`],
  [`/admin/reports/${ID}/resolve`, { action: 'DISMISS' }],
  [`/admin/reviews/${ID}/hide`],
  [`/admin/reviews/${ID}/show`],
  [`/admin/users/${ID}/suspend`],
  [`/admin/users/${ID}/restore`],
  [`/admin/users/${ID}/warn`],
  [`/admin/listings/${ID}/remove`],
  [`/admin/listings/${ID}/restore`],
  [`/admin/refunds/${ID}/retry`],
  [`/admin/bank-accounts/${ID}/verify`],
  [`/admin/bank-accounts/${ID}/reject`],
  [`/admin/payout-items/${ID}/failed`],
  [`/admin/payout-items/${ID}/retry`],
];

describe('admin audit log', () => {
  it('every admin action without a reason is refused, and nothing is logged', async () => {
    const ctx = createTestContext();
    const admin = await registerAdmin(ctx);
    for (const [path, extra = {}] of REASONED) {
      for (const reason of [undefined, '', '   ', 'no']) {
        const res = await request(ctx.app)
          .post(`${API}${path}`)
          .set(admin.bearer)
          .send(reason === undefined ? extra : { ...extra, reason });
        expect(res.status, `${path} with reason ${JSON.stringify(reason)}`).toBe(400);
      }
    }
    // Marking a payout paid needs the bank reference instead.
    const paid = await request(ctx.app)
      .post(`${API}/admin/payout-items/${ID}/paid`)
      .set(admin.bearer)
      .send({});
    expect(paid.status).toBe(400);
    expect(await db.adminAuditLog.count()).toBe(0);
  });

  it('every admin action that succeeds writes exactly one row with the admin and the reason', async () => {
    const ctx = createTestContext();
    let admin = await registerAdmin(ctx);
    const seen = new Set();

    /** Runs one admin action and checks it added exactly one audit row. */
    async function audited(path, body, expectedReason = body.reason) {
      // The test clock stands still, so new rows are found by id, not by time.
      const before = (await db.adminAuditLog.findMany({ select: { id: true } })).map((r) => r.id);
      const res = await request(ctx.app).post(`${API}${path}`).set(admin.bearer).send(body);
      expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
      const rows = await db.adminAuditLog.findMany({ where: { id: { notIn: before } } });
      expect(rows, path).toHaveLength(1);
      expect(rows[0]).toMatchObject({ adminId: admin.user.id, reason: expectedReason });
      seen.add(path.replace(/[0-9a-f-]{36}/g, ':id'));
      return res.body;
    }
    const reason = (text) => ({ reason: text });

    // Rentals: confirm a handover and a return by hand; cancel another booking.
    const handed = await bookingUpTo(ctx, 'confirmed');
    await audited(
      `/admin/rentals/${handed.booking.id}/verify-handover`,
      reason('Renter has the item, photos sent by chat'),
    );
    await audited(
      `/admin/rentals/${handed.booking.id}/verify-return`,
      reason('Owner confirmed by phone it came back'),
    );
    const cancelled = await bookingUpTo(ctx, 'confirmed');
    await audited(
      `/admin/rentals/${cancelled.booking.id}/cancel`,
      reason('Owner is unwell and cannot hand over'),
    );

    // Orders: unlock a pickup code, cancel, and confirm a delivery by evidence.
    const pickup = await paidOrder(ctx, { fulfilment: 'PICKUP' });
    await audited(
      `/admin/orders/${pickup.order.id}/reset-handover-code`,
      reason('Buyer mistyped the code five times'),
    );
    await audited(`/admin/orders/${pickup.order.id}/cancel`, reason('Seller cannot be reached'));
    const parcel = await paidOrder(ctx);
    await sellerAction(ctx, parcel.seller, parcel.order.id, 'dispatch');
    await sellerAction(ctx, parcel.seller, parcel.order.id, 'deliver');
    await audited(
      `/admin/orders/${parcel.order.id}/verify-delivery`,
      reason('Courier proof of delivery checked'),
    );

    // A refund the gateway reported failed, retried.
    const failing = await paidOrder(ctx);
    ctx.gateway.refundOutcome = 'pending';
    await buyerAction(ctx, failing.buyer, failing.order.id, 'cancel');
    const refund = await db.refund.findFirstOrThrow({ where: { orderId: failing.order.id } });
    await markRefundFailed(ctx.app.locals.deps, refund.gatewayRefundId, 'Card closed');
    ctx.gateway.refundOutcome = 'processed';
    await audited(`/admin/refunds/${refund.id}/retry`, reason('Buyer gave new card details'));

    // Users and listings.
    const user = await registerVerifiedUser(ctx);
    await audited(`/admin/users/${user.user.id}/warn`, reason('Please describe items honestly.'));
    await audited(`/admin/users/${user.user.id}/suspend`, reason('Repeated fake listings'));
    await audited(`/admin/users/${user.user.id}/restore`, reason('Appeal accepted'));
    const seller = await registerVerifiedUser(ctx);
    const listing = await insertListing(seller);
    await audited(`/admin/listings/${listing.id}/remove`, reason('Counterfeit label'));
    await audited(`/admin/listings/${listing.id}/restore`, reason('Seller proved it genuine'));

    // A report, resolved.
    const reported = await insertListing(seller);
    const reporter = await registerVerifiedUser(ctx);
    const report = await request(ctx.app)
      .post(`${API}/reports`)
      .set(reporter.bearer)
      .send({ targetType: 'LISTING', targetId: reported.id, reason: 'COUNTERFEIT' });
    expect(report.status).toBe(201);
    await audited(`/admin/reports/${report.body.report.id}/resolve`, {
      action: 'DISMISS',
      reason: 'Brand confirmed genuine',
    });

    // A dispute decided, appealed and the appeal decided.
    const issue = await deliveredOrder(ctx);
    await reportIssue(ctx, issue.buyer, issue.order.id);
    const dispute = await db.dispute.findFirstOrThrow({ where: { orderId: issue.order.id } });
    await audited(`/admin/disputes/${dispute.id}/decide`, {
      outcome: 'REJECTED',
      reason: 'Photos show the item as listed',
    });
    const appeal = await request(ctx.app)
      .post(`${API}/disputes/${dispute.id}/appeal`)
      .set(issue.buyer.bearer)
      .send({ reason: 'The tear is in the second photo' });
    expect(appeal.status).toBe(200);
    await audited(
      `/admin/disputes/${dispute.id}/decide-appeal`,
      reason('Second photo checked; decision stands'),
    );
    expect((await buyerView(ctx, issue.buyer, issue.order.id)).status).toBe('DELIVERED');

    // A completed order: hide and show its review, then pay the seller.
    const done = await completedOrder(ctx);
    admin = await signInAgain(ctx, admin);
    const written = await request(ctx.app)
      .post(`${API}/reviews`)
      .set(done.buyer.bearer)
      .field(
        'data',
        JSON.stringify({
          orderId: done.order.id,
          overall: 1,
          communication: 1,
          handover: 1,
          condition: 1,
        }),
      );
    expect(written.status).toBe(201);
    const reviewId = written.body.review.id;
    await audited(`/admin/reviews/${reviewId}/hide`, reason('Abusive words'));
    await audited(`/admin/reviews/${reviewId}/show`, reason('Words were quoted from the listing'));

    await saveBank(ctx, done.seller);
    let account = await db.sellerBankAccount.findUniqueOrThrow({
      where: { userId: done.seller.user.id },
    });
    await audited(
      `/admin/bank-accounts/${account.id}/reject`,
      reason('Holder name does not match'),
    );
    await saveBank(ctx, done.seller, { ...BANK, holderName: 'Riya S Sharma' });
    await audited(`/admin/bank-accounts/${account.id}/verify`, reason('Test transfer matched'));
    const batch = await audited('/admin/payout-batches', {}, 'Built a payout batch');
    const itemId = batch.items[0].id;
    await audited(`/admin/payout-items/${itemId}/failed`, reason('Bank returned it'));
    ctx.clock.advance({ minutes: 1 });
    admin = await signInAgain(ctx, admin);
    account = await db.sellerBankAccount.findUniqueOrThrow({
      where: { userId: done.seller.user.id },
    });
    await audited(
      `/admin/bank-accounts/${account.id}/verify`,
      reason('Seller confirmed the account again'),
    );
    await audited(`/admin/payout-items/${itemId}/retry`, reason('Details verified again'));
    await audited(
      `/admin/payout-items/${itemId}/paid`,
      { bankReference: 'UTR777' },
      'Transfer made, bank reference UTR777',
    );
    // The bank file download is logged too.
    const before = await db.adminAuditLog.count();
    await request(ctx.app)
      .get(`${API}/admin/payout-batches/${batch.batch.id}/bank-file.csv`)
      .set(admin.bearer);
    expect(await db.adminAuditLog.count()).toBe(before + 1);

    // Every action in the first test's list was exercised here as well.
    const expected = new Set([
      ...REASONED.map(([path]) => path.replace(ID, ':id')),
      '/admin/payout-items/:id/paid',
      '/admin/payout-batches',
    ]);
    expect([...expected].filter((path) => !seen.has(path))).toEqual([]);
  });
});
