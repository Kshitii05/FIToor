import request from 'supertest';
import { db, registerVerifiedUser } from './helpers.js';
import { insertListing, PNG } from './listings.js';
import { NEAR, saveAddress, sendWebhook, signInAgain } from './orders.js';

const API = '/api/v1';

/** Fresh access tokens for each account, after the clock has moved on. */
export const signInAgainAll = (ctx, ...accounts) =>
  Promise.all(accounts.map((account) => signInAgain(ctx, account)));

// The test clock starts on Friday 13 November 2026 at 12:00 India time. A booking
// from the 20th for 3 days ends on the 22nd and is due back by 8 pm that day.
export const START = '2026-11-20';
export const END = '2026-11-22';
export const RETURN_DUE = new Date('2026-11-22T14:30:00.000Z');

/** A rent listing with a 3-day package of ₹1,500 and a ₹5,000 deposit, pickup only. */
export function rentable(owner, overrides = {}) {
  return insertListing(owner, {
    mode: 'RENT',
    packages: [
      { durationDays: 3, pricePaise: 150000 },
      { durationDays: 7, pricePaise: 300000 },
    ],
    depositPaise: 500000,
    lateFeePerDayPaise: 20000,
    offersPickup: true,
    location: NEAR,
    ...overrides,
  });
}

export function requestBooking(ctx, renter, listingId, overrides = {}) {
  return request(ctx.app)
    .post(`${API}/rentals`)
    .set(renter.bearer)
    .send({ listingId, durationDays: 3, startDate: START, fulfilment: 'PICKUP', ...overrides });
}

export function renterAction(ctx, renter, id, action, body = {}) {
  return request(ctx.app).post(`${API}/me/rentals/${id}/${action}`).set(renter.bearer).send(body);
}

export function ownerAction(ctx, owner, id, action, body = {}) {
  return request(ctx.app).post(`${API}/me/rented-out/${id}/${action}`).set(owner.bearer).send(body);
}

export function adminRentalAction(ctx, admin, id, action, body = {}) {
  return request(ctx.app).post(`${API}/admin/rentals/${id}/${action}`).set(admin.bearer).send(body);
}

export const renterView = async (ctx, renter, id) =>
  (await request(ctx.app).get(`${API}/me/rentals/${id}`).set(renter.bearer)).body.booking;

export const ownerView = async (ctx, owner, id) =>
  (await request(ctx.app).get(`${API}/me/rented-out/${id}`).set(owner.bearer)).body.booking;

/** Sends a code with condition photos: the handover (owner) or the return (renter). */
export function withPhotos(ctx, account, path, data, photos = 2) {
  const req = request(ctx.app)
    .post(`${API}${path}`)
    .set(account.bearer)
    .field('data', JSON.stringify(data));
  for (let i = 0; i < photos; i += 1) req.attach('photos', PNG, `photo-${i}.png`);
  return req;
}

/** Starts the payment and pays it through a signed webhook, as the gateway would. */
export async function payBooking(ctx, renter, id) {
  const started = await renterAction(ctx, renter, id, 'pay');
  if (started.status !== 200) {
    throw new Error(`Starting payment failed: ${started.status} ${JSON.stringify(started.body)}`);
  }
  const entity = ctx.gateway.pay(started.body.booking.payment.gatewayOrderId);
  const res = await sendWebhook(ctx, { event: 'payment.captured', entity });
  if (res.status !== 200) throw new Error(`Webhook failed: ${res.status}`);
  return entity;
}

function ok(res, what) {
  if (res.status >= 300)
    throw new Error(`${what} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.booking;
}

/**
 * A booking taken as far as `until`: 'requested', 'approved', 'confirmed',
 * 'active' or 'returned'. `returnAt` moves the clock before the return.
 */
export async function bookingUpTo(
  ctx,
  until,
  { listing: listingOverrides, request: requestOverrides, returnAt } = {},
) {
  let owner = await registerVerifiedUser(ctx);
  let renter = await registerVerifiedUser(ctx);
  const listing = await rentable(owner, listingOverrides);
  const extra = { ...requestOverrides };
  if (extra.fulfilment === 'DELIVERY' && !extra.addressId) {
    extra.addressId = (await saveAddress(ctx, renter)).id;
  }
  let booking = ok(await requestBooking(ctx, renter, listing.id, extra), 'Request');
  const result = () => ({ owner, renter, listing, booking });
  if (until === 'requested') return result();

  booking = ok(await ownerAction(ctx, owner, booking.id, 'approve'), 'Approve');
  if (until === 'approved') return result();

  await payBooking(ctx, renter, booking.id);
  booking = await renterView(ctx, renter, booking.id);
  if (until === 'confirmed') return result();

  booking = ok(
    await withPhotos(ctx, owner, `/me/rented-out/${booking.id}/handover`, {
      code: booking.handoverCode,
    }),
    'Handover',
  );
  if (until === 'active') return result();

  if (returnAt) {
    ctx.clock.set(returnAt);
    [owner, renter] = await signInAgainAll(ctx, owner, renter);
  }
  const { returnCode } = await ownerView(ctx, owner, booking.id);
  booking = ok(
    await withPhotos(ctx, renter, `/me/rentals/${booking.id}/return`, { code: returnCode }),
    'Return',
  );
  return result();
}

/** Ledger rows of one booking as `{ type: total }`. */
export async function bookingLedger(bookingId) {
  const rows = await db.ledgerEntry.findMany({ where: { bookingId } });
  const totals = {};
  for (const row of rows) totals[row.type] = (totals[row.type] ?? 0) + row.amountPaise;
  return totals;
}

/** Runs the rental deadline jobs with the app's own dependencies. */
export async function runJobs(ctx) {
  const { runRentalJobs } = await import('../src/modules/rentals/rental.jobs.js');
  return runRentalJobs(ctx.app.locals.deps);
}
