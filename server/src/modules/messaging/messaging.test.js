// Messaging and offers (Step 7), written before the code.
import { MemoryStore } from 'express-rate-limit';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OFFER_OPEN_HOURS, OFFER_USE_HOURS } from '../../config/policy.js';
import {
  createTestContext,
  db,
  registerUser,
  registerVerifiedUser,
  resetDb,
} from '../../../test/helpers.js';
import { insertListing } from '../../../test/listings.js';
import {
  ask,
  block,
  listen,
  makeOffer,
  nextEvent,
  offerAction,
  readMessages,
  sendMessage,
  sendPhotos,
  startChat,
} from '../../../test/messaging.js';
import {
  addToCart,
  paidOrder,
  payCheckout,
  sellable,
  signInAgain,
  startCheckout,
} from '../../../test/orders.js';
import { runOfferJobs } from './offers.service.js';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const API = '/api/v1';

/** A seller with a ₹1,200 sale listing and a buyer, chatting about it. */
async function chatAboutListing(ctx, listingOverrides) {
  const seller = await registerVerifiedUser(ctx);
  const buyer = await registerVerifiedUser(ctx);
  const listing = await sellable(seller, listingOverrides);
  const res = await startChat(ctx, buyer, { listingId: listing.id });
  return { seller, buyer, listing, conversation: res.body.conversation, res };
}

describe('conversations', () => {
  it('one conversation per pair, even when both start one at the same moment', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const buyer = await registerVerifiedUser(ctx);
    const one = await sellable(seller);
    const two = await sellable(seller);

    const results = await Promise.all([
      startChat(ctx, buyer, { listingId: one.id }),
      startChat(ctx, buyer, { listingId: two.id }),
      startChat(ctx, buyer, { listingId: one.id }),
    ]);
    expect(results.every((res) => [200, 201].includes(res.status))).toBe(true);
    expect(new Set(results.map((res) => res.body.conversation.id)).size).toBe(1);
    expect(await db.conversation.count()).toBe(1);
    expect(results[0].body.conversation.other.id).toBe(seller.user.id);
  });

  it('starts from a listing, order or rental the person is part of, never with themselves', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await paidOrder(ctx);
    const stranger = await registerVerifiedUser(ctx);
    const own = await sellable(seller);

    expect((await startChat(ctx, buyer, { orderId: order.id })).status).toBe(200);
    expect((await startChat(ctx, stranger, { orderId: order.id })).status).toBe(404);
    expect((await startChat(ctx, seller, { listingId: own.id })).body.error.code).toBe(
      'CANNOT_MESSAGE_SELF',
    );
    expect((await startChat(ctx, buyer, {})).status).toBe(400);
    expect((await startChat(ctx, buyer, { listingId: own.id, orderId: order.id })).status).toBe(
      400,
    );
  });

  it('lists my conversations with the last message and unread count', async () => {
    const ctx = createTestContext();
    const { seller, buyer, conversation } = await chatAboutListing(ctx);
    await sendMessage(ctx, buyer, conversation.id, { body: 'Is this still available?' });
    await sendMessage(ctx, buyer, conversation.id, { body: 'I can pick it up today.' });

    const list = await request(ctx.app).get(`${API}/conversations`).set(seller.bearer);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ unreadCount: 2 });
    expect(list.body.items[0].lastMessage.body).toBe('I can pick it up today.');
    expect(list.body.items[0].other).not.toHaveProperty('phone');
    expect(list.body.items[0].other).not.toHaveProperty('email');
  });
});

describe('who can read and write', () => {
  it('someone outside a conversation cannot read it or send to it', async () => {
    const ctx = createTestContext();
    const { buyer, conversation } = await chatAboutListing(ctx);
    await sendMessage(ctx, buyer, conversation.id, { body: 'Hello' });
    const stranger = await registerVerifiedUser(ctx);

    expect((await readMessages(ctx, stranger, conversation.id)).status).toBe(404);
    expect(
      (await request(ctx.app).get(`${API}/conversations/${conversation.id}`).set(stranger.bearer))
        .status,
    ).toBe(404);
    expect((await sendMessage(ctx, stranger, conversation.id, { body: 'Hi' })).status).toBe(404);
    expect((await readMessages(ctx, { bearer: {} }, conversation.id)).status).toBe(401);
  });

  it('sending needs a verified account', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const unverified = await registerUser(ctx);
    const listing = await sellable(seller);
    expect((await startChat(ctx, unverified, { listingId: listing.id })).status).toBe(403);
  });
});

