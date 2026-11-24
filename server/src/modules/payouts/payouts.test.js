import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { addHours } from '../../lib/clock.js';
import { createTestContext, db, resetDb } from '../../../test/helpers.js';
import { completedOrder, deliveredOrder } from '../../../test/disputes.js';
import { registerAdmin, signInAgain } from '../../../test/orders.js';
import { runOrderJobs } from '../orders/order.jobs.js';
import {
  bookingUpTo,
  ownerAction,
  ownerView,
  RETURN_DUE,
  signInAgainAll,
  withPhotos,
} from '../../../test/rentals.js';
import {
  BANK,
  adminGet,
  adminPost,
  buildBatch,
  netPayable,
  runPayoutJobs,
  saveBank,
  verifiedBank,
} from '../../../test/payouts.js';
import { weeklyBuildTime } from './payouts.service.js';

const API = '/api/v1';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

/** A completed order whose seller has verified bank details, and an admin. */
async function readyToPay(ctx) {
  const made = await completedOrder(ctx);
  const admin = await registerAdmin(ctx);
  await verifiedBank(ctx, made.seller, admin);
  return { ...made, admin };
}

describe('payout eligibility', () => {
  it('a batch contains only completed, verified, undisputed transactions', async () => {
    const ctx = createTestContext();
    // A rental still being inspected, and one that completed.
    let inspecting = await bookingUpTo(ctx, 'active');
    const done = await bookingUpTo(ctx, 'returned', { returnAt: addHours(RETURN_DUE, -1) });
    const inspected = await ownerAction(ctx, done.owner, done.booking.id, 'inspection-ok');
    expect(inspected.status).toBe(200);
    expect((await db.rentalBooking.findUnique({ where: { id: done.booking.id } })).status).toBe(
      'COMPLETED',
    );
    const [inspectingOwner, inspectingRenter] = await signInAgainAll(
      ctx,
      inspecting.owner,
      inspecting.renter,
    );
    inspecting = { ...inspecting, owner: inspectingOwner, renter: inspectingRenter };
    const { returnCode } = await ownerView(ctx, inspecting.owner, inspecting.booking.id);
    await withPhotos(ctx, inspecting.renter, `/me/rentals/${inspecting.booking.id}/return`, {
      code: returnCode,
    });

    // Sale orders, received now; the 7-day issue window then passes.
    const paid = await deliveredOrder(ctx); // verified bank: pays
    const noBank = await deliveredOrder(ctx); // no bank details
    const unchecked = await deliveredOrder(ctx); // bank details not checked yet
    const suspended = await deliveredOrder(ctx); // seller suspended
    const disputed = await deliveredOrder(ctx); // a dispute still in its appeal window
    for (const seller of [paid, unchecked, suspended, disputed].map((m) => m.seller)) {
      expect((await saveBank(ctx, seller)).status).toBe(200);
    }
    for (const owner of [done.owner, inspecting.owner]) {
      expect((await saveBank(ctx, owner)).status).toBe(200);
    }
    ctx.clock.advance({ days: 7, minutes: 1 });
    await runOrderJobs(ctx.app.locals.deps);
    const notYet = await deliveredOrder(ctx); // received, window still running

    const admin = await registerAdmin(ctx);
    const pending = await adminGet(ctx, admin, '/bank-accounts');
    expect(pending.body.items).toHaveLength(6);
    for (const account of pending.body.items) {
      if (account.user.id === unchecked.seller.user.id) continue;
      const res = await adminPost(ctx, admin, `/bank-accounts/${account.id}/verify`, {
        reason: 'Name matches a test transfer',
      });
      expect(res.status).toBe(200);
    }
    expect(
      (
        await adminPost(ctx, admin, `/users/${suspended.seller.user.id}/suspend`, {
          reason: 'Selling counterfeit items',
        })
      ).status,
    ).toBe(200);
    await db.dispute.create({
      data: {
        ref: 'D-TEST-1',
        kind: 'SALE_ISSUE',
        status: 'DECIDED',
        orderId: disputed.order.id,
        claimantId: disputed.buyer.user.id,
        respondentId: disputed.seller.user.id,
        category: 'DAMAGED',
        description: 'Torn seam found later',
        respondDueAt: ctx.clock.now(),
        decidedAt: ctx.clock.now(),
        appealDueAt: addHours(ctx.clock.now(), 72),
        createdAt: ctx.clock.now(),
      },
    });

    const preview = await adminGet(ctx, admin, '/payouts/eligible');
    expect(preview.status).toBe(200);
    expect(preview.body.eligible.map((r) => r.id).sort()).toEqual(
      [paid.order.id, done.booking.id].sort(),
    );
    const held = Object.fromEntries(preview.body.held.map((r) => [r.id, r.hold]));
    expect(held).toEqual({
      [noBank.order.id]: 'NO_BANK_ACCOUNT',
      [unchecked.order.id]: 'BANK_NOT_VERIFIED',
      [suspended.order.id]: 'SELLER_NOT_ACTIVE',
      [disputed.order.id]: 'DISPUTE_OPEN',
    });
    const listed = [...preview.body.eligible, ...preview.body.held].map((r) => r.id);
    expect(listed).not.toContain(notYet.order.id);
    expect(listed).not.toContain(inspecting.booking.id);

    const built = await buildBatch(ctx, admin);
    expect(built.status).toBe(201);
    const lines = built.body.items.flatMap((item) => item.lines);
    expect(lines.map((l) => l.id).sort()).toEqual([paid.order.id, done.booking.id].sort());
    const orderLine = lines.find((l) => l.id === paid.order.id);
    expect(orderLine.amountPaise).toBe(await netPayable({ orderId: paid.order.id }));
    expect(orderLine.amountPaise).toBe(paid.order.sellerPayablePaise);
    const bookingLine = lines.find((l) => l.id === done.booking.id);
    expect(bookingLine.amountPaise).toBe(await netPayable({ bookingId: done.booking.id }));
    expect(built.body.batch.totalPaise).toBe(orderLine.amountPaise + bookingLine.amountPaise);

    // Only one batch can be open at a time.
    const again = await buildBatch(ctx, admin);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('BATCH_OPEN');
  });

  it('the same order can never be paid out twice', async () => {
    const ctx = createTestContext();
    const { order, admin } = await readyToPay(ctx);
    const built = await buildBatch(ctx, admin);
    const [item] = built.body.items;
    await adminPost(ctx, admin, `/payout-items/${item.id}/paid`, { bankReference: 'UTR0001' });

    const next = await buildBatch(ctx, admin);
    expect(next.status).toBe(200);
    expect(next.body.batch).toBeNull();
    // Even written directly, the database refuses a second line for the order.
    await expect(
      db.payoutLine.create({ data: { itemId: item.id, orderId: order.id, amountPaise: 100 } }),
    ).rejects.toThrow();
  });
});

