// The MVP success criterion (SPEC 10 and 11) as two whole journeys through the API,
// each from sign-up to review: one purchase and one rental. Only the payment gateway
// is simulated; everything else is the real app on the test database.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ISSUE_REPORT_WINDOW_DAYS } from '../config/policy.js';
import { addHours } from '../lib/clock.js';
import { createTestContext, db, registerUser, resetDb } from '../../test/helpers.js';
import { createListing, INDIRANAGAR, rentDetails, saleDetails } from '../../test/listings.js';
import { sendMessage, startChat } from '../../test/messaging.js';
import {
  addToCart,
  buyerAction,
  ledgerTotals,
  payCheckout,
  saveAddress,
  sellerAction,
  signInAgain,
  startCheckout,
} from '../../test/orders.js';
import {
  bookingLedger,
  ownerAction,
  payBooking,
  renterAction,
  RETURN_DUE,
  signInAgainAll,
  START,
  withPhotos,
} from '../../test/rentals.js';
import { runOrderJobs } from '../modules/orders/order.jobs.js';

const API = '/api/v1';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

/** Registers and verifies both contacts with the codes the app actually sent. */
async function signUp(ctx, displayName) {
  const account = await registerUser(ctx, { displayName });
  for (const [channel, code] of [
    ['email', ctx.emailCode(account.details.email)],
    ['phone', ctx.phoneCode(account.details.phone)],
  ]) {
    const res = await request(ctx.app)
      .post(`${API}/auth/otp/verify`)
      .set(account.bearer)
      .send({ channel, code });
    expect(res.status, `verify ${channel}`).toBe(200);
  }
  const me = await request(ctx.app).get(`${API}/me`).set(account.bearer);
  expect(me.body.user).toMatchObject({ emailVerified: true, phoneVerified: true });
  return account;
}

/** Finds a listing by searching near a point, as a person nearby would. */
async function findNearby(ctx, account, title) {
  const res = await request(ctx.app)
    .get(
      `${API}/listings?lat=12.975&lng=77.645&radiusKm=5&sort=nearest&q=${encodeURIComponent(title)}`,
    )
    .set(account.bearer);
  expect(res.status).toBe(200);
  const found = res.body.items.find((item) => item.title === title);
  expect(found, `${title} found nearby`).toBeDefined();
  // Privacy: an approximate distance, never the seller's pin.
  expect(found.distanceKm).toBeGreaterThan(0);
  expect(JSON.stringify(found)).not.toContain(String(INDIRANAGAR.lat));
  expect(JSON.stringify(found)).not.toContain(String(INDIRANAGAR.lng));
  return found;
}

const ratings = { overall: 5, communication: 5, handover: 4 };

function review(ctx, account, data) {
  return request(ctx.app)
    .post(`${API}/reviews`)
    .set(account.bearer)
    .field('data', JSON.stringify(data));
}

describe('a purchase, from sign-up to review', () => {
  it('register, list, find nearby, chat, buy, pay, deliver, confirm and review', async () => {
    const ctx = createTestContext();
    const seller = await signUp(ctx, 'Riya Seller');
    const buyer = await signUp(ctx, 'Aman Buyer');

    // The seller lists an item; the buyer finds it nearby.
    const listing = await createListing(
      ctx,
      seller,
      saleDetails({ title: 'Ivory chikankari kurta', pricePaise: 180000 }),
    );
    await findNearby(ctx, buyer, 'Ivory chikankari kurta');

    // They talk about it.
    const chat = await startChat(ctx, buyer, { listingId: listing.id });
    expect(chat.status).toBe(200);
    const conversationId = chat.body.conversation.id;
    expect(
      (await sendMessage(ctx, buyer, conversationId, { body: 'Is it still available?' })).status,
    ).toBe(201);
    expect(
      (await sendMessage(ctx, seller, conversationId, { body: 'Yes, I can send it tomorrow.' }))
        .status,
    ).toBe(201);

    // Buy it for delivery and pay (simulated gateway, signed webhook).
    await addToCart(ctx, buyer, listing.id);
    const address = await saveAddress(ctx, buyer);
    const started = await startCheckout(ctx, buyer, [
      { sellerId: seller.user.id, fulfilment: 'DELIVERY', addressId: address.id },
    ]);
    expect(started.status).toBe(201);
    // The server set the price: item plus the seller's delivery charge.
    expect(started.body.checkout.totalPaise).toBe(180000 + 8000);
    await payCheckout(ctx, started.body.checkout);
    const order = await db.order.findFirstOrThrow({
      where: { checkoutId: started.body.checkout.id },
    });
    expect(order).toMatchObject({ status: 'AWAITING_DISPATCH', commissionPaise: 18000 });

    // The seller dispatches and reports delivery; that alone does not complete it.
    expect(
      (await sellerAction(ctx, seller, order.id, 'dispatch', { courierReference: 'DTDC123' }))
        .status,
    ).toBe(200);
    const reported = await sellerAction(ctx, seller, order.id, 'deliver');
    expect(reported.body.order.status).toBe('DELIVERY_REPORTED');

    // The buyer confirms receipt; after the 7-day issue window the order completes.
    const confirmed = await buyerAction(ctx, buyer, order.id, 'confirm');
    expect(confirmed.body.order.status).toBe('DELIVERED');
    ctx.clock.advance({ days: ISSUE_REPORT_WINDOW_DAYS, minutes: 1 });
    await runOrderJobs(ctx.app.locals.deps);
    const [freshSeller, freshBuyer] = await Promise.all([
      signInAgain(ctx, seller),
      signInAgain(ctx, buyer),
    ]);
    const done = await request(ctx.app).get(`${API}/me/sales/${order.id}`).set(freshSeller.bearer);
    expect(done.body.order).toMatchObject({ status: 'COMPLETED', payoutEligible: true });

    // Both review each other, once.
    expect(
      (
        await review(ctx, freshBuyer, {
          orderId: order.id,
          ...ratings,
          condition: 5,
          text: 'Lovely kurta.',
        })
      ).status,
    ).toBe(201);
    expect((await review(ctx, freshSeller, { orderId: order.id, ...ratings })).status).toBe(201);
    expect(
      (await review(ctx, freshBuyer, { orderId: order.id, ...ratings, condition: 5 })).status,
    ).toBe(409);
    const profile = await request(ctx.app).get(`${API}/users/${seller.user.id}/reviews`);
    expect(profile.body.items).toHaveLength(1);

    // The money adds up: paid = commission + seller payable.
    const ledger = await ledgerTotals({ checkoutId: started.body.checkout.id });
    expect(ledger.BUYER_PAYMENT).toBe(188000);
    expect(ledger.COMMISSION + ledger.SELLER_PAYABLE).toBe(188000);
    expect(ledger.COMMISSION).toBe(18000);
  });
});

