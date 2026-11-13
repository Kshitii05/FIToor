import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CART_ITEMS_MAX, CHECKOUT_RESERVATION_MINUTES } from '../../config/policy.js';
import {
  createTestContext,
  db,
  registerUser,
  registerVerifiedUser,
  resetDb,
} from '../../../test/helpers.js';
import { insertListing } from '../../../test/listings.js';
import {
  addToCart,
  ledgerTotals,
  payCheckout,
  saveAddress,
  sellable,
  sendWebhook,
  startCheckout,
} from '../../../test/orders.js';
import { runOrderJobs } from '../orders/order.jobs.js';

const API = '/api/v1';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const quantityOf = async (id) => (await db.listing.findUnique({ where: { id } })).quantity;

describe('the cart', () => {
  it('groups items by seller with their delivery and pickup options', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const buyer = await registerUser(ctx);
    const kurta = await sellable(seller, { deliveryChargePaise: 8000 });
    const scarf = await sellable(seller, { deliveryChargePaise: 5000 });
    const pickupOnly = await sellable(await registerVerifiedUser(ctx), {
      offersDelivery: false,
      deliveryChargePaise: null,
      deliveryRadiusKm: null,
    });
    await addToCart(ctx, buyer, kurta.id);
    await addToCart(ctx, buyer, scarf.id);
    const { cart } = await addToCart(ctx, buyer, pickupOnly.id);

    expect(cart.itemCount).toBe(3);
    const first = cart.groups.find((group) => group.seller.id === seller.user.id);
    const second = cart.groups.find((group) => group.seller.id !== seller.user.id);
    expect(first.options).toEqual({ delivery: { chargePaise: 8000 }, pickup: true });
    expect(first.itemsSubtotalPaise).toBe(240000);
    expect(second.options).toEqual({ delivery: null, pickup: true });
  });

  it('refuses rentals, own listings, hidden listings and more than is in stock', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const buyer = await registerUser(ctx);
    const rental = await insertListing(seller, { mode: 'RENT' });
    const paused = await sellable(seller, { status: 'PAUSED' });
    const two = await sellable(seller, { quantity: 2 });
    const add = (account, listingId, quantity = 1) =>
      request(ctx.app).post(`${API}/cart/items`).set(account.bearer).send({ listingId, quantity });

    expect((await add(buyer, rental.id)).body.error.code).toBe('NOT_FOR_SALE');
    expect((await add(seller, two.id)).status).toBe(403);
    expect((await add(buyer, paused.id)).status).toBe(404);
    expect((await add(buyer, two.id, 3)).body.error.code).toBe('OUT_OF_STOCK');
    expect((await add(buyer, two.id, 2)).status).toBe(201);
    expect((await request(ctx.app).get(`${API}/cart`)).status).toBe(401);
  });

  it(`holds at most ${CART_ITEMS_MAX} items`, async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const buyer = await registerUser(ctx);
    for (let i = 0; i < CART_ITEMS_MAX; i += 1)
      await addToCart(ctx, buyer, (await sellable(seller)).id);

    const extra = await request(ctx.app)
      .post(`${API}/cart/items`)
      .set(buyer.bearer)
      .send({ listingId: (await sellable(seller)).id });

    expect(extra.body.error.code).toBe('CART_FULL');
  });
});

