// The eight checks the build playbook asks for in Step 6, written before the code.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  APPEAL_WINDOW_DAYS,
  CLAIM_RESPONSE_HOURS,
  DEPOSIT_AUTO_REFUND_AFTER_RETURN_HOURS,
  RENTAL_PENDING_HOLD_HOURS,
} from '../../config/policy.js';
import { addHours, addMinutes } from '../../lib/clock.js';
import { createTestContext, db, registerVerifiedUser, resetDb } from '../../../test/helpers.js';
import { registerAdmin } from '../../../test/orders.js';
import {
  bookingLedger,
  bookingUpTo,
  END,
  ownerAction,
  ownerView,
  rentable,
  renterAction,
  renterView,
  requestBooking,
  RETURN_DUE,
  runJobs,
  signInAgainAll,
  START,
  withPhotos,
} from '../../../test/rentals.js';
import { lateFeeFor } from './rental.rules.js';
import { adminDispute, runDisputeJobs } from '../../../test/disputes.js';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const claimItems = [
  { label: 'Torn hem, tailoring', amountPaise: 120000 },
  { label: 'Stain removal', amountPaise: 30000 },
];

function fileClaim(ctx, owner, id, items = claimItems) {
  return withPhotos(
    ctx,
    owner,
    `/me/rented-out/${id}/claim`,
    { description: 'The hem is torn and there is a wine stain on the front.', items },
    2,
  );
}