describe('a rental, from sign-up to review', () => {
  it('list, find nearby, request, approve, pay, hand over, return, inspect, refund and review', async () => {
    const ctx = createTestContext();
    let owner = await signUp(ctx, 'Meera Owner');
    let renter = await signUp(ctx, 'Kabir Renter');

    const listing = await createListing(
      ctx,
      owner,
      rentDetails({ title: 'Teal silk lehenga for hire' }),
    );
    await findNearby(ctx, renter, 'Teal silk lehenga for hire');

    // A request holds the dates; it cannot be paid until the owner approves.
    const requested = await request(ctx.app)
      .post(`${API}/rentals`)
      .set(renter.bearer)
      .send({ listingId: listing.id, durationDays: 3, startDate: START, fulfilment: 'PICKUP' });
    expect(requested.status).toBe(201);
    const id = requested.body.booking.id;
    expect(requested.body.booking.status).toBe('REQUESTED');
    const early = await renterAction(ctx, renter, id, 'pay');
    expect(early.status).toBe(409);
    expect(await db.payment.count({ where: { bookingId: id } })).toBe(0);

    const approved = await ownerAction(ctx, owner, id, 'approve');
    expect(approved.body.booking.status).toBe('APPROVED');

    // Fee and deposit are paid together after approval, and recorded apart.
    await payBooking(ctx, renter, id);
    let ledger = await bookingLedger(id);
    expect(ledger).toMatchObject({
      BUYER_PAYMENT: 600000,
      DEPOSIT_COLLECTED: 1000000,
      COMMISSION: 60000,
      SELLER_PAYABLE: 540000,
    });

    // Handover with the renter's code and condition photos.
    const { handoverCode } = (
      await request(ctx.app).get(`${API}/me/rentals/${id}`).set(renter.bearer)
    ).body.booking;
    const handed = await withPhotos(ctx, owner, `/me/rented-out/${id}/handover`, {
      code: handoverCode,
    });
    expect(handed.body.booking.status).toBe('ACTIVE');

    // Return on time with the owner's code and photos.
    ctx.clock.set(addHours(RETURN_DUE, -2));
    [owner, renter] = await signInAgainAll(ctx, owner, renter);
    const { returnCode } = (
      await request(ctx.app).get(`${API}/me/rented-out/${id}`).set(owner.bearer)
    ).body.booking;
    const returned = await withPhotos(ctx, renter, `/me/rentals/${id}/return`, {
      code: returnCode,
    });
    expect(returned.body.booking.status).toBe('RETURNED');

    // The owner finds it fine: the whole deposit goes back, once, and it completes.
    const inspected = await ownerAction(ctx, owner, id, 'inspection-ok');
    expect(inspected.status).toBe(200);
    const booking = await db.rentalBooking.findUniqueOrThrow({ where: { id } });
    expect(booking.status).toBe('COMPLETED');
    ledger = await bookingLedger(id);
    expect(ledger.DEPOSIT_REFUND).toBe(1000000);
    expect(ledger.DEPOSIT_COLLECTED).toBe(ledger.DEPOSIT_REFUND + (ledger.DEPOSIT_DEDUCTION ?? 0));
    expect(ledger.COMMISSION).toBe(60000); // 10% of the fee only, never of the deposit
    expect(await db.refund.count({ where: { bookingId: id } })).toBe(1);

    // Both review each other.
    expect((await review(ctx, renter, { bookingId: id, ...ratings, condition: 5 })).status).toBe(
      201,
    );
    // The owner rates the condition it came back in (I87).
    expect((await review(ctx, owner, { bookingId: id, ...ratings, condition: 4 })).status).toBe(
      201,
    );
    const view = await request(ctx.app).get(`${API}/me/rented-out/${id}`).set(owner.bearer);
    expect(view.body.booking.payoutEligible).toBe(true);
  });
});
