// Rentals beyond the playbook: who may do what, what each side sees, payment edge
// cases, closed days, disputes and admin fallbacks.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  APPEAL_WINDOW_DAYS,
  HANDOVER_MAX_ATTEMPTS,
  RENTAL_NON_RETURN_REPORT_DAYS,
} from '../../config/policy.js';
import { addDays, addHours } from '../../lib/clock.js';
import {
  createTestContext,
  db,
  registerUser,
  registerVerifiedUser,
  resetDb,
} from '../../../test/helpers.js';
import { registerAdmin, saveAddress, sendWebhook } from '../../../test/orders.js';
import {
  adminRentalAction,
  bookingLedger,
  bookingUpTo,
  ownerAction,
  ownerView,
  rentable,
  renterAction,
  renterView,
  requestBooking,
  RETURN_DUE,
  runJobs,
  signInAgainAll,
  withPhotos,
} from '../../../test/rentals.js';
import { insertListing } from '../../../test/listings.js';
import { retryRefunds } from '../payments/refunds.service.js';
import { adminDispute, runDisputeJobs } from '../../../test/disputes.js';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const API = '/api/v1';

describe('asking to rent', () => {
  it('needs a verified account, a rent listing that is not your own, and a package the owner offers', async () => {
    const ctx = createTestContext();
    const owner = await registerVerifiedUser(ctx);
    const listing = await rentable(owner);
    const unverified = await registerUser(ctx);
    const renter = await registerVerifiedUser(ctx);
    const sale = await insertListing(owner, { pricePaise: 50000 });

    expect((await requestBooking(ctx, unverified, listing.id)).status).toBe(403);
    expect((await requestBooking(ctx, owner, listing.id)).body.error.code).toBe('OWN_LISTING');
    expect((await requestBooking(ctx, renter, sale.id)).body.error.code).toBe('NOT_FOR_RENT');
    const odd = await requestBooking(ctx, renter, listing.id, { durationDays: 5 });
    expect(odd.status).toBe(400);
    expect(odd.body.error.details.durations).toEqual([3, 7]);
    expect(
      (await requestBooking(ctx, renter, listing.id, { startDate: '2026-11-13' })).body.error.code,
    ).toBe('START_DATE');
    expect(
      (await requestBooking(ctx, renter, listing.id, { startDate: '2027-03-01' })).body.error.code,
    ).toBe('START_DATE');
    expect(
      (await requestBooking(ctx, renter, listing.id, { startDate: '2026-02-30' })).status,
    ).toBe(400);
    expect((await requestBooking(ctx, renter, listing.id, { fulfilment: 'DELIVERY' })).status).toBe(
      400,
    );
  });

  it('delivery needs an address inside the owner delivery area', async () => {
    const ctx = createTestContext();
    const owner = await registerVerifiedUser(ctx);
    const renter = await registerVerifiedUser(ctx);
    const listing = await rentable(owner, {
      offersDelivery: true,
      deliveryChargePaise: 8000,
      deliveryRadiusKm: 2,
    });
    const far = await saveAddress(ctx, renter, { lat: 13.1, lng: 77.6, label: 'Far' });
    const res = await requestBooking(ctx, renter, listing.id, {
      fulfilment: 'DELIVERY',
      addressId: far.id,
    });
    expect(res.body.error.code).toBe('OUTSIDE_DELIVERY_AREA');
  });

  it('caps how many unpaid requests one renter can have', async () => {
    const ctx = createTestContext();
    const owner = await registerVerifiedUser(ctx);
    const renter = await registerVerifiedUser(ctx);
    for (let i = 0; i < 5; i += 1) {
      const listing = await rentable(owner);
      expect((await requestBooking(ctx, renter, listing.id)).status).toBe(201);
    }
    const sixth = await rentable(owner);
    expect((await requestBooking(ctx, renter, sixth.id)).body.error.code).toBe(
      'TOO_MANY_OPEN_REQUESTS',
    );
  });
});

