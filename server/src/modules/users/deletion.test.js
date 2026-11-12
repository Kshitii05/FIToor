import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ACCOUNT_RECOVERY_DAYS } from '../../config/policy.js';
import { addDays } from '../../lib/clock.js';
import {
  createTestContext,
  db,
  newUserDetails,
  refreshCookieFrom,
  registerUser,
  resetDb,
} from '../../../test/helpers.js';
import { purgeExpiredDeletions, registerDeletionBlocker } from './deletion.service.js';

const API = '/api/v1';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

function requestDeletion(ctx, account, password = account.details.password) {
  return request(ctx.app).post(`${API}/me/deletion`).set(account.bearer).send({ password });
}

function login(ctx, { email, password }) {
  return request(ctx.app).post(`${API}/auth/login`).send({ email, password });
}

function recover(ctx, { email, password }) {
  return request(ctx.app).post(`${API}/auth/recover`).send({ email, password });
}

describe('requesting deletion', () => {
  it('needs the current password', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);

    const res = await requestDeletion(ctx, account, 'not the password');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVALID_PASSWORD');
    expect((await request(ctx.app).get(`${API}/me`).set(account.bearer)).status).toBe(200);
  });

  it('deactivates the account, signs out every device and emails the erase date', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    const expected = addDays(ctx.clock.now(), ACCOUNT_RECOVERY_DAYS).toISOString();

    const res = await requestDeletion(ctx, account);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recoverableUntil: expected });
    expect(refreshCookieFrom(res)).toBeNull();

    expect((await request(ctx.app).get(`${API}/me`).set(account.bearer)).status).toBe(401);
    const refresh = await request(ctx.app)
      .post(`${API}/auth/refresh`)
      .set('Cookie', account.refreshCookie);
    expect(refresh.status).toBe(401);

    expect(ctx.lastEmailTo(account.details.email).subject).toMatch(/scheduled for deletion/);
    expect((await request(ctx.app).get(`${API}/users/${account.user.id}`)).status).toBe(404);
  });

  it('refuses sign-in while deletion is pending, and says until when it can be recovered', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    const { body } = await requestDeletion(ctx, account);

    const res = await login(ctx, account.details);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_PENDING_DELETION');
    expect(res.body.error.details.recoverableUntil).toBe(body.recoverableUntil);

    const wrongPassword = await login(ctx, { ...account.details, password: 'not the password' });
    expect(wrongPassword.status).toBe(401);
  });

  it('keeps the email and phone reserved during the recovery period', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    await requestDeletion(ctx, account);

    const res = await request(ctx.app)
      .post(`${API}/auth/register`)
      .send(newUserDetails({ email: account.details.email }));

    expect(res.status).toBe(409);
  });

  it('is refused while another module reports unfinished activity', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    const unregister = registerDeletionBlocker(async ({ userId }) =>
      userId === account.user.id ? 'You have an order in progress' : null,
    );

    try {
      const res = await requestDeletion(ctx, account);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DELETION_BLOCKED');
      expect(res.body.error.details.reasons).toEqual(['You have an order in progress']);
      expect((await request(ctx.app).get(`${API}/me`).set(account.bearer)).status).toBe(200);
    } finally {
      unregister();
    }
  });
});

describe('recovery', () => {
  it('reactivates the account and signs the user in, up to the last moment', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    await requestDeletion(ctx, account);

    ctx.clock.advance({ days: ACCOUNT_RECOVERY_DAYS - 1, hours: 23, minutes: 59 });
    const res = await recover(ctx, account.details);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(account.user.id);
    const me = await request(ctx.app)
      .get(`${API}/me`)
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);

    // The scheduled erase no longer applies.
    ctx.clock.advance({ days: 5 });
    expect(await purgeExpiredDeletions({ db, clock: ctx.clock })).toBe(0);
    expect((await login(ctx, account.details)).status).toBe(200);
  });

  it('needs the right password and an account that is actually pending deletion', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);

    const notPending = await recover(ctx, account.details);
    expect(notPending.status).toBe(409);

    await requestDeletion(ctx, account);
    const wrongPassword = await recover(ctx, { ...account.details, password: 'not the password' });
    expect(wrongPassword.status).toBe(401);
  });

  it('is refused once the 30 days are over, even before the erase job has run', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    await requestDeletion(ctx, account);

    ctx.clock.advance({ days: ACCOUNT_RECOVERY_DAYS });
    const res = await recover(ctx, account.details);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_RECOVERY_EXPIRED');
  });
});

describe('erasing after the recovery period', () => {
  it('leaves accounts alone until the period ends', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    await requestDeletion(ctx, account);

    ctx.clock.advance({ days: ACCOUNT_RECOVERY_DAYS - 1, hours: 23, minutes: 59 });

    expect(await purgeExpiredDeletions({ db, clock: ctx.clock })).toBe(0);
    const row = await db.user.findUnique({ where: { id: account.user.id } });
    expect(row.status).toBe('PENDING_DELETION');
    expect(row.email).toBe(account.details.email);
  });

  it('removes personal data, keeps an anonymous row, and frees the email and phone', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    const bystander = await registerUser(ctx);
    await request(ctx.app)
      .patch(`${API}/me/profile`)
      .set(account.bearer)
      .send({ bio: 'About me', locality: 'Indiranagar' });
    await requestDeletion(ctx, account);

    ctx.clock.advance({ days: ACCOUNT_RECOVERY_DAYS });
    expect(await purgeExpiredDeletions({ db, clock: ctx.clock })).toBe(1);
    expect(await purgeExpiredDeletions({ db, clock: ctx.clock })).toBe(0);

    const row = await db.user.findUnique({
      where: { id: account.user.id },
      include: { profile: true, preferences: true, verifications: true, sessions: true },
    });
    expect(row.status).toBe('DELETED');
    expect(row.deletedAt).toEqual(ctx.clock.now());
    expect(row.phone).toBeNull();
    expect(row.email).toBe(`deleted-${account.user.id}@deleted.invalid`);
    expect(row.profile).toMatchObject({
      displayName: 'Deleted user',
      bio: null,
      photoUrl: null,
      locality: null,
    });
    expect(row.preferences).toBeNull();
    expect(row.verifications).toEqual([]);
    expect(row.sessions).toEqual([]);
    expect(JSON.stringify(row)).not.toContain(account.details.email);

    expect((await login(ctx, account.details)).status).toBe(401);
    expect((await recover(ctx, account.details)).status).toBe(401);
    expect((await request(ctx.app).get(`${API}/users/${account.user.id}`)).status).toBe(404);

    const again = await request(ctx.app)
      .post(`${API}/auth/register`)
      .send(newUserDetails({ email: account.details.email, phone: account.details.phone }));
    expect(again.status).toBe(201);

    // Other accounts are untouched.
    expect((await login(ctx, bystander.details)).status).toBe(200);
  });
});