describe('messages', () => {
  it('sends text, a listing link and photos, and pages back through history', async () => {
    const ctx = createTestContext();
    const { seller, buyer, listing, conversation } = await chatAboutListing(ctx);

    const text = await sendMessage(ctx, buyer, conversation.id, {
      body: 'Would you take less for this one?',
      listingId: listing.id,
    });
    expect(text.status).toBe(201);
    expect(text.body.message).toMatchObject({ kind: 'TEXT', senderId: buyer.user.id });
    expect(text.body.message.listing).toMatchObject({ id: listing.id, title: listing.title });

    const photo = await sendPhotos(ctx, seller, conversation.id, { body: 'Close-up' }, 2);
    expect(photo.status).toBe(201);
    expect(photo.body.message.kind).toBe('PHOTO');
    expect(photo.body.message.attachments).toHaveLength(2);
    expect((await sendPhotos(ctx, seller, conversation.id, {}, 5)).status).toBe(400);
    expect((await sendMessage(ctx, buyer, conversation.id, { body: '   ' })).status).toBe(400);
    expect(
      (await sendMessage(ctx, buyer, conversation.id, { body: 'x'.repeat(2001) })).status,
    ).toBe(400);

    for (let i = 0; i < 5; i += 1)
      await sendMessage(ctx, buyer, conversation.id, { body: `n${i}` });
    const page = await readMessages(ctx, seller, conversation.id, '?limit=3');
    expect(page.body.items.map((m) => m.body)).toEqual(['n2', 'n3', 'n4']);
    expect(page.body.hasMore).toBe(true);
    const older = await readMessages(
      ctx,
      seller,
      conversation.id,
      `?limit=3&before=${page.body.items[0].seq}`,
    );
    expect(older.body.items.map((m) => m.body)).toEqual(['Close-up', 'n0', 'n1']);
  });

  it('hides phone numbers and email addresses until the two have a paid order', async () => {
    const ctx = createTestContext();
    const { seller, buyer, order } = await paidOrder(ctx);
    const stranger = await registerVerifiedUser(ctx);
    const listing = await sellable(seller);

    const early = await startChat(ctx, stranger, { listingId: listing.id });
    const hidden = await sendMessage(ctx, stranger, early.body.conversation.id, {
      body: 'Call me on +91 98765 43210 or write to asha.rao@example.com',
    });
    expect(hidden.body.message.body).toBe('Call me on [hidden] or write to [hidden]');

    const after = await startChat(ctx, buyer, { orderId: order.id });
    const shown = await sendMessage(ctx, buyer, after.body.conversation.id, {
      body: 'My number is 9876543210',
    });
    expect(shown.body.message.body).toBe('My number is 9876543210');
    // Prices and short numbers are left alone.
    const price = await sendMessage(ctx, stranger, early.body.conversation.id, {
      body: 'Would ₹1,500 work? I am in sector 21.',
    });
    expect(price.body.message.body).toBe('Would ₹1,500 work? I am in sector 21.');
  });

  it('marks delivery and reading; unread counts drop', async () => {
    const ctx = createTestContext();
    const { seller, buyer, conversation } = await chatAboutListing(ctx);
    const sent = await sendMessage(ctx, buyer, conversation.id, { body: 'Hello' });
    const { seq } = sent.body.message;

    // Opening the messages delivers them to the reader.
    await readMessages(ctx, seller, conversation.id);
    let view = (
      await request(ctx.app).get(`${API}/conversations/${conversation.id}`).set(buyer.bearer)
    ).body.conversation;
    expect(view.otherDeliveredUpTo).toBe(seq);
    expect(view.otherReadUpTo).toBe(0);

    const read = await request(ctx.app)
      .post(`${API}/conversations/${conversation.id}/read`)
      .set(seller.bearer)
      .send({ upTo: seq });
    expect(read.status).toBe(200);
    view = (await request(ctx.app).get(`${API}/conversations/${conversation.id}`).set(buyer.bearer))
      .body.conversation;
    expect(view.otherReadUpTo).toBe(seq);
    const mine = (await request(ctx.app).get(`${API}/conversations`).set(seller.bearer)).body
      .items[0];
    expect(mine.unreadCount).toBe(0);
  });
});