describe('who can see and change a booking', () => {
  it('only its renter, its owner and admins', async () => {
    const ctx = createTestContext();
    const { owner, renter, booking } = await bookingUpTo(ctx, 'requested');
    const stranger = await registerVerifiedUser(ctx);

    for (const path of [`/me/rentals/${booking.id}`, `/me/rented-out/${booking.id}`]) {
      expect((await request(ctx.app).get(`${API}${path}`).set(stranger.bearer)).status).toBe(404);
    }
    // Each side uses its own address: the renter cannot approve, the owner cannot pay.
    expect((await ownerAction(ctx, renter, booking.id, 'approve')).status).toBe(404);
    expect((await renterAction(ctx, owner, booking.id, 'pay')).status).toBe(404);
    expect(
      (await adminRentalAction(ctx, owner, booking.id, 'cancel', { reason: 'no reason at all' }))
        .status,
    ).toBe(403);
    expect((await request(ctx.app).get(`${API}/me/rentals/${booking.id}`)).status).toBe(401);

    const admin = await registerAdmin(ctx);
    const seen = await request(ctx.app).get(`${API}/admin/rentals/${booking.id}`).set(admin.bearer);
    expect(seen.status).toBe(200);
    expect(seen.body.booking.renterView.id).toBe(booking.id);
  });

  it('lists are paginated and can be filtered by status', async () => {
    const ctx = createTestContext();
    const { owner, renter } = await bookingUpTo(ctx, 'requested');
    const list = await request(ctx.app)
      .get(`${API}/me/rentals?status=REQUESTED&pageSize=1`)
      .set(renter.bearer);
    expect(list.body).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    const none = await request(ctx.app)
      .get(`${API}/me/rented-out?status=COMPLETED`)
      .set(owner.bearer);
    expect(none.body.total).toBe(0);
  });
});

describe('location and contact privacy', () => {
  it('the exact pickup spot and phone numbers are shared only once paid, and only while it runs', async () => {
    const ctx = createTestContext();
    let { owner, renter, booking } = await bookingUpTo(ctx, 'approved');
    let view = await renterView(ctx, renter, booking.id);
    expect(view.pickup).toBeNull();
    expect(view.owner.phone).toBeNull();
    expect(JSON.stringify(view)).not.toContain('12.97194');

    const { payBooking } = await import('../../../test/rentals.js');
    await payBooking(ctx, renter, booking.id);
    view = await renterView(ctx, renter, booking.id);
    expect(view.pickup).toMatchObject({ lat: 12.97194, lng: 77.64115 });
    expect(view.owner.phone).not.toBeNull();
    expect(view.handoverCode).toMatch(/^\d{6}$/);
    expect((await ownerView(ctx, owner, booking.id)).handoverCode).toBeUndefined();

    await renterAction(ctx, renter, booking.id, 'cancel');
    view = await renterView(ctx, renter, booking.id);
    expect(view.pickup).toBeNull();
    expect(view.owner.phone).toBeNull();
  });

  it('the owner sees the delivery address only once paid', async () => {
    const ctx = createTestContext();
    const { owner, renter, booking } = await bookingUpTo(ctx, 'approved', {
      listing: { offersDelivery: true, deliveryChargePaise: 8000, deliveryRadiusKm: 10 },
      request: { fulfilment: 'DELIVERY' },
    });
    expect((await ownerView(ctx, owner, booking.id)).deliveryAddress).toBeNull();
    const { payBooking } = await import('../../../test/rentals.js');
    await payBooking(ctx, renter, booking.id);
    expect((await ownerView(ctx, owner, booking.id)).deliveryAddress.line1).toBeTruthy();
  });

  it('public availability shows taken days only: no names, prices or places', async () => {
    const ctx = createTestContext();
    const { listing } = await bookingUpTo(ctx, 'confirmed');
    const res = await request(ctx.app).get(`${API}/rentals/availability/${listing.id}`);
    expect(res.status).toBe(200);
    expect(res.body.blocked).toEqual([{ startDate: '2026-11-20', endDate: '2026-11-22' }]);
    expect(res.body.firstStartDate).toBe('2026-11-14');
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/renter|owner|lat|lng|RNT-/);

    const sale = await insertListing(await registerVerifiedUser(ctx), { pricePaise: 1000 });
    expect((await request(ctx.app).get(`${API}/rentals/availability/${sale.id}`)).status).toBe(404);
  });
});