describe('starting a checkout', () => {
  async function setup(ctx, listingOverrides) {
    const seller = await registerVerifiedUser(ctx);
    const buyer = await registerVerifiedUser(ctx);
    const listing = await sellable(seller, listingOverrides);
    await addToCart(ctx, buyer, listing.id);
    return { seller, buyer, listing };
  }

  it('takes prices from the database and reserves the stock', async () => {
    const ctx = createTestContext();
    const { seller, buyer, listing } = await setup(ctx);

    const res = await startCheckout(ctx, buyer, [
      { sellerId: seller.user.id, fulfilment: 'PICKUP' },
    ]);

    expect(res.status).toBe(201);
    expect(res.body.checkout).toMatchObject({ status: 'OPEN', totalPaise: 120000 });
    expect(res.body.checkout.payment).toMatchObject({
      gateway: 'simulated',
      amountPaise: 120000,
      currency: 'INR',
    });
    expect(await quantityOf(listing.id)).toBe(0);
  });

  it('needs a verified account, a choice for every seller, and an address for delivery', async () => {
    const ctx = createTestContext();
    const { seller, buyer, listing } = await setup(ctx);
    const unverified = await registerUser(ctx);
    await addToCart(ctx, unverified, listing.id);

    expect(
      (await startCheckout(ctx, unverified, [{ sellerId: seller.user.id, fulfilment: 'PICKUP' }]))
        .status,
    ).toBe(403);
    expect((await startCheckout(ctx, buyer, [])).status).toBe(400);
    expect(
      (await startCheckout(ctx, buyer, [{ sellerId: buyer.user.id, fulfilment: 'PICKUP' }])).status,
    ).toBe(400);
    expect(
      (await startCheckout(ctx, buyer, [{ sellerId: seller.user.id, fulfilment: 'DELIVERY' }]))
        .status,
    ).toBe(400);
    const someoneElses = await saveAddress(ctx, unverified);
    const wrongAddress = await startCheckout(ctx, buyer, [
      { sellerId: seller.user.id, fulfilment: 'DELIVERY', addressId: someoneElses.id },
    ]);
    expect(wrongAddress.status).toBe(404);
    expect(await quantityOf(listing.id)).toBe(1);
  });

  it('refuses delivery outside the seller’s radius, and a way the seller does not offer', async () => {
    const ctx = createTestContext();
    const { seller, buyer } = await setup(ctx, { deliveryRadiusKm: 2 });
    const far = await saveAddress(ctx, buyer, {
      lat: 13.05,
      lng: 77.6,
      locality: 'Hebbal',
      pincode: '560024',
    });

    const tooFar = await startCheckout(ctx, buyer, [
      { sellerId: seller.user.id, fulfilment: 'DELIVERY', addressId: far.id },
    ]);
    expect(tooFar.status).toBe(409);
    expect(tooFar.body.error.code).toBe('OUTSIDE_DELIVERY_RADIUS');

    const ctx2 = createTestContext();
    const other = await setup(ctx2, { offersPickup: false });
    const noPickup = await startCheckout(ctx2, other.buyer, [
      { sellerId: other.seller.user.id, fulfilment: 'PICKUP' },
    ]);
    expect(noPickup.body.error.code).toBe('PICKUP_NOT_OFFERED');
  });

  it('gives the stock back when a checkout expires unpaid, or is replaced', async () => {
    const ctx = createTestContext();
    const { seller, buyer, listing } = await setup(ctx);
    const choice = [{ sellerId: seller.user.id, fulfilment: 'PICKUP' }];

    const first = await startCheckout(ctx, buyer, choice);
    expect(await quantityOf(listing.id)).toBe(0);
    const second = await startCheckout(ctx, buyer, choice);
    expect(second.status).toBe(201);
    expect(await quantityOf(listing.id)).toBe(0);
    expect((await db.checkout.findUnique({ where: { id: first.body.checkout.id } })).status).toBe(
      'EXPIRED',
    );

    ctx.clock.advance({ minutes: CHECKOUT_RESERVATION_MINUTES - 1 });
    await runOrderJobs(ctx.app.locals.deps);
    expect(await quantityOf(listing.id)).toBe(0);
    ctx.clock.advance({ minutes: 1 });
    expect((await runOrderJobs(ctx.app.locals.deps)).expiredCheckouts).toBe(1);
    expect(await quantityOf(listing.id)).toBe(1);
  });
});