describe('blocking', () => {
  it('stops messages and offers both ways and withdraws open offers; history stays readable', async () => {
    const ctx = createTestContext();
    const { seller, buyer, listing, conversation } = await chatAboutListing(ctx);
    await sendMessage(ctx, buyer, conversation.id, { body: 'Hi' });
    const offer = (await makeOffer(ctx, buyer, { listingId: listing.id, unitPricePaise: 100000 }))
      .body.offer;

    expect((await block(ctx, seller, buyer.user.id)).status).toBe(201);
    expect(
      (await sendMessage(ctx, buyer, conversation.id, { body: 'Hello?' })).body.error.code,
    ).toBe('BLOCKED');
    expect((await sendMessage(ctx, seller, conversation.id, { body: 'Bye' })).body.error.code).toBe(
      'BLOCKED',
    );
    expect(
      (await makeOffer(ctx, buyer, { listingId: listing.id, unitPricePaise: 90000 })).body.error
        .code,
    ).toBe('BLOCKED');
    expect((await db.priceOffer.findUnique({ where: { id: offer.id } })).status).toBe('WITHDRAWN');
    expect((await readMessages(ctx, buyer, conversation.id)).status).toBe(200);
    expect(
      (await startChat(ctx, buyer, { listingId: listing.id })).body.conversation.blocked,
    ).toEqual({
      byMe: false,
      byThem: true,
    });

    const list = await request(ctx.app).get(`${API}/blocks`).set(seller.bearer);
    expect(list.body.items.map((b) => b.user.id)).toEqual([buyer.user.id]);
    expect(
      (await request(ctx.app).delete(`${API}/blocks/${buyer.user.id}`).set(seller.bearer)).status,
    ).toBe(204);
    expect((await sendMessage(ctx, buyer, conversation.id, { body: 'Thanks' })).status).toBe(201);
    expect((await block(ctx, seller, seller.user.id)).status).toBe(400);
  });
});

