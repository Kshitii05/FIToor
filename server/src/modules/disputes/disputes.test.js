// The shared dispute flow (Step 8), written before the code.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  APPEAL_WINDOW_DAYS,
  DISPUTE_EVIDENCE_RETENTION_DAYS,
  DISPUTE_RESPONSE_HOURS,
  RENTAL_NON_RETURN_REPORT_DAYS,
} from '../../config/policy.js';
import { addBusinessDays, addDays, addHours } from '../../lib/clock.js';
import { createTestContext, db, registerVerifiedUser, resetDb } from '../../../test/helpers.js';
import {
  addEvidence,
  adminDispute,
  deliveredOrder,
  disputeAction,
  disputeFor,
  disputeView,
  reportIssue,
  runDisputeJobs,
} from '../../../test/disputes.js';
import {
  buyerAction,
  buyerView,
  paidOrder,
  registerAdmin,
  sellerAction,
  sellerView,
  signInAgain,
} from '../../../test/orders.js';
import {
  bookingLedger,
  bookingUpTo,
  ownerAction,
  ownerView,
  renterAction,
  RETURN_DUE,
  signInAgainAll,
  withPhotos,
} from '../../../test/rentals.js';
import { runOrderJobs } from '../orders/order.jobs.js';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const API = '/api/v1';
const REASON = 'Checked the photos from both sides';

/** Moves the clock and refreshes the accounts' access tokens. */
async function later(ctx, accounts, move) {
  ctx.clock.advance(move);
  return Promise.all(accounts.map((account) => signInAgain(ctx, account)));
}