describe('paying', () => {
  it('a repeated webhook changes nothing; a second payment is refunded in full', async () => {
    const ctx = createTestContext();
    const { renter, booking } = await bookingUpTo(ctx, 'approved');
    const started = await renterAction(ctx, renter, booking.id, 'pay');
    const orderId = started.body.booking.payment.gatewayOrderId;
    const first = ctx.gateway.pay(orderId);
    await sendWebhook(ctx, { event: 'payment.captured', entity: first });
    await sendWebhook(ctx, { event: 'payment.captured', entity: first });
    await sendWebhook(ctx, { event: 'order.paid', entity: first, eventId: 'evt_other' });

    expect(await db.payment.count({ where: { bookingId: booking.id } })).toBe(1);
    const once = await bookingLedger(booking.id);
    expect(once.DEPOSIT_COLLECTED).toBe(500000);

    const second = ctx.gateway.pay(orderId);
    await sendWebhook(ctx, { event: 'payment.captured', entity: second });
    const refunds = await db.refund.findMany({ where: { bookingId: booking.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amountPaise: 650000, reason: 'DUPLICATE_PAYMENT' });
    const after = await bookingLedger(booking.id);
    expect(after.DEPOSIT_COLLECTED).toBe(500000);
    expect(after.BUYER_REFUND).toBe(650000);
    expect(after.DEPOSIT_REFUND ?? 0).toBe(0);
  });

  it('a payment that arrives after the booking expired is refunded, and the dates stay free', async () => {
    const ctx = createTestContext();
    const { renter, booking } = await bookingUpTo(ctx, 'approved');
    const started = await renterAction(ctx, renter, booking.id, 'pay');
    ctx.clock.set(booking.paymentDueAt);
    await runJobs(ctx);
    const entity = ctx.gateway.pay(started.body.booking.payment.gatewayOrderId);
    await sendWebhook(ctx, { event: 'payment.captured', entity });

    const row = await db.rentalBooking.findUnique({ where: { id: booking.id } });
    expect(row.status).toBe('EXPIRED');
    const [refund] = await db.refund.findMany({ where: { bookingId: booking.id } });
    expect(refund).toMatchObject({ amountPaise: 650000, reason: 'LATE_PAYMENT' });
  });

  it('the simulated payment in development confirms the booking through the same path', async () => {
    const ctx = createTestContext();
    const { renter, booking } = await bookingUpTo(ctx, 'approved');
    await renterAction(ctx, renter, booking.id, 'pay');
    const failed = await renterAction(ctx, renter, booking.id, 'simulate-payment', {
      outcome: 'failure',
    });
    expect(failed.body.booking.status).toBe('APPROVED');
    const paid = await renterAction(ctx, renter, booking.id, 'simulate-payment', {
      outcome: 'success',
    });
    expect(paid.body.booking.status).toBe('CONFIRMED');
    expect(ctx.lastEmailTo(renter.details.email).subject).toMatch(/booked/);
  });
});

describe('handover and return', () => {
  it('needs the right code and at least 2 photos; wrong codes lock after 5 tries', async () => {
    const ctx = createTestContext();
    const { owner, booking } = await bookingUpTo(ctx, 'confirmed');
    const path = `/me/rented-out/${booking.id}/handover`;

    const onePhoto = await withPhotos(ctx, owner, path, { code: booking.handoverCode }, 1);
    expect(onePhoto.body.error.code).toBe('CONDITION_PHOTOS');

    const wrong = booking.handoverCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < HANDOVER_MAX_ATTEMPTS; i += 1) {
      const res = await withPhotos(ctx, owner, path, { code: wrong });
      expect(res.body.error.code).toBe('WRONG_CODE');
    }
    const locked = await withPhotos(ctx, owner, path, { code: booking.handoverCode });
    expect(locked.status).toBe(429);

    const admin = await registerAdmin(ctx);
    const verified = await adminRentalAction(ctx, admin, booking.id, 'verify-handover', {
      reason: 'Both sides confirmed on a call',
    });
    expect(verified.body.booking.status).toBe('ACTIVE');
    expect(await db.adminAuditLog.count({ where: { action: 'VERIFY_HANDOVER' } })).toBe(1);
  });

  it('keeps timestamped condition photos from both handover and return', async () => {
    const ctx = createTestContext();
    const { owner, booking } = await bookingUpTo(ctx, 'returned', {
      returnAt: addHours(RETURN_DUE, -1),
    });
    const view = await ownerView(ctx, owner, booking.id);
    expect(view.handoverPhotos).toHaveLength(2);
    expect(view.returnPhotos).toHaveLength(2);
    expect(view.returnPhotos[0].takenAt).toBe(view.returnedAt);
  });

  it('a missing item can be reported 3 days after it was due; an admin confirms when it is back', async () => {
    const ctx = createTestContext();
    let { owner, booking } = await bookingUpTo(ctx, 'active');
    ctx.clock.set(addDays(RETURN_DUE, RENTAL_NON_RETURN_REPORT_DAYS - 1));
    [owner] = await signInAgainAll(ctx, owner);
    expect((await ownerAction(ctx, owner, booking.id, 'report-non-return')).body.error.code).toBe(
      'TOO_EARLY',
    );

    ctx.clock.set(addDays(RETURN_DUE, RENTAL_NON_RETURN_REPORT_DAYS));
    [owner] = await signInAgainAll(ctx, owner);
    const reported = await ownerAction(ctx, owner, booking.id, 'report-non-return');
    expect(reported.body.booking.status).toBe('ADMIN_REVIEW');

    // The report is a dispute; an admin decides it came back (Step 8).
    const admin = await registerAdmin(ctx);
    const dispute = await db.dispute.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(dispute.kind).toBe('NOT_RETURNED');
    await adminDispute(ctx, admin, dispute.id, 'decide', {
      outcome: 'RETURNED',
      reason: 'Returned at our office',
    });
    ctx.clock.advance({ days: APPEAL_WINDOW_DAYS });
    await runDisputeJobs(ctx);
    const back = await db.rentalBooking.findUnique({ where: { id: booking.id } });
    expect(back.status).toBe('RETURNED');
    // Returned when the decision took effect: 6 days after the due time, 5 started days late.
    expect(back.lateFeePaise).toBe(5 * 20000);
  });

  it('sends the day-before, due-day and overdue reminders once each', async () => {
    const ctx = createTestContext();
    const { renter, owner } = await bookingUpTo(ctx, 'active');
    ctx.clock.set(addHours(RETURN_DUE, -20));
    expect((await runJobs(ctx)).remindedBefore).toBe(1);
    expect((await runJobs(ctx)).remindedBefore).toBe(0);
    ctx.clock.set(addHours(RETURN_DUE, -6));
    expect((await runJobs(ctx)).remindedDueDay).toBe(1);
    ctx.clock.set(addHours(RETURN_DUE, 1));
    expect((await runJobs(ctx)).overdue).toBe(1);
    expect((await runJobs(ctx)).overdue).toBe(0);
    expect(ctx.lastEmailTo(renter.details.email).subject).toMatch(/overdue/);
    expect(ctx.lastEmailTo(owner.details.email).subject).toMatch(/not come back/);
  });
});