describe('payments that arrive oddly', () => {
  async function openCheckout(ctx) {
    const seller = await registerVerifiedUser(ctx);
    const buyer = await registerVerifiedUser(ctx);
    const listing = await sellable(seller);
    await addToCart(ctx, buyer, listing.id);
    const { body } = await startCheckout(ctx, buyer, [
      { sellerId: seller.user.id, fulfilment: 'PICKUP' },
    ]);
    return { seller, buyer, listing, checkout: body.checkout };
  }

  it('a late payment still becomes an order when the item is still free', async () => {
    const ctx = createTestContext();
    const { listing, checkout } = await openCheckout(ctx);
    ctx.clock.advance({ minutes: CHECKOUT_RESERVATION_MINUTES });
    await runOrderJobs(ctx.app.locals.deps);
    expect(await quantityOf(listing.id)).toBe(1);

    await payCheckout(ctx, checkout);

    expect(await db.order.count()).toBe(1);
    expect(await quantityOf(listing.id)).toBe(0);
    expect((await db.checkout.findUnique({ where: { id: checkout.id } })).status).toBe('PAID');
  });

  it('a late payment for an item someone else bought is refunded in full', async () => {
    const ctx = createTestContext();
    const { seller, listing, checkout } = await openCheckout(ctx);
    ctx.clock.advance({ minutes: CHECKOUT_RESERVATION_MINUTES });
    await runOrderJobs(ctx.app.locals.deps);
    const rival = await registerVerifiedUser(ctx);
    await addToCart(ctx, rival, listing.id);
    const rivalCheckout = await startCheckout(ctx, rival, [
      { sellerId: seller.user.id, fulfilment: 'PICKUP' },
    ]);
    expect(rivalCheckout.status).toBe(201);

    await payCheckout(ctx, checkout);

    expect(await db.order.count()).toBe(0);
    const refund = await db.refund.findFirstOrThrow({ where: { checkoutId: checkout.id } });
    expect(refund).toMatchObject({
      reason: 'LATE_PAYMENT',
      status: 'PROCESSED',
      amountPaise: 120000,
    });
    expect(await ledgerTotals({ checkoutId: checkout.id })).toMatchObject({
      BUYER_PAYMENT: 120000,
      BUYER_REFUND: 120000,
    });
    expect(await quantityOf(listing.id)).toBe(0);
  });

  it('a second payment for an already paid checkout is refunded', async () => {
    const ctx = createTestContext();
    const { checkout } = await openCheckout(ctx);
    await payCheckout(ctx, checkout);
    await payCheckout(ctx, checkout);

    expect(await db.order.count()).toBe(1);
    expect(await db.payment.count()).toBe(2);
    const refund = await db.refund.findFirstOrThrow();
    expect(refund).toMatchObject({ reason: 'DUPLICATE_PAYMENT', amountPaise: 120000 });
  });

  it('a failed payment is recorded and the checkout stays open for another try', async () => {
    const ctx = createTestContext();
    const { checkout } = await openCheckout(ctx);
    const failed = ctx.gateway.pay(checkout.payment.gatewayOrderId, { status: 'failed' });

    await sendWebhook(ctx, { event: 'payment.failed', entity: failed });

    expect((await db.payment.findFirstOrThrow()).status).toBe('FAILED');
    expect((await db.checkout.findUnique({ where: { id: checkout.id } })).status).toBe('OPEN');
    expect(await db.ledgerEntry.count()).toBe(0);
    await payCheckout(ctx, checkout);
    expect(await db.order.count()).toBe(1);
  });

  it('the browser report works when its signature is right, and only then', async () => {
    const ctx = createTestContext();
    const { buyer, checkout } = await openCheckout(ctx);
    const entity = ctx.gateway.pay(checkout.payment.gatewayOrderId);
    const verify = (signature, account = buyer) =>
      request(ctx.app)
        .post(`${API}/checkouts/${checkout.id}/verify`)
        .set(account.bearer)
        .send({ gatewayOrderId: entity.order_id, gatewayPaymentId: entity.id, signature });

    expect((await verify('0'.repeat(64))).status).toBe(400);
    expect(
      (
        await verify(
          ctx.gateway.paymentSignature(entity.order_id, entity.id),
          await registerVerifiedUser(ctx),
        )
      ).status,
    ).toBe(404);
    expect(await db.order.count()).toBe(0);

    const ok = await verify(ctx.gateway.paymentSignature(entity.order_id, entity.id));
    expect(ok.status).toBe(200);
    expect(ok.body.checkout.status).toBe('PAID');
    expect(ok.body.checkout.orderIds).toHaveLength(1);
  });

  it('the simulated payment button works without gateway keys', async () => {
    const ctx = createTestContext();
    const { buyer, checkout } = await openCheckout(ctx);

    const res = await request(ctx.app)
      .post(`${API}/checkouts/${checkout.id}/simulate-payment`)
      .set(buyer.bearer)
      .send({ outcome: 'success' });

    expect(res.status).toBe(200);
    expect(res.body.checkout.status).toBe('PAID');
  });
});

describe('the ledger', () => {
  it('cannot be changed or deleted, even directly in the database', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const buyer = await registerVerifiedUser(ctx);
    await addToCart(ctx, buyer, (await sellable(seller)).id);
    const { body } = await startCheckout(ctx, buyer, [
      { sellerId: seller.user.id, fulfilment: 'PICKUP' },
    ]);
    await payCheckout(ctx, body.checkout);
    const row = await db.ledgerEntry.findFirstOrThrow();

    await expect(
      db.ledgerEntry.update({ where: { id: row.id }, data: { amountPaise: 1 } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.ledgerEntry.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(db.orderEvent.deleteMany()).rejects.toThrow(/append-only/);
  });
});