describe('offers', () => {
  it('only the side an offer waits on can answer it; prices must be below the listed price', async () => {
    const ctx = createTestContext();
    const { seller, buyer, listing } = await chatAboutListing(ctx);
    const stranger = await registerVerifiedUser(ctx);

    expect(
      (await makeOffer(ctx, buyer, { listingId: listing.id, unitPricePaise: 120000 })).status,
    ).toBe(400);
    expect(
      (await makeOffer(ctx, seller, { listingId: listing.id, unitPricePaise: 90000 })).body.error
        .code,
    ).toBe('CANNOT_MESSAGE_SELF');
    const made = await makeOffer(ctx, buyer, { listingId: listing.id, unitPricePaise: 90000 });
    expect(made.status).toBe(201);
    expect(made.body.offer).toMatchObject({
      status: 'OPEN',
      unitPricePaise: 90000,
      madeById: buyer.user.id,
    });
    const again = await makeOffer(ctx, buyer, { listingId: listing.id, unitPricePaise: 95000 });
    expect(again.body.error.code).toBe('OFFER_EXISTS');

    const id = made.body.offer.id;
    expect((await offerAction(ctx, buyer, id, 'accept')).status).toBe(403);
    expect((await offerAction(ctx, stranger, id, 'accept')).status).toBe(404);
    expect((await offerAction(ctx, seller, id, 'withdraw')).status).toBe(403);

    const messages = (await readMessages(ctx, seller, made.body.conversationId)).body.items;
    expect(messages.at(-1)).toMatchObject({ kind: 'OFFER' });
    expect(messages.at(-1).offer.id).toBe(id);
  });

  it('a counter replaces the offer it answers, and the history is kept', async () => {
    const ctx = createTestContext();
    const { seller, buyer, listing } = await chatAboutListing(ctx);
    const first = (await makeOffer(ctx, buyer, { listingId: listing.id, unitPricePaise: 80000 }))
      .body.offer;
    const counter = await offerAction(ctx, seller, first.id, 'counter', { unitPricePaise: 100000 });
    expect(counter.status).toBe(201);
    expect(counter.body.offer).toMatchObject({
      status: 'OPEN',
      madeById: seller.user.id,
      previousOfferId: first.id,
    });
    expect((await db.priceOffer.findUnique({ where: { id: first.id } })).status).toBe('COUNTERED');
    expect((await offerAction(ctx, seller, first.id, 'accept')).status).toBe(409);

    const accepted = await offerAction(ctx, buyer, counter.body.offer.id, 'accept');
    expect(accepted.status).toBe(200);
    expect(accepted.body.offer.status).toBe('ACCEPTED');
    expect(await db.priceOffer.count({ where: { listingId: listing.id } })).toBe(2);
    const mine = await request(ctx.app)
      .get(`${API}/offers?listingId=${listing.id}`)
      .set(buyer.bearer);
    expect(mine.body.live.unitPricePaise).toBe(100000);
    expect(mine.body.items).toHaveLength(2);
  });

  it('rental listings take no offers', async () => {
    const ctx = createTestContext();
    const owner = await registerVerifiedUser(ctx);
    const renter = await registerVerifiedUser(ctx);
    const rental = await insertListing(owner, { mode: 'RENT' });
    const res = await makeOffer(ctx, renter, { listingId: rental.id, unitPricePaise: 1000 });
    expect(res.body.error.code).toBe('OFFERS_SALE_ONLY');
  });

  it('open offers expire after 48 hours, accepted ones 48 hours after acceptance', async () => {
    const ctx = createTestContext();
    let { seller, buyer, listing } = await chatAboutListing(ctx);
    const open = (await makeOffer(ctx, buyer, { listingId: listing.id, unitPricePaise: 90000 }))
      .body.offer;
    ctx.clock.advance({ hours: OFFER_OPEN_HOURS });
    await runOfferJobs(ctx.app.locals.deps);
    expect((await db.priceOffer.findUnique({ where: { id: open.id } })).status).toBe('EXPIRED');

    [seller, buyer] = [await signInAgain(ctx, seller), await signInAgain(ctx, buyer)];
    const next = (await makeOffer(ctx, buyer, { listingId: listing.id, unitPricePaise: 95000 }))
      .body.offer;
    await offerAction(ctx, seller, next.id, 'accept');
    ctx.clock.advance({ hours: OFFER_USE_HOURS });
    await runOfferJobs(ctx.app.locals.deps);
    expect((await db.priceOffer.findUnique({ where: { id: next.id } })).status).toBe('EXPIRED');
  });
});

describe('an accepted offer at checkout', () => {
  it('sets the price on the server, commission follows it, and it works once', async () => {
    const ctx = createTestContext();
    const { seller, buyer, listing } = await chatAboutListing(ctx, { quantity: 3 });
    const offer = (
      await makeOffer(ctx, buyer, { listingId: listing.id, quantity: 2, unitPricePaise: 100000 })
    ).body.offer;
    await offerAction(ctx, seller, offer.id, 'accept');

    await addToCart(ctx, buyer, listing.id, 2);
    const cart = await request(ctx.app).get(`${API}/cart`).set(buyer.bearer);
    expect(cart.body.cart.groups[0].items[0]).toMatchObject({
      unitPricePaise: 100000,
      offerId: offer.id,
    });

    // A price sent by the browser is refused, not used.
    const sneaky = await request(ctx.app)
      .post(`${API}/checkouts`)
      .set(buyer.bearer)
      .send({ groups: [{ sellerId: seller.user.id, fulfilment: 'PICKUP', unitPricePaise: 1 }] });
    expect(sneaky.status).toBe(400);

    const started = await startCheckout(ctx, buyer, [
      { sellerId: seller.user.id, fulfilment: 'PICKUP' },
    ]);
    expect(started.body.checkout.totalPaise).toBe(200000);
    await payCheckout(ctx, started.body.checkout);
    const order = await db.order.findFirstOrThrow({
      where: { checkoutId: started.body.checkout.id },
    });
    expect(order.itemsSubtotalPaise).toBe(200000);
    expect(order.commissionPaise).toBe(20000);
    expect((await db.priceOffer.findUnique({ where: { id: offer.id } })).status).toBe('USED');

    await addToCart(ctx, buyer, listing.id, 1);
    const second = await startCheckout(ctx, buyer, [
      { sellerId: seller.user.id, fulfilment: 'PICKUP' },
    ]);
    expect(second.body.checkout.totalPaise).toBe(120000);
  });

  it('a cart quantity above the agreed quantity pays the listed price', async () => {
    const ctx = createTestContext();
    const { seller, buyer, listing } = await chatAboutListing(ctx, { quantity: 3 });
    const offer = (
      await makeOffer(ctx, buyer, { listingId: listing.id, quantity: 1, unitPricePaise: 100000 })
    ).body.offer;
    await offerAction(ctx, seller, offer.id, 'accept');
    await addToCart(ctx, buyer, listing.id, 2);
    const started = await startCheckout(ctx, buyer, [
      { sellerId: seller.user.id, fulfilment: 'PICKUP' },
    ]);
    expect(started.body.checkout.totalPaise).toBe(240000);
  });
});