describe('settling the deposit', () => {
  it('a disputed late fee sends the settlement to an admin instead of deducting it', async () => {
    const ctx = createTestContext();
    const { owner, renter, booking } = await bookingUpTo(ctx, 'returned', {
      returnAt: addHours(RETURN_DUE, 30),
    });
    const disputed = await renterAction(ctx, renter, booking.id, 'dispute-late-fee', {
      reason: 'The owner was not home when I came on time',
    });
    expect(disputed.body.booking.lateFeeDisputed).toBe(true);
    const inspected = await ownerAction(ctx, owner, booking.id, 'inspection-ok');
    expect(inspected.body.booking.status).toBe('ADMIN_REVIEW');
    expect(await db.refund.count({ where: { bookingId: booking.id } })).toBe(0);

    const admin = await registerAdmin(ctx);
    const dispute = await db.dispute.findFirstOrThrow({ where: { bookingId: booking.id } });
    await adminDispute(ctx, admin, dispute.id, 'decide', {
      outcome: 'SETTLE',
      damagePaise: 0,
      lateFeePaise: 0,
      reason: 'Messages show the owner postponed the return',
    });
    ctx.clock.advance({ days: APPEAL_WINDOW_DAYS });
    await runDisputeJobs(ctx);
    expect((await db.rentalBooking.findUnique({ where: { id: booking.id } })).status).toBe(
      'COMPLETED',
    );
    expect((await db.refund.findFirst({ where: { bookingId: booking.id } })).amountPaise).toBe(
      500000,
    );
  });

  it('a deposit refund the gateway refuses stays pending and completes on retry, once', async () => {
    const ctx = createTestContext();
    const { owner, booking } = await bookingUpTo(ctx, 'returned', {
      returnAt: addHours(RETURN_DUE, -1),
    });
    ctx.gateway.refundOutcome = 'error';
    const res = await ownerAction(ctx, owner, booking.id, 'inspection-ok');
    expect(res.body.booking.status).toBe('SETTLING');

    ctx.gateway.refundOutcome = 'processed';
    ctx.clock.advance({ minutes: 5 });
    await retryRefunds(ctx.app.locals.deps);
    await retryRefunds(ctx.app.locals.deps);
    const row = await db.rentalBooking.findUnique({ where: { id: booking.id } });
    expect(row.status).toBe('COMPLETED');
    expect(ctx.gateway.refunds).toHaveLength(1);
    expect((await bookingLedger(booking.id)).DEPOSIT_REFUND).toBe(500000);
  });

  it('the database refuses using more than the deposit', async () => {
    const ctx = createTestContext();
    const { booking } = await bookingUpTo(ctx, 'returned', { returnAt: addHours(RETURN_DUE, -1) });
    await expect(
      db.rentalBooking.update({
        where: { id: booking.id },
        data: { depositDeductedPaise: 400000, depositRefundedPaise: 200000 },
      }),
    ).rejects.toThrow(/rental_bookings_amounts/);
  });

  it('booking history cannot be changed', async () => {
    const ctx = createTestContext();
    const { booking } = await bookingUpTo(ctx, 'requested');
    await expect(
      db.$executeRaw`UPDATE booking_events SET action = 'X' WHERE booking_id = ${booking.id}::uuid`,
    ).rejects.toThrow(/append-only/);
  });
});

