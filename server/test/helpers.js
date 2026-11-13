import request from 'supertest';
import { createApp } from '../src/app.js';
import { REFRESH_COOKIE_NAME } from '../src/config/security.js';
import { createFixedClock } from '../src/lib/clock.js';
import { db } from '../src/lib/db.js';
import { createSimulatedGateway } from '../src/lib/paymentGateway.js';

export { db };

const silentLogger = { info() {}, warn() {}, error() {} };

/**
 * Empties every table that tests write to, children first. Plain deletes are far
 * quicker than TRUNCATE on near-empty tables. Append-only tables (ledger, webhook
 * events, order history, admin log) accept deletes only with the setting below,
 * which lasts for this transaction alone.
 */
export async function resetDb() {
  await db.$transaction([
    db.$executeRaw`SET LOCAL app.allow_record_deletion = 'on'`,
    db.$executeRaw`DELETE FROM ledger_entries`,
    db.$executeRaw`DELETE FROM payment_events`,
    db.$executeRaw`DELETE FROM admin_audit_logs`,
    db.$executeRaw`DELETE FROM order_events`,
    db.$executeRaw`DELETE FROM booking_events`,
    db.$executeRaw`DELETE FROM refunds`,
    db.$executeRaw`DELETE FROM order_issues`,
    db.$executeRaw`DELETE FROM order_items`,
    db.$executeRaw`DELETE FROM orders`,
    db.$executeRaw`DELETE FROM payments`,
    db.$executeRaw`DELETE FROM checkouts`,
    db.$executeRaw`DELETE FROM rental_claims`,
    db.$executeRaw`DELETE FROM rental_date_holds`,
    db.$executeRaw`DELETE FROM rental_blocked_dates`,
    db.$executeRaw`DELETE FROM rental_bookings`,
    db.$executeRaw`DELETE FROM listing_status_events`,
    db.$executeRaw`DELETE FROM listings`,
    db.$executeRaw`DELETE FROM users`,
  ]);
}

/**
 * An app wired with a fixed clock and in-memory senders, so tests control time
 * and can read the codes and emails that would have been sent.
 */
export function createTestContext({ start = '2026-11-13T06:30:00.000Z', ...appOptions } = {}) {
  const clock = createFixedClock(start);
  const emails = [];
  const texts = [];
  const imageStorage = createMemoryImageStorage();
  const placeLookup = createFakePlaceLookup();
  const gateway = createSimulatedGateway({
    keySecret: 'test-key-secret',
    webhookSecret: 'test-webhook-secret',
  });

  const app = createApp({
    clock,
    logger: silentLogger,
    emailSender: { send: async (message) => void emails.push(message) },
    otpSender: { send: async (message) => void texts.push(message) },
    imageStorage,
    placeLookup,
    paymentGateway: gateway,
    ...appOptions,
  });

  const lastEmailTo = (to) => emails.findLast((message) => message.to === to);

  return {
    app,
    clock,
    emails,
    texts,
    imageStorage,
    placeLookup,
    gateway,
    lastEmailTo,
    /** The most recent code emailed to an address. */
    emailCode: (to) => lastEmailTo(to)?.text.match(/\b\d{6}\b/)?.[0],
    /** The most recent code sent to a phone number. */
    phoneCode: (phone) => texts.findLast((message) => message.phone === phone)?.code,
  };
}

/** Stands in for the image host: remembers what was stored and what was removed. */
export function createMemoryImageStorage() {
  const stored = new Map();
  const removed = [];
  let next = 0;
  return {
    stored,
    removed,
    async upload({ buffer, extension, folder }) {
      next += 1;
      const storageId = `${folder}/test-${next}.${extension}`;
      stored.set(storageId, buffer);
      return { url: `https://images.test/${storageId}`, storageId };
    },
    async remove(storageId) {
      stored.delete(storageId);
      removed.push(storageId);
    },
  };
}

/** Stands in for the place service, so tests never call OpenStreetMap. */
export function createFakePlaceLookup() {
  const calls = [];
  return {
    calls,
    async search(text) {
      calls.push({ search: text });
      return [
        {
          locality: 'Indiranagar',
          city: 'Bengaluru',
          pincode: '560038',
          label: 'Indiranagar, Bengaluru',
          lat: 12.9784,
          lng: 77.6408,
        },
      ];
    },
    async reverse(point) {
      calls.push({ reverse: point });
      return { locality: 'Indiranagar', city: 'Bengaluru', label: 'Indiranagar, Bengaluru' };
    },
  };
}

let counter = 0;

/** Unique, valid registration details. */
export function newUserDetails(overrides = {}) {
  counter += 1;
  return {
    email: `user${counter}@example.com`,
    phone: `+919${String(counter).padStart(9, '0')}`,
    password: 'correct horse battery',
    displayName: `User ${counter}`,
    ...overrides,
  };
}

/** Registers a user and returns everything a test needs to act as them. */
export async function registerUser(ctx, overrides = {}) {
  const details = newUserDetails(overrides);
  const res = await request(ctx.app).post('/api/v1/auth/register').send(details);
  if (res.status !== 201) {
    throw new Error(`Registration failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    details,
    user: res.body.user,
    accessToken: res.body.accessToken,
    refreshCookie: refreshCookieFrom(res),
    bearer: { Authorization: `Bearer ${res.body.accessToken}` },
  };
}

/** Registers a user and marks both contacts verified, as needed to list, buy or rent. */
export async function registerVerifiedUser(ctx, overrides = {}) {
  const account = await registerUser(ctx, overrides);
  const now = ctx.clock.now();
  await db.user.update({
    where: { id: account.user.id },
    data: { emailVerifiedAt: now, phoneVerifiedAt: now },
  });
  return account;
}

/** The `name=value` refresh cookie pair set by a response, or null. */
export function refreshCookieFrom(res) {
  const header = (res.headers['set-cookie'] ?? []).find((cookie) =>
    cookie.startsWith(`${REFRESH_COOKIE_NAME}=`),
  );
  if (!header) return null;
  const pair = header.split(';')[0];
  return pair === `${REFRESH_COOKIE_NAME}=` ? null : pair;
}

/** The full Set-Cookie header for the refresh cookie, for checking its attributes. */
export function refreshCookieHeader(res) {
  return (res.headers['set-cookie'] ?? []).find((cookie) =>
    cookie.startsWith(`${REFRESH_COOKIE_NAME}=`),
  );
}