describe('live chat', () => {
  it('refuses connections without a valid token, and joins only to own conversations', async () => {
    const ctx = createTestContext();
    const live = await listen(ctx);
    try {
      const { buyer, seller, conversation } = await chatAboutListing(ctx);
      const stranger = await registerVerifiedUser(ctx);

      await expect(live.connect()).rejects.toThrow();
      await expect(live.connect('not-a-token')).rejects.toThrow();

      const intruder = await live.connect(stranger.accessToken);
      expect(
        await ask(intruder, 'conversation:join', { conversationId: conversation.id }),
      ).toMatchObject({ ok: false });

      const sellerSocket = await live.connect(seller.accessToken);
      expect(
        await ask(sellerSocket, 'conversation:join', { conversationId: conversation.id }),
      ).toEqual({ ok: true });

      const arriving = nextEvent(sellerSocket, 'message:new');
      let leaked = false;
      intruder.on('message:new', () => {
        leaked = true;
      });
      await sendMessage(ctx, buyer, conversation.id, { body: 'Live hello' });
      const event = await arriving;
      expect(event.message.body).toBe('Live hello');
      expect(event.conversationId).toBe(conversation.id);

      // The seller's app says it arrived: the buyer hears it was delivered.
      const buyerSocket = await live.connect(buyer.accessToken);
      const receipt = nextEvent(buyerSocket, 'receipt');
      expect(
        await ask(sellerSocket, 'message:delivered', {
          conversationId: conversation.id,
          upTo: event.message.seq,
        }),
      ).toEqual({ ok: true });
      expect(await receipt).toMatchObject({
        userId: seller.user.id,
        deliveredUpTo: event.message.seq,
      });
      expect(leaked).toBe(false);
    } finally {
      await live.close();
    }
  });

  it('pushes offer changes to both people', async () => {
    const ctx = createTestContext();
    const live = await listen(ctx);
    try {
      const { buyer, seller, listing } = await chatAboutListing(ctx);
      const buyerSocket = await live.connect(buyer.accessToken);
      const offer = (await makeOffer(ctx, buyer, { listingId: listing.id, unitPricePaise: 90000 }))
        .body.offer;
      const update = nextEvent(buyerSocket, 'offer:updated');
      await offerAction(ctx, seller, offer.id, 'accept');
      expect((await update).offer.status).toBe('ACCEPTED');
    } finally {
      await live.close();
    }
  });
});

describe('rate limits', () => {
  it('stops a person after 30 messages a minute', async () => {
    const ctx = createTestContext({
      rateLimiting: { enabled: true, makeStore: () => new MemoryStore() },
    });
    const { buyer, conversation } = await chatAboutListing(ctx);
    const results = [];
    for (let i = 0; i < 31; i += 1) {
      results.push((await sendMessage(ctx, buyer, conversation.id, { body: `m${i}` })).status);
    }
    expect(results.slice(0, 30).every((status) => status === 201)).toBe(true);
    expect(results[30]).toBe(429);
  });
});