describe('closed days', () => {
  it('the owner can close days; requests for them are refused; booked days cannot be closed', async () => {
    const ctx = createTestContext();
    const { owner, listing } = await bookingUpTo(ctx, 'confirmed');
    const renter = await registerVerifiedUser(ctx);
    const block = (body) =>
      request(ctx.app)
        .post(`${API}/me/blocked-dates`)
        .set(owner.bearer)
        .send({ listingId: listing.id, ...body });

    expect((await block({ startDate: '2026-11-21', endDate: '2026-11-23' })).body.error.code).toBe(
      'DATES_UNAVAILABLE',
    );
    const closed = await block({ startDate: '2026-11-25', endDate: '2026-11-26' });
    expect(closed.status).toBe(201);

    const res = await requestBooking(ctx, renter, listing.id, { startDate: '2026-11-24' });
    expect(res.body.error.code).toBe('DATES_UNAVAILABLE');
    const shown = await request(ctx.app).get(`${API}/rentals/availability/${listing.id}`);
    expect(shown.body.blocked).toEqual([
      { startDate: '2026-11-20', endDate: '2026-11-22' },
      { startDate: '2026-11-25', endDate: '2026-11-26' },
    ]);

    const stranger = await registerVerifiedUser(ctx);
    expect(
      (
        await request(ctx.app)
          .delete(`${API}/me/blocked-dates/${closed.body.blocked.id}`)
          .set(stranger.bearer)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(ctx.app)
          .delete(`${API}/me/blocked-dates/${closed.body.blocked.id}`)
          .set(owner.bearer)
      ).status,
    ).toBe(204);
    expect(
      (await requestBooking(ctx, renter, listing.id, { startDate: '2026-11-24' })).status,
    ).toBe(201);
  });
});

describe('accounts with rentals', () => {
  it('cannot be deleted while a rental is unfinished', async () => {
    const ctx = createTestContext();
    const { renter } = await bookingUpTo(ctx, 'confirmed');
    const res = await request(ctx.app)
      .post(`${API}/me/deletion`)
      .set(renter.bearer)
      .send({ password: renter.details.password });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/rentals/);
  });
});