describe('recording payouts', () => {
  it('a transfer recorded twice at once is paid and booked in the ledger once', async () => {
    const ctx = createTestContext();
    const { seller, order, admin } = await readyToPay(ctx);
    const built = await buildBatch(ctx, admin);
    const [item] = built.body.items;
    expect(item.attempts[0].reference).toBe(item.ref);
    expect(item.attempts[0].accountNumber).toBe('XXXXXX9012');

    const results = await Promise.all([
      adminPost(ctx, admin, `/payout-items/${item.id}/paid`, { bankReference: 'UTR1001' }),
      adminPost(ctx, admin, `/payout-items/${item.id}/paid`, { bankReference: 'UTR1002' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

    const payouts = await db.ledgerEntry.findMany({ where: { type: 'SELLER_PAYOUT' } });
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({
      orderId: order.id,
      sellerId: seller.user.id,
      amountPaise: item.amountPaise,
    });
    const batch = await db.payoutBatch.findUniqueOrThrow({ where: { id: built.body.batch.id } });
    expect(batch.status).toBe('CLOSED');
    const audit = await db.adminAuditLog.findMany({ where: { action: 'MARK_PAYOUT_PAID' } });
    expect(audit).toHaveLength(1);
    expect(
      await db.notification.count({ where: { userId: seller.user.id, type: 'payoutPaid' } }),
    ).toBe(1);

    const mine = await request(ctx.app).get(`${API}/me/payouts`).set(seller.bearer);
    expect(mine.body.totals).toEqual({
      paidPaise: item.amountPaise,
      inProgressPaise: 0,
      upcomingPaise: 0,
    });
    expect(mine.body.payouts[0]).not.toHaveProperty('seller');
  });

  it('a failed transfer needs the bank details checked again, then retries under a new reference', async () => {
    const ctx = createTestContext();
    const { seller, admin } = await readyToPay(ctx);
    const built = await buildBatch(ctx, admin);
    const [item] = built.body.items;

    const failed = await adminPost(ctx, admin, `/payout-items/${item.id}/failed`, {
      reason: 'The bank returned it: account closed',
    });
    expect(failed.status).toBe(200);
    expect(failed.body.item.status).toBe('FAILED');
    expect(await db.ledgerEntry.count({ where: { type: 'SELLER_PAYOUT' } })).toBe(0);
    const account = await db.sellerBankAccount.findUniqueOrThrow({
      where: { userId: seller.user.id },
    });
    expect(account.status).toBe('PENDING');
    expect(account.note).toMatch(/account closed/);
    expect(
      await db.notification.count({ where: { userId: seller.user.id, type: 'payoutFailed' } }),
    ).toBe(1);

    const early = await adminPost(ctx, admin, `/payout-items/${item.id}/retry`, {
      reason: 'Trying again',
    });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('BANK_NOT_REVERIFIED');

    // The seller fixes the details, an admin checks them, and the payout is retried.
    ctx.clock.advance({ minutes: 5 });
    const fresh = await signInAgain(ctx, seller);
    await verifiedBank(ctx, fresh, admin, { ...BANK, accountNumber: '998877665544' });
    const retried = await adminPost(ctx, admin, `/payout-items/${item.id}/retry`, {
      reason: 'Seller updated the account',
    });
    expect(retried.status).toBe(200);
    expect(retried.body.item.status).toBe('PENDING');
    expect(retried.body.item.attempts.map((a) => a.reference)).toEqual([
      item.ref,
      `${item.ref}-R1`,
    ]);
    expect(retried.body.item.attempts[1].accountNumber).toBe('XXXXXX5544');

    const paid = await adminPost(ctx, admin, `/payout-items/${item.id}/paid`, {
      bankReference: 'UTR2001',
    });
    expect(paid.status).toBe(200);
    const ledger = await db.ledgerEntry.findMany({ where: { type: 'SELLER_PAYOUT' } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amountPaise).toBe(item.amountPaise);
  });
});

describe('bank details', () => {
  it('are stored encrypted, shown masked, and need a new check after any change', async () => {
    const ctx = createTestContext();
    const { seller } = await completedOrder(ctx);
    const saved = await saveBank(ctx, seller);
    expect(saved.status).toBe(200);
    expect(saved.body.bankAccount).toMatchObject({
      holderName: BANK.holderName,
      accountNumber: 'XXXXXX9012',
      ifsc: 'HDFC0001234',
      status: 'PENDING',
    });
    const row = await db.sellerBankAccount.findUniqueOrThrow({ where: { userId: seller.user.id } });
    expect(row.accountNumberEncrypted).not.toContain(BANK.accountNumber);
    expect(JSON.stringify(saved.body)).not.toContain(BANK.accountNumber);

    const admin = await registerAdmin(ctx);
    const list = await adminGet(ctx, admin, '/bank-accounts');
    expect(JSON.stringify(list.body)).not.toContain(BANK.accountNumber);
    await adminPost(ctx, admin, `/bank-accounts/${row.id}/verify`, { reason: 'Checked by hand' });
    expect((await db.sellerBankAccount.findUnique({ where: { id: row.id } })).status).toBe(
      'VERIFIED',
    );

    const changed = await saveBank(ctx, seller, { ...BANK, ifsc: 'icic0004321' });
    expect(changed.body.bankAccount).toMatchObject({ ifsc: 'ICIC0004321', status: 'PENDING' });

    const bad = await saveBank(ctx, seller, { ...BANK, ifsc: 'HDFC1234' });
    expect(bad.status).toBe(400);
    const short = await saveBank(ctx, seller, { ...BANK, accountNumber: '12345' });
    expect(short.status).toBe(400);
  });

  it('the full number appears only in the bank file, and every download is audit logged', async () => {
    const ctx = createTestContext();
    const { admin, seller } = await readyToPay(ctx);
    const built = await buildBatch(ctx, admin);
    const detail = await adminGet(ctx, admin, `/payout-batches/${built.body.batch.id}`);
    expect(JSON.stringify(detail.body)).not.toContain(BANK.accountNumber);

    const file = await adminGet(ctx, admin, `/payout-batches/${built.body.batch.id}/bank-file.csv`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/text\/csv/);
    expect(file.text).toContain(BANK.accountNumber);
    expect(file.text).toContain(seller.details.email);
    expect(await db.adminAuditLog.count({ where: { action: 'DOWNLOAD_PAYOUT_BANK_FILE' } })).toBe(
      1,
    );
  });
});

describe('the weekly batch', () => {
  it('is built on Monday at 10:00 India time, once a week', () => {
    // Friday 20 November 2026, noon in India: the last build time was Monday the 16th.
    expect(weeklyBuildTime(new Date('2026-11-20T06:30:00.000Z')).toISOString()).toBe(
      '2026-11-16T04:30:00.000Z',
    );
    // Monday 23rd at 09:59 India time is still the previous week.
    expect(weeklyBuildTime(new Date('2026-11-23T04:29:00.000Z')).toISOString()).toBe(
      '2026-11-16T04:30:00.000Z',
    );
    expect(weeklyBuildTime(new Date('2026-11-23T04:30:00.000Z')).toISOString()).toBe(
      '2026-11-23T04:30:00.000Z',
    );
  });

  it('builds itself, tells the admins, and flags a batch past its 3-business-day target', async () => {
    const ctx = createTestContext();
    const { admin } = await readyToPay(ctx);

    expect((await runPayoutJobs(ctx)).built).toBe(1);
    expect((await runPayoutJobs(ctx)).built).toBe(0);
    const batch = await db.payoutBatch.findFirstOrThrow();
    expect(batch.createdById).toBeNull();
    expect(
      await db.notification.count({ where: { userId: admin.user.id, type: 'payoutBatchBuilt' } }),
    ).toBe(1);

    // Built on Friday 20th: 3 business days is Wednesday 25th.
    expect(batch.dueAt.toISOString()).toBe('2026-11-25T06:31:00.000Z');
    ctx.clock.set(batch.dueAt);
    await runPayoutJobs(ctx);
    await runPayoutJobs(ctx);
    expect(
      await db.notification.count({ where: { userId: admin.user.id, type: 'payoutBatchOverdue' } }),
    ).toBe(1);
    const fresh = await signInAgain(ctx, admin);
    const list = await adminGet(ctx, fresh, '/payout-batches');
    expect(list.body.items[0]).toMatchObject({ overdue: true, builtBy: 'weekly job' });
  });
});

describe('account deletion', () => {
  it('is refused while earnings are waiting to be paid out', async () => {
    const ctx = createTestContext();
    const { seller } = await completedOrder(ctx);
    const res = await request(ctx.app)
      .post(`${API}/me/deletion`)
      .set(seller.bearer)
      .send({ password: seller.details.password });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/not been paid out/);
  });
});
