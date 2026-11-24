// Notifications (Step 9), written before the code.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MESSAGE_NOTIFY_INTERVAL_MINUTES,
  NOTIFICATION_RETENTION_DAYS,
  REVIEW_REMINDER_DELAY_HOURS,
} from '../../config/policy.js';
import { addHours } from '../../lib/clock.js';
import { createEmailQueue } from '../../lib/emailQueue.js';
import { createRedisConnection } from '../../lib/redis.js';
import { createTestContext, db, registerVerifiedUser, resetDb } from '../../../test/helpers.js';
import { completedOrder } from '../../../test/disputes.js';
import { listen, makeOffer, nextEvent, sendMessage, startChat } from '../../../test/messaging.js';
import { paidOrder, sellable, signInAgain } from '../../../test/orders.js';
import { bookingUpTo, RETURN_DUE, runJobs } from '../../../test/rentals.js';
import { deliver, runNotificationJobs } from './notifications.service.js';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const API = '/api/v1';
const sample = (userId, key = `test:${crypto.randomUUID()}`) => ({
  userId,
  key,
  category: 'ORDERS',
  type: 'test',
  title: 'Your order is on its way',
  body: 'The seller has sent order ORD-TEST.',
  link: '/orders/x',
});

describe('never twice', () => {
  it('the same event key gives one notification and one email, however often it is sent', async () => {
    const ctx = createTestContext();
    const person = await registerVerifiedUser(ctx);
    const before = ctx.emails.length;
    const event = sample(person.user.id, 'order:abc:dispatched:buyer');
    await Promise.all([deliver(ctx.app.locals.deps, event), deliver(ctx.app.locals.deps, event)]);
    await deliver(ctx.app.locals.deps, event);
    expect(await db.notification.count({ where: { key: event.key } })).toBe(1);
    expect(ctx.emails.length - before).toBe(1);
  });

  it('a deadline job run twice notifies once', async () => {
    const ctx = createTestContext();
    const { renter } = await bookingUpTo(ctx, 'active');
    ctx.clock.set(addHours(RETURN_DUE, -20));
    await runJobs(ctx);
    await runJobs(ctx);
    const rows = await db.notification.findMany({
      where: { userId: renter.user.id, type: 'returnTomorrow' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: 'RENTALS', critical: true });
    expect(
      ctx.emails.filter((m) => m.to === renter.details.email && /tomorrow/.test(m.subject)),
    ).toHaveLength(1);
  });

  it('the email queue keeps one job for one job id (real BullMQ on Redis)', async () => {
    const connection = createRedisConnection({ maxRetriesPerRequest: null });
    const queue = createEmailQueue({
      emailSender: { send: async () => {} },
      logger: { error() {}, info() {}, warn() {} },
      connection,
      name: `email-test-${crypto.randomUUID()}`,
      startWorker: false,
    });
    try {
      const job = { jobId: 'notification-same', to: 'a@example.com', subject: 'Hi', text: 'Hello' };
      await queue.add(job);
      await queue.add(job);
      await queue.add({ ...job, jobId: 'notification-other' });
      const counts = await queue.counts();
      expect(counts.waiting + counts.delayed + counts.active).toBe(2);
    } finally {
      await queue.obliterate();
      await queue.close();
      await connection.quit();
    }
  });
});

describe('what people get', () => {
  it('order events land in the notification list with a link', async () => {
    const ctx = createTestContext();
    const { buyer, order } = await paidOrder(ctx);
    const list = await request(ctx.app).get(`${API}/notifications`).set(buyer.bearer);
    expect(list.status).toBe(200);
    const placed = list.body.items.find((n) => n.type === 'orderPlacedBuyer');
    expect(placed).toMatchObject({ category: 'ORDERS', link: `/orders/${order.id}`, read: false });
    expect(placed.title).not.toMatch(/FIToor/);
  });

  it('arrive live, to that person only', async () => {
    const ctx = createTestContext();
    const live = await listen(ctx);
    try {
      const person = await registerVerifiedUser(ctx);
      const other = await registerVerifiedUser(ctx);
      const mine = await live.connect(person.accessToken);
      const theirs = await live.connect(other.accessToken);
      let leaked = false;
      theirs.on('notification:new', () => {
        leaked = true;
      });
      const arriving = nextEvent(mine, 'notification:new');
      await deliver(ctx.app.locals.deps, sample(person.user.id));
      const event = await arriving;
      expect(event.notification.title).toBe('Your order is on its way');
      expect(event.unreadCount).toBe(1);
      expect(leaked).toBe(false);
    } finally {
      await live.close();
    }
  });

  it('read one, read all, unread count; nobody else can mark them', async () => {
    const ctx = createTestContext();
    const person = await registerVerifiedUser(ctx);
    const other = await registerVerifiedUser(ctx);
    for (let i = 0; i < 3; i += 1) await deliver(ctx.app.locals.deps, sample(person.user.id));
    const count = () =>
      request(ctx.app).get(`${API}/notifications/unread-count`).set(person.bearer);
    expect((await count()).body.count).toBe(3);

    const [first] = (await request(ctx.app).get(`${API}/notifications`).set(person.bearer)).body
      .items;
    expect(
      (await request(ctx.app).post(`${API}/notifications/${first.id}/read`).set(other.bearer))
        .status,
    ).toBe(404);
    expect(
      (await request(ctx.app).post(`${API}/notifications/${first.id}/read`).set(person.bearer))
        .status,
    ).toBe(200);
    expect((await count()).body.count).toBe(2);
    const unread = await request(ctx.app)
      .get(`${API}/notifications?unread=true`)
      .set(person.bearer);
    expect(unread.body.items).toHaveLength(2);

    await request(ctx.app).post(`${API}/notifications/read-all`).set(person.bearer);
    expect((await count()).body.count).toBe(0);
    expect((await request(ctx.app).get(`${API}/notifications`)).status).toBe(401);
  });
});

describe('preferences', () => {
  it('optional categories can be turned off; critical ones cannot', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const buyer = await registerVerifiedUser(ctx);
    const listing = await sellable(seller);

    const initial = await request(ctx.app)
      .get(`${API}/me/notification-preferences`)
      .set(seller.bearer);
    expect(initial.body.items).toHaveLength(7);
    expect(initial.body.items.find((c) => c.category === 'ORDERS')).toMatchObject({
      critical: true,
      inApp: true,
      email: true,
    });

    const refused = await request(ctx.app)
      .put(`${API}/me/notification-preferences`)
      .set(seller.bearer)
      .send({ items: [{ category: 'PAYMENTS', inApp: false, email: false }] });
    expect(refused.status).toBe(400);

    const saved = await request(ctx.app)
      .put(`${API}/me/notification-preferences`)
      .set(seller.bearer)
      .send({ items: [{ category: 'OFFERS', inApp: false, email: false }] });
    expect(saved.status).toBe(200);
    expect(saved.body.items.find((c) => c.category === 'OFFERS')).toMatchObject({
      inApp: false,
      email: false,
    });

    const before = ctx.emails.filter((m) => m.to === seller.details.email).length;
    await makeOffer(ctx, buyer, { listingId: listing.id, unitPricePaise: 90000 });
    const visible = await request(ctx.app).get(`${API}/notifications`).set(seller.bearer);
    expect(visible.body.items.filter((n) => n.category === 'OFFERS')).toHaveLength(0);
    expect(ctx.emails.filter((m) => m.to === seller.details.email).length).toBe(before);
  });

  it('with offers on, the seller hears about a new offer', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const buyer = await registerVerifiedUser(ctx);
    const listing = await sellable(seller);
    await makeOffer(ctx, buyer, { listingId: listing.id, unitPricePaise: 90000 });
    const items = (await request(ctx.app).get(`${API}/notifications`).set(seller.bearer)).body
      .items;
    expect(items.find((n) => n.category === 'OFFERS')).toMatchObject({ type: 'offerReceived' });
  });
});

