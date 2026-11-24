import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { APPEAL_WINDOW_DAYS } from '../../config/policy.js';
import { addHours } from '../../lib/clock.js';
import { createTestContext, db, registerVerifiedUser, resetDb } from '../../../test/helpers.js';
import {
  addEvidence,
  adminDispute,
  deliveredOrder,
  disputeFor,
  reportIssue,
  runDisputeJobs,
} from '../../../test/disputes.js';
import { buyerAction, paidOrder, registerAdmin, signInAgain } from '../../../test/orders.js';
import { adminGet, adminPost, buildBatch } from '../../../test/payouts.js';
import { bookingUpTo, renterAction, RETURN_DUE, withPhotos } from '../../../test/rentals.js';
import { runOrderJobs } from '../orders/order.jobs.js';

const API = '/api/v1';
const RANGE = 'from=2026-11-13&to=2026-12-10';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

/** Sum of ledger rows by type, for rows matching `where`. */
async function ledgerSum(where = {}) {
  const rows = await db.ledgerEntry.groupBy({ by: ['type'], where, _sum: { amountPaise: true } });
  return Object.fromEntries(rows.map((r) => [r.type, r._sum.amountPaise]));
}

/**
 * Seeds the money cases that matter: a plain sale, a sale with a partial refund, a
 * sale cancelled with a full refund, a rental with a deposit deduction, a rental
 * cancelled after paying, and one payout.
 */
async function seedTransactions(ctx) {
  // Rental cancelled after paying, before the start day: half the fee back, deposit back.
  const cancelledRental = await bookingUpTo(ctx, 'confirmed');
  const cancelled = await renterAction(
    ctx,
    cancelledRental.renter,
    cancelledRental.booking.id,
    'cancel',
  );
  expect(cancelled.status).toBe(200);

  // Rental returned, damage claimed and accepted: part of the deposit goes to the owner.
  const claimed = await bookingUpTo(ctx, 'returned', { returnAt: addHours(RETURN_DUE, -1) });
  await withPhotos(
    ctx,
    claimed.owner,
    `/me/rented-out/${claimed.booking.id}/claim`,
    {
      description: 'The hem is torn and there is a wine stain on the front.',
      items: [{ label: 'Torn hem, tailoring', amountPaise: 120000 }],
    },
    2,
  );
  const accepted = await renterAction(ctx, claimed.renter, claimed.booking.id, 'claim-response', {
    accept: true,
  });
  expect(accepted.body.booking.status).toBe('COMPLETED');

  // Sales.
  const plain = await deliveredOrder(ctx);
  const partial = await deliveredOrder(ctx);
  const refunded = await paidOrder(ctx);
  expect((await buyerAction(ctx, refunded.buyer, refunded.order.id, 'cancel')).status).toBe(200);
  expect((await registerBankEarly(ctx, plain.seller)).status).toBe(200);

  await reportIssue(ctx, partial.buyer, partial.order.id);
  const dispute = await disputeFor({ orderId: partial.order.id });
  await addEvidence(ctx, partial.seller, dispute.id, 'It was perfect when sent.', 1);
  const admin = await registerAdmin(ctx);
  const decided = await adminDispute(ctx, admin, dispute.id, 'decide', {
    outcome: 'PARTIAL_REFUND',
    refundPaise: 30000,
    reason: 'The photos show a small tear the listing did not mention',
  });
  expect(decided.status).toBe(200);
  ctx.clock.advance({ days: APPEAL_WINDOW_DAYS });
  await runDisputeJobs(ctx);

  // The 7-day issue windows end: both sales complete.
  ctx.clock.advance({ days: 7 - APPEAL_WINDOW_DAYS, minutes: 1 });
  await runOrderJobs(ctx.app.locals.deps);
  for (const { order } of [plain, partial]) {
    expect((await db.order.findUnique({ where: { id: order.id } })).status).toBe('COMPLETED');
  }

  // One payout: only the plain sale's seller has verified bank details.
  const freshAdmin = await signInAgain(ctx, admin);
  const account = await db.sellerBankAccount.findUniqueOrThrow({
    where: { userId: plain.seller.user.id },
  });
  await adminPost(ctx, freshAdmin, `/bank-accounts/${account.id}/verify`, {
    reason: 'Checked by a test transfer',
  });
  const batch = await buildBatch(ctx, freshAdmin);
  expect(batch.body.items).toHaveLength(1);
  await adminPost(ctx, freshAdmin, `/payout-items/${batch.body.items[0].id}/paid`, {
    bankReference: 'UTR9001',
  });

  return {
    admin: freshAdmin,
    plain,
    partial,
    refunded,
    claimed,
    cancelledRental,
    payoutPaise: batch.body.items[0].amountPaise,
  };
}

const registerBankEarly = (ctx, seller) =>
  request(ctx.app)
    .put(`${API}/me/bank-account`)
    .set(seller.bearer)
    .send({ holderName: 'Asha Rao', accountNumber: '123456789012', ifsc: 'HDFC0001234' });