describe('a problem with the item (sale issue)', () => {
  it('opens a dispute with 48 hours for the seller; an admin decides; it takes effect after the appeal window', async () => {
    const ctx = createTestContext();
    let { seller, buyer, order } = await deliveredOrder(ctx);
    const admin = await registerAdmin(ctx);

    const opened = await reportIssue(ctx, buyer, order.id);
    expect(opened.status).toBe(201);
    const dispute = await disputeFor({ orderId: order.id });
    expect(dispute).toMatchObject({
      kind: 'SALE_ISSUE',
      status: 'OPEN',
      claimantId: buyer.user.id,
      respondentId: seller.user.id,
    });
    expect(dispute.respondDueAt.getTime() - dispute.createdAt.getTime()).toBe(
      DISPUTE_RESPONSE_HOURS * 3600 * 1000,
    );

    // The seller answers with evidence: it goes to an admin.
    const answered = await addEvidence(ctx, seller, dispute.id, 'It was perfect when sent.', 1);
    expect(answered.status).toBe(201);
    expect(answered.body.dispute.status).toBe('UNDER_REVIEW');
    const reviewing = await db.dispute.findUnique({ where: { id: dispute.id } });
    expect(reviewing.reviewDueAt.toISOString()).toBe(
      addBusinessDays(ctx.clock.now(), 5).toISOString(),
    );

    expect(
      (
        await adminDispute(ctx, admin, dispute.id, 'decide', {
          outcome: 'PARTIAL_REFUND',
          refundPaise: 30000,
        })
      ).status,
    ).toBe(400);
    const decided = await adminDispute(ctx, admin, dispute.id, 'decide', {
      outcome: 'PARTIAL_REFUND',
      refundPaise: 30000,
      reason: REASON,
    });
    expect(decided.status).toBe(200);
    expect(decided.body.dispute.status).toBe('DECIDED');
    expect(await db.refund.count({ where: { orderId: order.id } })).toBe(0);
    expect((await sellerView(ctx, seller, order.id)).payoutEligible).toBe(false);
    expect(await db.adminAuditLog.count({ where: { targetId: dispute.id } })).toBe(1);

    [, buyer] = await later(ctx, [seller, buyer], { days: APPEAL_WINDOW_DAYS });
    await runDisputeJobs(ctx);
    expect((await db.dispute.findUnique({ where: { id: dispute.id } })).status).toBe('CLOSED');
    const [refund] = await db.refund.findMany({ where: { orderId: order.id } });
    expect(refund).toMatchObject({
      amountPaise: 30000,
      reason: 'ISSUE_PARTIAL',
      status: 'PROCESSED',
    });
    const view = await buyerView(ctx, buyer, order.id);
    expect(view.status).toBe('DELIVERED');
    expect(view.issue).toMatchObject({
      status: 'RESOLVED',
      resolution: 'PARTIAL_REFUND',
      refundPaise: 30000,
    });
  });

  it('with no answer for 48 hours it goes to an admin', async () => {
    const ctx = createTestContext();
    const { buyer, order } = await deliveredOrder(ctx);
    await reportIssue(ctx, buyer, order.id);
    const dispute = await disputeFor({ orderId: order.id });

    ctx.clock.advance({ hours: DISPUTE_RESPONSE_HOURS, minutes: -1 });
    await runDisputeJobs(ctx);
    expect((await db.dispute.findUnique({ where: { id: dispute.id } })).status).toBe('OPEN');
    ctx.clock.advance({ minutes: 1 });
    await runDisputeJobs(ctx);
    expect((await db.dispute.findUnique({ where: { id: dispute.id } })).status).toBe(
      'UNDER_REVIEW',
    );
  });

  it('when the seller agrees, the buyer is refunded at once and there is nothing to appeal', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await deliveredOrder(ctx);
    await reportIssue(ctx, buyer, order.id);
    const dispute = await disputeFor({ orderId: order.id });

    expect((await disputeAction(ctx, buyer, dispute.id, 'agree')).status).toBe(403);
    const agreed = await disputeAction(ctx, seller, dispute.id, 'agree');
    expect(agreed.status).toBe(200);
    expect(agreed.body.dispute.status).toBe('RESOLVED');
    expect((await buyerView(ctx, buyer, order.id)).status).toBe('REFUNDED');
    expect(
      (await disputeAction(ctx, buyer, dispute.id, 'appeal', { reason: 'I want more' })).status,
    ).toBe(409);
  });

  it('one appeal per dispute, within 3 days; the appeal decision is final and takes effect at once', async () => {
    const ctx = createTestContext();
    let { seller, buyer, order } = await deliveredOrder(ctx);
    const admin = await registerAdmin(ctx);
    await reportIssue(ctx, buyer, order.id);
    const dispute = await disputeFor({ orderId: order.id });
    await adminDispute(ctx, admin, dispute.id, 'decide', { outcome: 'REJECTED', reason: REASON });

    expect((await disputeAction(ctx, buyer, dispute.id, 'appeal', {})).status).toBe(400);
    const appealed = await disputeAction(ctx, buyer, dispute.id, 'appeal', {
      reason: 'The seller photos are of a different kurta',
    });
    expect(appealed.status).toBe(200);
    expect(appealed.body.dispute.status).toBe('APPEALED');
    expect(
      (await disputeAction(ctx, seller, dispute.id, 'appeal', { reason: 'Me too please' })).status,
    ).toBe(409);

    const final = await adminDispute(ctx, admin, dispute.id, 'decide-appeal', {
      outcome: 'FULL_REFUND',
      reason: 'On appeal the colour difference is clear',
    });
    expect(final.status).toBe(200);
    expect(final.body.dispute.status).toBe('CLOSED');
    expect((await buyerView(ctx, buyer, order.id)).status).toBe('REFUNDED');
    expect(await db.adminAuditLog.count({ where: { targetId: dispute.id } })).toBe(2);
  });

  it('an appeal after the 3 days is refused', async () => {
    const ctx = createTestContext();
    let { buyer, order } = await deliveredOrder(ctx);
    const admin = await registerAdmin(ctx);
    await reportIssue(ctx, buyer, order.id);
    const dispute = await disputeFor({ orderId: order.id });
    await adminDispute(ctx, admin, dispute.id, 'decide', { outcome: 'REJECTED', reason: REASON });
    [buyer] = await later(ctx, [buyer], { days: APPEAL_WINDOW_DAYS, seconds: 1 });
    const late = await disputeAction(ctx, buyer, dispute.id, 'appeal', { reason: 'Too late now' });
    expect(late.status).toBe(409);
  });

  it('the buyer can withdraw it; the order goes back to received and cannot be reported again', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await deliveredOrder(ctx);
    await reportIssue(ctx, buyer, order.id);
    const dispute = await disputeFor({ orderId: order.id });
    expect((await disputeAction(ctx, seller, dispute.id, 'withdraw')).status).toBe(403);
    const withdrawn = await disputeAction(ctx, buyer, dispute.id, 'withdraw');
    expect(withdrawn.body.dispute.status).toBe('WITHDRAWN');
    expect((await buyerView(ctx, buyer, order.id)).status).toBe('DELIVERED');
    expect((await reportIssue(ctx, buyer, order.id)).status).toBe(409);
  });
});