describe('message notifications', () => {
  it('at most one per chat every 30 minutes', async () => {
    const ctx = createTestContext();
    let seller = await registerVerifiedUser(ctx);
    let buyer = await registerVerifiedUser(ctx);
    const listing = await sellable(seller);
    const chat = (await startChat(ctx, buyer, { listingId: listing.id })).body.conversation;
    for (const body of ['Hi', 'Is it available?', 'I can come today']) {
      await sendMessage(ctx, buyer, chat.id, { body });
    }
    const forSeller = () =>
      db.notification.count({ where: { userId: seller.user.id, category: 'MESSAGES' } });
    expect(await forSeller()).toBe(1);

    ctx.clock.advance({ minutes: MESSAGE_NOTIFY_INTERVAL_MINUTES });
    buyer = await signInAgain(ctx, buyer);
    await sendMessage(ctx, buyer, chat.id, { body: 'Still there?' });
    expect(await forSeller()).toBe(2);
    // Their own messages never notify the sender.
    expect(
      await db.notification.count({ where: { userId: buyer.user.id, category: 'MESSAGES' } }),
    ).toBe(0);
    seller = null;
  });
});

describe('notification jobs', () => {
  it('reminds both sides to review a day after completion, once', async () => {
    const ctx = createTestContext();
    const { buyer, seller } = await completedOrder(ctx);
    ctx.clock.advance({ hours: REVIEW_REMINDER_DELAY_HOURS });
    await runNotificationJobs(ctx.app.locals.deps);
    await runNotificationJobs(ctx.app.locals.deps);
    for (const account of [buyer, seller]) {
      expect(
        await db.notification.count({ where: { userId: account.user.id, category: 'REVIEWS' } }),
      ).toBe(1);
    }
  });

  it('deletes read notifications after 90 days and keeps unread ones', async () => {
    const ctx = createTestContext();
    const person = await registerVerifiedUser(ctx);
    await deliver(ctx.app.locals.deps, sample(person.user.id, 'keep:unread'));
    await deliver(ctx.app.locals.deps, sample(person.user.id, 'drop:read'));
    await db.notification.update({
      where: { key: 'drop:read' },
      data: { readAt: ctx.clock.now() },
    });
    ctx.clock.advance({ days: NOTIFICATION_RETENTION_DAYS });
    await runNotificationJobs(ctx.app.locals.deps);
    const keys = (await db.notification.findMany({ select: { key: true } })).map((n) => n.key);
    expect(keys).toEqual(['keep:unread']);
  });
});