describe('platform analytics', () => {
  it('reconciles GMV, commission, refunds, deposits and payouts with the ledger exactly', async () => {
    const ctx = createTestContext();
    const seeded = await seedTransactions(ctx);
    const res = await adminGet(ctx, seeded.admin, `/analytics?${RANGE}`);
    expect(res.status).toBe(200);
    const { totals } = res.body;

    // Completed transactions only: the two sales and the claimed rental.
    const orders = await db.order.findMany({ where: { status: 'COMPLETED' } });
    const bookings = await db.rentalBooking.findMany({ where: { status: 'COMPLETED' } });
    expect(orders.map((o) => o.id).sort()).toEqual(
      [seeded.plain.order.id, seeded.partial.order.id].sort(),
    );
    expect(bookings.map((b) => b.id)).toEqual([seeded.claimed.booking.id]);
    expect(totals).toMatchObject({ sales: 2, rentals: 1 });

    const ids = {
      OR: [
        { orderId: { in: orders.map((o) => o.id) } },
        { bookingId: { in: bookings.map((b) => b.id) } },
      ],
    };
    const completedLedger = await ledgerSum(ids);
    const allLedger = await ledgerSum();
    const commission = completedLedger.COMMISSION - (completedLedger.COMMISSION_REVERSAL ?? 0);
    const sellerNet =
      completedLedger.SELLER_PAYABLE - (completedLedger.SELLER_PAYABLE_REVERSAL ?? 0);
    const deducted = completedLedger.DEPOSIT_DEDUCTION;

    // GMV from the transactions themselves...
    const gmv =
      orders.reduce((t, o) => t + o.totalPaise - o.refundedPaise, 0) +
      bookings.reduce((t, b) => t + b.feePaise + b.deliveryChargePaise - b.refundedPaise, 0);
    expect(totals.gmvPaise).toBe(gmv);
    // ...equals what the ledger split it into: commission plus the sellers' share.
    expect(totals.gmvPaise).toBe(commission + sellerNet - deducted);
    expect(totals.commissionPaise).toBe(commission);
    expect(totals.sellerNetPaise).toBe(sellerNet);
    expect(totals.depositDeductionsPaise).toBe(deducted);
    expect(totals.averageTransactionPaise).toBe(Math.floor(gmv / 3));

    // The partial refund lowered GMV and reversed its share of commission.
    const partial = orders.find((o) => o.id === seeded.partial.order.id);
    expect(partial.refundedPaise).toBe(30000);

    // Period ledger figures match the ledger rows written in the period.
    expect(totals.refundsPaise).toBe(allLedger.BUYER_REFUND);
    expect(totals.depositsCollectedPaise).toBe(allLedger.DEPOSIT_COLLECTED);
    expect(totals.depositsRefundedPaise).toBe(allLedger.DEPOSIT_REFUND);
    expect(totals.depositsDeductedPaise).toBe(allLedger.DEPOSIT_DEDUCTION);
    expect(totals.payoutsPaise).toBe(allLedger.SELLER_PAYOUT);
    expect(totals.payoutsPaise).toBe(seeded.payoutPaise);
    // Deposits are never revenue: collected = refunded + deducted for settled ones.
    expect(totals.depositsCollectedPaise).toBe(
      totals.depositsRefundedPaise + totals.depositsDeductedPaise,
    );

    // The series adds up to the totals.
    const sum = (key) => res.body.series.reduce((t, row) => t + row[key], 0);
    expect(sum('gmvPaise')).toBe(totals.gmvPaise);
    expect(sum('commissionPaise')).toBe(totals.commissionPaise);
    expect(sum('sales')).toBe(2);
    expect(res.body.series[0].bucket).toBe('2026-11-13');

    // Areas are public localities only; no coordinates anywhere.
    expect(res.body.localities[0].locality).toBe('Indiranagar');
    expect(JSON.stringify(res.body)).not.toMatch(/"(lat|lng|pinLat|pinLng|latitude)"/);

    const csv = await adminGet(ctx, seeded.admin, `/analytics?${RANGE}&format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('gmv (rupees)');
  });

  it('refuses a start after the end and ranges over a year', async () => {
    const ctx = createTestContext();
    const admin = await registerAdmin(ctx);
    expect((await adminGet(ctx, admin, '/analytics?from=2026-11-20&to=2026-11-01')).status).toBe(
      400,
    );
    expect((await adminGet(ctx, admin, '/analytics?from=2025-01-01&to=2026-11-01')).status).toBe(
      400,
    );
    const empty = await adminGet(ctx, admin, '/analytics?from=2026-01-01&to=2026-11-30');
    expect(empty.body.range.bucket).toBe('month');
    expect(empty.body.totals.gmvPaise).toBe(0);
  });
});

describe('seller analytics', () => {
  it("shows a seller's earnings from the ledger, views, conversion and rating", async () => {
    const ctx = createTestContext();
    const seeded = await seedTransactions(ctx);
    const { plain } = seeded;
    const listingId = plain.listing.id;
    // Two people viewed the listing (unique views, I15).
    for (const viewer of [await registerVerifiedUser(ctx), await registerVerifiedUser(ctx)]) {
      await db.listingView.create({
        data: { userId: viewer.user.id, listingId, viewedOn: new Date('2026-11-22') },
      });
    }

    const seller = await signInAgain(ctx, plain.seller);
    const res = await request(ctx.app).get(`${API}/me/analytics?${RANGE}`).set(seller.bearer);
    expect(res.status).toBe(200);
    const order = await db.order.findUniqueOrThrow({ where: { id: plain.order.id } });
    expect(res.body.totals).toMatchObject({
      sales: 1,
      rentals: 0,
      commissionPaise: order.commissionPaise,
      netPaise: order.sellerPayablePaise,
      grossPaise: order.sellerPayablePaise + order.commissionPaise,
      paidOutPaise: seeded.payoutPaise,
      views: 2,
      conversionRate: 0.5,
      averageRating: null,
    });
    expect(res.body.topListings[0]).toMatchObject({ id: listingId, views: 2, completed: 1 });

    // Another seller's figures never show up.
    const other = await signInAgain(ctx, seeded.partial.seller);
    const theirs = await request(ctx.app).get(`${API}/me/analytics?${RANGE}`).set(other.bearer);
    expect(theirs.body.topListings.map((l) => l.id)).not.toContain(listingId);
    expect(theirs.body.totals.paidOutPaise).toBe(0);
  });
});