describe('it did not arrive', () => {
  async function reported(ctx) {
    const made = await paidOrder(ctx);
    await sellerAction(ctx, made.seller, made.order.id, 'deliver');
    return made;
  }

  it('the buyer reports it; an admin can cancel with a full refund after the appeal window', async () => {
    const ctx = createTestContext();
    let { seller, buyer, order } = await reported(ctx);
    const admin = await registerAdmin(ctx);
    await buyerAction(ctx, buyer, order.id, 'not-received', { reason: 'Nothing came' });
    const dispute = await disputeFor({ orderId: order.id });
    expect(dispute).toMatchObject({
      kind: 'NOT_DELIVERED',
      claimantId: buyer.user.id,
      openedByClaimant: true,
    });

    await adminDispute(ctx, admin, dispute.id, 'decide', { outcome: 'REFUND', reason: REASON });
    [, buyer] = await later(ctx, [seller, buyer], { days: APPEAL_WINDOW_DAYS });
    await runDisputeJobs(ctx);
    const view = await buyerView(ctx, buyer, order.id);
    expect(view.status).toBe('CANCELLED');
    expect(view.refundedPaise).toBe(order.totalPaise);
  });

  it('48 hours of silence after "delivered" opens one for the buyer; an admin can confirm delivery', async () => {
    const ctx = createTestContext();
    let { seller, buyer, order } = await reported(ctx);
    ctx.clock.advance({ hours: 48 });
    await runOrderJobs(ctx.app.locals.deps);
    const admin = await registerAdmin(ctx);
    const dispute = await disputeFor({ orderId: order.id });
    expect(dispute).toMatchObject({
      kind: 'NOT_DELIVERED',
      openedByClaimant: false,
      claimantId: buyer.user.id,
    });

    await adminDispute(ctx, admin, dispute.id, 'decide', {
      outcome: 'DELIVERED',
      reason: 'Courier proof of delivery',
    });
    [, buyer] = await later(ctx, [seller, buyer], { days: APPEAL_WINDOW_DAYS });
    await runDisputeJobs(ctx);
    expect((await buyerView(ctx, buyer, order.id)).status).toBe('DELIVERED');
  });
});

describe('rental deposit disputes', () => {
  const claim = (ctx, owner, id) =>
    withPhotos(ctx, owner, `/me/rented-out/${id}/claim`, {
      description: 'A tear along the hem that was not there before.',
      items: [{ label: 'Tailoring', amountPaise: 150000 }],
    });

  it('a contested claim waits for the appeal window, then settles; the deposit still adds up', async () => {
    const ctx = createTestContext();
    let { owner, renter, booking } = await bookingUpTo(ctx, 'returned', {
      returnAt: addHours(RETURN_DUE, -1),
    });
    const admin = await registerAdmin(ctx);
    await claim(ctx, owner, booking.id);
    const dispute = await disputeFor({ bookingId: booking.id });
    expect(dispute).toMatchObject({
      kind: 'RENTAL_DEPOSIT',
      claimantId: owner.user.id,
      claimedDamagePaise: 150000,
    });

    await addEvidence(ctx, renter, dispute.id, 'That tear is in the handover photos.');
    expect((await ownerView(ctx, owner, booking.id)).status).toBe('ADMIN_REVIEW');

    await adminDispute(ctx, admin, dispute.id, 'decide', {
      outcome: 'SETTLE',
      damagePaise: 100000,
      lateFeePaise: 0,
      reason: REASON,
    });
    expect((await ownerView(ctx, owner, booking.id)).status).toBe('ADMIN_REVIEW');
    expect((await ownerView(ctx, owner, booking.id)).payoutEligible).toBe(false);
    expect(await db.refund.count({ where: { bookingId: booking.id } })).toBe(0);

    [owner] = await signInAgainAll(ctx, owner, renter);
    ctx.clock.advance({ days: APPEAL_WINDOW_DAYS });
    await runDisputeJobs(ctx);
    [owner] = await signInAgainAll(ctx, owner);
    expect((await ownerView(ctx, owner, booking.id)).status).toBe('COMPLETED');
    const ledger = await bookingLedger(booking.id);
    expect(ledger.DEPOSIT_REFUND).toBe(400000);
    expect(ledger.DEPOSIT_COLLECTED).toBe(ledger.DEPOSIT_REFUND + ledger.DEPOSIT_DEDUCTION);
  });

  it('a late fee disputed on its own: the owner can waive it, and the deposit comes back in full', async () => {
    const ctx = createTestContext();
    const { owner, renter, booking } = await bookingUpTo(ctx, 'returned', {
      returnAt: addHours(RETURN_DUE, 30),
    });
    expect(booking.lateFeePaise).toBe(20000);
    await renterAction(ctx, renter, booking.id, 'dispute-late-fee', {
      reason: 'You postponed the return yourself',
    });
    const dispute = await disputeFor({ bookingId: booking.id });
    expect(dispute).toMatchObject({
      claimantId: renter.user.id,
      lateFeeDisputed: true,
      claimedDamagePaise: null,
    });

    expect((await disputeAction(ctx, owner, dispute.id, 'agree')).body.dispute.status).toBe(
      'RESOLVED',
    );
    const done = await ownerAction(ctx, owner, booking.id, 'inspection-ok');
    expect(done.body.booking.status).toBe('COMPLETED');
    expect((await db.refund.findFirst({ where: { bookingId: booking.id } })).amountPaise).toBe(
      500000,
    );
  });

  it('an item not returned: the owner reports it and an admin can let the owner keep the deposit', async () => {
    const ctx = createTestContext();
    let { owner, renter, booking } = await bookingUpTo(ctx, 'active');
    ctx.clock.set(addDays(RETURN_DUE, RENTAL_NON_RETURN_REPORT_DAYS));
    [owner] = await signInAgainAll(ctx, owner, renter);
    const admin = await registerAdmin(ctx);
    await ownerAction(ctx, owner, booking.id, 'report-non-return');
    const dispute = await disputeFor({ bookingId: booking.id });
    expect(dispute).toMatchObject({ kind: 'NOT_RETURNED', claimantId: owner.user.id });

    await adminDispute(ctx, admin, dispute.id, 'decide', {
      outcome: 'SETTLE',
      damagePaise: 500000,
      lateFeePaise: 0,
      reason: 'The item was never returned',
    });
    ctx.clock.advance({ days: APPEAL_WINDOW_DAYS });
    await runDisputeJobs(ctx);
    const row = await db.rentalBooking.findUnique({ where: { id: booking.id } });
    expect(row).toMatchObject({ status: 'COMPLETED', depositDeductedPaise: 500000 });
    expect(await db.refund.count({ where: { bookingId: booking.id } })).toBe(0);
  });
});

