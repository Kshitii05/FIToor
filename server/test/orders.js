import request from 'supertest';
import { db, registerVerifiedUser } from './helpers.js';
import { insertListing } from './listings.js';

const API = '/api/v1';

/** A spot in Indiranagar used for listings and delivery addresses in order tests. */
export const NEAR = { lat: 12.97194, lng: 77.64115, locality: 'Indiranagar' };

/** A sale listing that offers both delivery (within 10 km) and pickup. */
export function sellable(seller, overrides = {}) {
  return insertListing(seller, {
    pricePaise: 120000,
    quantity: 1,
    offersDelivery: true,
    deliveryChargePaise: 8000,
    deliveryRadiusKm: 10,
    offersPickup: true,
    location: NEAR,
    ...overrides,
  });
}

export async function addToCart(ctx, account, listingId, quantity = 1) {
  const res = await request(ctx.app)
    .post(`${API}/cart/items`)
    .set(account.bearer)
    .send({ listingId, quantity });
  if (res.status !== 201) {
    throw new Error(`Add to cart failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export const ADDRESS = {
  label: 'Home',
  recipientName: 'Asha Rao',
  phone: '9876543210',
  line1: '12, 3rd Cross, HAL 2nd Stage',
  locality: 'Indiranagar',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560038',
  lat: 12.9762,
  lng: 77.6411,
};

export async function saveAddress(ctx, account, overrides = {}) {
  const res = await request(ctx.app)
    .post(`${API}/me/addresses`)
    .set(account.bearer)
    .send({ ...ADDRESS, ...overrides });
  if (res.status !== 201) {
    throw new Error(`Saving address failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.address;
}

export function startCheckout(ctx, account, groups) {
  return request(ctx.app).post(`${API}/checkouts`).set(account.bearer).send({ groups });
}

/** The webhook request the gateway would send for an event about a payment. */
export function sendWebhook(ctx, { event, entity, eventId, signature }) {
  const body = JSON.stringify(ctx.gateway.webhookBody(event, entity));
  return request(ctx.app)
    .post(`${API}/payments/webhook`)
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Event-Id', eventId ?? `evt_${event}_${entity.id}`)
    .set('X-Razorpay-Signature', signature ?? ctx.gateway.webhookSignature(body))
    .send(body);
}

/**
 * Pays a checkout the way it happens in production: the gateway records the
 * payment and sends a signed `payment.captured` webhook. Returns the payment entity.
 */
export async function payCheckout(ctx, checkout) {
  const entity = ctx.gateway.pay(checkout.payment.gatewayOrderId);
  const res = await sendWebhook(ctx, { event: 'payment.captured', entity });
  if (res.status !== 200) {
    throw new Error(`Webhook failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return entity;
}

/**
 * A paid order from a fresh seller and buyer. `fulfilment` is DELIVERY or PICKUP.
 * Returns everything a test needs to act on it.
 */
export async function paidOrder(ctx, { fulfilment = 'DELIVERY', listing: overrides } = {}) {
  const seller = await registerVerifiedUser(ctx);
  const buyer = await registerVerifiedUser(ctx);
  const listing = await sellable(seller, overrides);
  await addToCart(ctx, buyer, listing.id);
  const group = { sellerId: seller.user.id, fulfilment };
  if (fulfilment === 'DELIVERY') group.addressId = (await saveAddress(ctx, buyer)).id;
  const started = await startCheckout(ctx, buyer, [group]);
  if (started.status !== 201) {
    throw new Error(`Checkout failed: ${started.status} ${JSON.stringify(started.body)}`);
  }
  await payCheckout(ctx, started.body.checkout);
  const order = await db.order.findFirstOrThrow({
    where: { checkoutId: started.body.checkout.id },
  });
  return { seller, buyer, listing, checkout: started.body.checkout, order };
}

export const buyerView = async (ctx, buyer, orderId) =>
  (await request(ctx.app).get(`${API}/me/orders/${orderId}`).set(buyer.bearer)).body.order;

export const sellerView = async (ctx, seller, orderId) =>
  (await request(ctx.app).get(`${API}/me/sales/${orderId}`).set(seller.bearer)).body.order;

export function buyerAction(ctx, buyer, orderId, action, body = {}) {
  return request(ctx.app)
    .post(`${API}/me/orders/${orderId}/${action}`)
    .set(buyer.bearer)
    .send(body);
}

export function sellerAction(ctx, seller, orderId, action, body = {}) {
  return request(ctx.app)
    .post(`${API}/me/sales/${orderId}/${action}`)
    .set(seller.bearer)
    .send(body);
}

export function adminAction(ctx, admin, orderId, action, body = {}) {
  return request(ctx.app)
    .post(`${API}/admin/orders/${orderId}/${action}`)
    .set(admin.bearer)
    .send(body);
}

/** A verified account with the admin role. */
export async function registerAdmin(ctx) {
  const admin = await registerVerifiedUser(ctx);
  await db.user.update({ where: { id: admin.user.id }, data: { role: 'ADMIN' } });
  return admin;
}

/** Ledger rows as `{ type: total }` for one order, or for a whole checkout. */
export async function ledgerTotals(where) {
  const rows = await db.ledgerEntry.findMany({ where });
  const totals = {};
  for (const row of rows) totals[row.type] = (totals[row.type] ?? 0) + row.amountPaise;
  return totals;
}

/** Signs in again: tests that move the clock past the 15-minute access token use this. */
export async function signInAgain(ctx, account) {
  const res = await request(ctx.app)
    .post(`${API}/auth/login`)
    .send({ email: account.details.email, password: account.details.password });
  return { ...account, bearer: { Authorization: `Bearer ${res.body.accessToken}` } };
}