describe('1. no overlapping confirmed bookings', () => {
  it('the database refuses two overlapping paid bookings, even when both are confirmed at once', async () => {
    const ctx = createTestContext();
    const owner = await registerVerifiedUser(ctx);
    const listing = await rentable(owner);
    const renters = [await registerVerifiedUser(ctx), await registerVerifiedUser(ctx)];
    const now = ctx.clock.now();
    const base = {
      listingId: listing.id,
      ownerId: owner.user.id,
      status: 'APPROVED',
      title: listing.title,
      durationDays: 3,
      fulfilment: 'PICKUP',
      feePaise: 150000,
      depositPaise: 500000,
      deliveryChargePaise: 0,
      totalPaise: 650000,
      commissionPaise: 15000,
      ownerPayablePaise: 135000,
      lateFeePerDayPaise: 20000,
      returnDueAt: RETURN_DUE,
      createdAt: now,
    };
    // Written straight to the table: this checks the database, not the server.
    const a = await db.rentalBooking.create({
      data: {
        ...base,
        ref: 'RNT-TESTAAAA',
        renterId: renters[0].user.id,
        startDate: new Date('2026-11-20'),
        endDate: new Date('2026-11-22'),
      },
    });
    const b = await db.rentalBooking.create({
      data: {
        ...base,
        ref: 'RNT-TESTBBBB',
        renterId: renters[1].user.id,
        startDate: new Date('2026-11-22'),
        endDate: new Date('2026-11-24'),
      },
    });

    const results = await Promise.allSettled(
      [a, b].map(
        (booking) =>
          db.$executeRaw`UPDATE rental_bookings SET status = 'CONFIRMED' WHERE id = ${booking.id}::uuid`,
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected');
    expect(String(failure.reason.message)).toMatch(/rental_bookings_no_overlap/);
    expect(await db.rentalBooking.count({ where: { status: 'CONFIRMED' } })).toBe(1);

    // A booking that starts the day after another ends is fine.
    const c = await db.rentalBooking.create({
      data: {
        ...base,
        ref: 'RNT-TESTCCCC',
        renterId: renters[1].user.id,
        startDate: new Date('2026-11-25'),
        endDate: new Date('2026-11-27'),
      },
    });
    await db.$executeRaw`UPDATE rental_bookings SET status = 'CONFIRMED' WHERE id = ${c.id}::uuid`;
    expect(await db.rentalBooking.count({ where: { status: 'CONFIRMED' } })).toBe(2);
  });

  it('of 8 renters asking for overlapping dates at the same moment, exactly one gets them', async () => {
    const ctx = createTestContext();
    const owner = await registerVerifiedUser(ctx);
    const listing = await rentable(owner);
    const renters = [];
    for (let i = 0; i < 8; i += 1) renters.push(await registerVerifiedUser(ctx));

    const results = await Promise.all(
      renters.map((renter, i) =>
        requestBooking(ctx, renter, listing.id, { startDate: i % 2 ? '2026-11-21' : START }),
      ),
    );

    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    const refused = results.filter((res) => res.status !== 201);
    expect(refused.every((res) => res.body.error.code === 'DATES_UNAVAILABLE')).toBe(true);
    expect(await db.rentalDateHold.count({ where: { releasedAt: null } })).toBe(1);
  });
});

describe('2. pending holds', () => {
  it('a request holds the dates for 24 hours, then expires and releases them', async () => {
    const ctx = createTestContext();
    let { owner, renter, listing, booking } = await bookingUpTo(ctx, 'requested');
    let other = await registerVerifiedUser(ctx);

    const blocked = await requestBooking(ctx, other, listing.id, { startDate: '2026-11-21' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('DATES_UNAVAILABLE');

    ctx.clock.advance({ hours: RENTAL_PENDING_HOLD_HOURS, minutes: -1 });
    await runJobs(ctx);
    expect((await db.rentalBooking.findUnique({ where: { id: booking.id } })).status).toBe(
      'REQUESTED',
    );

    ctx.clock.advance({ minutes: 1 });
    await runJobs(ctx);
    const expired = await db.rentalBooking.findUnique({
      where: { id: booking.id },
      include: { hold: true },
    });
    expect(expired.status).toBe('EXPIRED');
    expect(expired.hold.releasedAt).not.toBeNull();
    expect(ctx.lastEmailTo(renter.details.email).subject).toMatch(/expired/i);

    [owner, other] = await signInAgainAll(ctx, owner, other);
    const late = await ownerAction(ctx, owner, booking.id, 'approve');
    expect(late.status).toBe(409);
    const now = await requestBooking(ctx, other, listing.id, { startDate: '2026-11-21' });
    expect(now.status).toBe(201);
  });

  it('an approved request that is not paid in time expires too', async () => {
    const ctx = createTestContext();
    const { booking } = await bookingUpTo(ctx, 'approved');
    expect(booking.status).toBe('APPROVED');
    ctx.clock.set(booking.paymentDueAt);
    await runJobs(ctx);
    const row = await db.rentalBooking.findUnique({
      where: { id: booking.id },
      include: { hold: true },
    });
    expect(row.status).toBe('EXPIRED');
    expect(row.hold.releasedAt).not.toBeNull();
  });
});

describe('3. cancellation refunds', () => {
  it('before approval (and before paying) cancelling is free and refunds nothing', async () => {
    const ctx = createTestContext();
    const { renter, booking } = await bookingUpTo(ctx, 'requested');
    const res = await renterAction(ctx, renter, booking.id, 'cancel');
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('CANCELLED');
    expect(await db.refund.count()).toBe(0);
  });

  it('after paying, before the start day: half the fee, the whole deposit and delivery', async () => {
    const ctx = createTestContext();
    const { renter, booking } = await bookingUpTo(ctx, 'confirmed', {
      listing: { offersDelivery: true, deliveryChargePaise: 8000, deliveryRadiusKm: 10 },
      request: { fulfilment: 'DELIVERY' },
    });
    expect(booking.cancelRefundPaise).toBe(75000 + 500000 + 8000);

    const res = await renterAction(ctx, renter, booking.id, 'cancel');
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('CANCELLED');
    const [refund] = await db.refund.findMany({ where: { bookingId: booking.id } });
    expect(refund).toMatchObject({
      amountPaise: 583000,
      itemsAmountPaise: 75000,
      depositAmountPaise: 500000,
      reason: 'RENTER_CANCELLED',
      status: 'PROCESSED',
    });
    const ledger = await bookingLedger(booking.id);
    expect(ledger.DEPOSIT_REFUND).toBe(500000);
    expect(ledger.BUYER_REFUND).toBe(83000);
    // Commission is worked out again on the half of the fee that stays.
    expect(ledger.COMMISSION - ledger.COMMISSION_REVERSAL).toBe(7500);
  });

  it('on or after the start day: no fee back, but the deposit and delivery are', async () => {
    const ctx = createTestContext();
    let { renter, booking } = await bookingUpTo(ctx, 'confirmed');
    ctx.clock.set('2026-11-20T03:30:00.000Z'); // 9 am India time on the start day
    [renter] = await signInAgainAll(ctx, renter);

    const res = await renterAction(ctx, renter, booking.id, 'cancel');
    expect(res.status).toBe(200);
    const [refund] = await db.refund.findMany({ where: { bookingId: booking.id } });
    expect(refund).toMatchObject({ amountPaise: 500000, itemsAmountPaise: 0 });
    const ledger = await bookingLedger(booking.id);
    expect(ledger.COMMISSION).toBe(15000);
    expect(ledger.COMMISSION_REVERSAL ?? 0).toBe(0);
  });

  it('the owner cancelling a paid booking refunds everything', async () => {
    const ctx = createTestContext();
    const { owner, booking } = await bookingUpTo(ctx, 'confirmed');
    const res = await ownerAction(ctx, owner, booking.id, 'cancel', {
      reason: 'The lehenga got damaged at a wedding',
    });
    expect(res.status).toBe(200);
    const [refund] = await db.refund.findMany({ where: { bookingId: booking.id } });
    expect(refund).toMatchObject({ amountPaise: 650000, reason: 'OWNER_CANCELLED' });
    const ledger = await bookingLedger(booking.id);
    expect(ledger.COMMISSION_REVERSAL).toBe(15000);
    expect(ledger.SELLER_PAYABLE_REVERSAL).toBe(135000);
  });
});

describe('4. late fees', () => {
  it('nothing within the 24-hour grace, then one daily fee per started 24 hours', () => {
    const perDay = 20000;
    const after = (hours, minutes = 0) => addMinutes(addHours(RETURN_DUE, hours), minutes);
    const fee = (returnedAt) =>
      lateFeeFor({ returnDueAt: RETURN_DUE, returnedAt, lateFeePerDayPaise: perDay });
    expect(fee(addHours(RETURN_DUE, -5))).toBe(0);
    expect(fee(after(0, 1))).toBe(0);
    expect(fee(after(24))).toBe(0);
    expect(fee(after(24, 1))).toBe(perDay);
    expect(fee(after(48))).toBe(perDay);
    expect(fee(after(48, 1))).toBe(2 * perDay);
    expect(fee(after(24 * 5))).toBe(4 * perDay);
  });

  it('a return 25 hours late is charged one day', async () => {
    const ctx = createTestContext();
    const { booking } = await bookingUpTo(ctx, 'returned', { returnAt: addHours(RETURN_DUE, 25) });
    expect(booking.status).toBe('RETURNED');
    expect(booking.lateFeePaise).toBe(20000);
  });

  it('the late fee is shown before booking', async () => {
    const ctx = createTestContext();
    const { booking } = await bookingUpTo(ctx, 'requested');
    expect(booking.lateFeePerDayPaise).toBe(20000);
    expect(booking.returnDueAt).toBe(RETURN_DUE.toISOString());
    expect(booking.endDate).toBe(END);
  });
});

describe('5. missed inspection', () => {
  it('48 hours after an on-time return, the whole deposit is refunded, exactly once', async () => {
    const ctx = createTestContext();
    const { booking } = await bookingUpTo(ctx, 'returned', { returnAt: addHours(RETURN_DUE, -2) });
    const returnedAt = new Date(booking.returnedAt);

    ctx.clock.set(addMinutes(addHours(returnedAt, DEPOSIT_AUTO_REFUND_AFTER_RETURN_HOURS), -1));
    await runJobs(ctx);
    expect(await db.refund.count({ where: { bookingId: booking.id } })).toBe(0);

    ctx.clock.set(addHours(returnedAt, DEPOSIT_AUTO_REFUND_AFTER_RETURN_HOURS));
    await runJobs(ctx);
    await runJobs(ctx);
    ctx.clock.advance({ hours: 3 });
    await runJobs(ctx);

    const refunds = await db.refund.findMany({ where: { bookingId: booking.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      amountPaise: 500000,
      depositAmountPaise: 500000,
      reason: 'DEPOSIT_RETURN',
      status: 'PROCESSED',
    });
    expect(ctx.gateway.refunds).toHaveLength(1);
    const row = await db.rentalBooking.findUnique({ where: { id: booking.id } });
    expect(row.status).toBe('COMPLETED');
    expect(row.depositRefundedPaise).toBe(500000);
    expect((await bookingLedger(booking.id)).DEPOSIT_REFUND).toBe(500000);
  });
});

describe('6. damage claims', () => {
  it('a timely claim stops the automatic refund; unanswered for 48 hours it goes to an admin', async () => {
    const ctx = createTestContext();
    let { owner, booking } = await bookingUpTo(ctx, 'returned', {
      returnAt: addHours(RETURN_DUE, -2),
    });
    const returnedAt = new Date(booking.returnedAt);
    ctx.clock.set(addHours(returnedAt, 47));
    [owner] = await signInAgainAll(ctx, owner);

    const claimed = await fileClaim(ctx, owner, booking.id);
    expect(claimed.status).toBe(201);
    expect(claimed.body.booking.status).toBe('CLAIM_OPEN');
    expect(claimed.body.booking.claim.totalPaise).toBe(150000);

    ctx.clock.set(addHours(returnedAt, 49));
    await runJobs(ctx);
    expect(await db.refund.count({ where: { bookingId: booking.id } })).toBe(0);
    expect((await db.rentalBooking.findUnique({ where: { id: booking.id } })).status).toBe(
      'CLAIM_OPEN',
    );

    // No answer in 48 hours: the dispute goes to an admin (Step 8).
    ctx.clock.set(addHours(returnedAt, 47 + CLAIM_RESPONSE_HOURS));
    await runDisputeJobs(ctx);
    const dispute = await db.dispute.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(dispute).toMatchObject({ status: 'UNDER_REVIEW', respondedAt: null });
    expect((await db.rentalBooking.findUnique({ where: { id: booking.id } })).status).toBe(
      'ADMIN_REVIEW',
    );

    const admin = await registerAdmin(ctx);
    const decided = await adminDispute(ctx, admin, dispute.id, 'decide', {
      outcome: 'SETTLE',
      damagePaise: 100000,
      lateFeePaise: 0,
      reason: 'Photos show the tear; the stain was there before the rental',
    });
    expect(decided.status).toBe(200);
    expect(await db.adminAuditLog.count({ where: { targetId: dispute.id } })).toBe(1);
    ctx.clock.advance({ days: APPEAL_WINDOW_DAYS });
    await runDisputeJobs(ctx);
    expect((await db.rentalBooking.findUnique({ where: { id: booking.id } })).status).toBe(
      'COMPLETED',
    );
    const [refund] = await db.refund.findMany({ where: { bookingId: booking.id } });
    expect(refund).toMatchObject({ amountPaise: 400000, depositAmountPaise: 400000 });
  });

  it('the renter can accept a claim, which settles it, or dispute it, which goes to an admin', async () => {
    const ctx = createTestContext();
    const accepted = await bookingUpTo(ctx, 'returned', { returnAt: addHours(RETURN_DUE, -1) });
    await fileClaim(ctx, accepted.owner, accepted.booking.id);
    const yes = await renterAction(ctx, accepted.renter, accepted.booking.id, 'claim-response', {
      accept: true,
    });
    expect(yes.status).toBe(200);
    expect(yes.body.booking.status).toBe('COMPLETED');
    expect(yes.body.booking.depositDeductedPaise).toBe(150000);
    expect(
      (await db.refund.findFirst({ where: { bookingId: accepted.booking.id } })).amountPaise,
    ).toBe(350000);

    const other = createTestContext();
    const disputed = await bookingUpTo(other, 'returned', { returnAt: addHours(RETURN_DUE, -1) });
    await fileClaim(other, disputed.owner, disputed.booking.id);
    const no = await renterAction(other, disputed.renter, disputed.booking.id, 'claim-response', {
      accept: false,
      reason: 'The stain was already there in the handover photos',
    });
    expect(no.status).toBe(200);
    expect(no.body.booking.status).toBe('ADMIN_REVIEW');
    expect(await db.refund.count({ where: { bookingId: disputed.booking.id } })).toBe(0);
  });

  it('a claim after the 48-hour inspection window is refused', async () => {
    const ctx = createTestContext();
    let { owner, booking } = await bookingUpTo(ctx, 'returned', {
      returnAt: addHours(RETURN_DUE, -1),
    });
    ctx.clock.set(addHours(new Date(booking.returnedAt), DEPOSIT_AUTO_REFUND_AFTER_RETURN_HOURS));
    [owner] = await signInAgainAll(ctx, owner);
    const res = await fileClaim(ctx, owner, booking.id);
    expect(res.status).toBe(409);
  });
});

describe('7. late fees from the deposit', () => {
  it('a late fee comes out of the deposit and the rest is refunded', async () => {
    const ctx = createTestContext();
    let { owner, booking } = await bookingUpTo(ctx, 'returned', {
      returnAt: addHours(RETURN_DUE, 30),
    });
    expect(booking.lateFeePaise).toBe(20000);
    const res = await ownerAction(ctx, owner, booking.id, 'inspection-ok');
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('COMPLETED');
    const [refund] = await db.refund.findMany({ where: { bookingId: booking.id } });
    expect(refund.amountPaise).toBe(480000);
    const ledger = await bookingLedger(booking.id);
    expect(ledger.DEPOSIT_DEDUCTION).toBe(20000);
    // The late fee is the owner's, with no commission on it.
    expect(ledger.SELLER_PAYABLE).toBe(135000 + 20000);
    expect(ledger.COMMISSION).toBe(15000);
  });

  it('a late fee larger than the deposit uses all of it and records the rest as owed', async () => {
    const ctx = createTestContext();
    const { owner, booking } = await bookingUpTo(ctx, 'returned', {
      listing: { lateFeePerDayPaise: 200000 },
      returnAt: addMinutes(addHours(RETURN_DUE, 72), 1),
    });
    expect(booking.lateFeePaise).toBe(600000);
    const res = await ownerAction(ctx, owner, booking.id, 'inspection-ok');
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({
      status: 'COMPLETED',
      depositDeductedPaise: 500000,
      owedPaise: 100000,
    });
    expect(await db.refund.count({ where: { bookingId: booking.id } })).toBe(0);
    expect((await bookingLedger(booking.id)).DEPOSIT_DEDUCTION).toBe(500000);
  });
});

describe('8. the deposit is its own money', () => {
  it('paid together, recorded apart: no commission on the deposit, and it all goes back', async () => {
    const ctx = createTestContext();
    const { owner, booking } = await bookingUpTo(ctx, 'returned', {
      listing: { offersDelivery: true, deliveryChargePaise: 8000, deliveryRadiusKm: 10 },
      request: { fulfilment: 'DELIVERY' },
      returnAt: addHours(RETURN_DUE, -3),
    });
    const paid = await bookingLedger(booking.id);
    expect(paid.BUYER_PAYMENT).toBe(150000 + 8000);
    expect(paid.DEPOSIT_COLLECTED).toBe(500000);
    expect(paid.COMMISSION).toBe(15000);
    expect(paid.SELLER_PAYABLE).toBe(150000 - 15000 + 8000);
    expect(paid.GATEWAY_FEE).toBeGreaterThan(0);

    await ownerAction(ctx, owner, booking.id, 'inspection-ok');
    const settled = await bookingLedger(booking.id);
    expect(settled.DEPOSIT_REFUND).toBe(500000);
    expect(settled.DEPOSIT_COLLECTED).toBe(
      settled.DEPOSIT_REFUND + (settled.DEPOSIT_DEDUCTION ?? 0),
    );
    // The deposit never shows up in revenue or the owner's earnings.
    expect(settled.COMMISSION).toBe(15000);
    expect(settled.SELLER_PAYABLE).toBe(143000);
    const view = await ownerView(ctx, owner, booking.id);
    expect(view.payoutEligible).toBe(true);
  });

  it('the renter sees the deposit apart from the fee, and the total they pay', async () => {
    const ctx = createTestContext();
    const { renter, booking } = await bookingUpTo(ctx, 'approved');
    const view = await renterView(ctx, renter, booking.id);
    expect(view).toMatchObject({
      feePaise: 150000,
      depositPaise: 500000,
      deliveryChargePaise: 0,
      totalPaise: 650000,
    });
  });
});