describe('who can see and act', () => {
  it('only the two sides see a dispute; only admins decide', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await deliveredOrder(ctx);
    await reportIssue(ctx, buyer, order.id);
    const dispute = await disputeFor({ orderId: order.id });
    const stranger = await registerVerifiedUser(ctx);

    expect((await disputeView(ctx, stranger, dispute.id)).status).toBe(404);
    expect((await addEvidence(ctx, stranger, dispute.id, 'I saw it too')).status).toBe(404);
    expect(
      (
        await adminDispute(ctx, seller, dispute.id, 'decide', {
          outcome: 'REJECTED',
          reason: REASON,
        })
      ).status,
    ).toBe(403);
    const mine = await request(ctx.app).get(`${API}/disputes`).set(seller.bearer);
    expect(mine.body.items.map((d) => d.id)).toEqual([dispute.id]);
    const view = await disputeView(ctx, buyer, dispute.id);
    expect(view.body.dispute.actions).toEqual(expect.arrayContaining(['evidence', 'withdraw']));
    expect(view.body.dispute.evidence[0].photos).toHaveLength(1);
  });
});

describe('evidence retention', () => {
  it('photos are deleted 180 days after a dispute closes; the record stays', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await deliveredOrder(ctx);
    await reportIssue(ctx, buyer, order.id);
    const dispute = await disputeFor({ orderId: order.id });
    await disputeAction(ctx, seller, dispute.id, 'agree');
    const before = ctx.imageStorage.stored.size;

    ctx.clock.advance({ days: DISPUTE_EVIDENCE_RETENTION_DAYS - 1 });
    await runDisputeJobs(ctx);
    expect(
      (await db.dispute.findUnique({ where: { id: dispute.id } })).evidencePurgedAt,
    ).toBeNull();

    ctx.clock.advance({ days: 1 });
    await runDisputeJobs(ctx);
    const row = await db.dispute.findUnique({
      where: { id: dispute.id },
      include: { evidence: true },
    });
    expect(row.evidencePurgedAt).not.toBeNull();
    expect(row.evidence.every((e) => e.photos.length === 0)).toBe(true);
    expect(ctx.imageStorage.stored.size).toBeLessThan(before);
    expect(row.description).toBeTruthy();
  });
});
