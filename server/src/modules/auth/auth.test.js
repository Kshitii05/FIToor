import request from 'supertest';
import { MemoryStore } from 'express-rate-limit';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RATE_LIMITS, REFRESH_REUSE_GRACE_SECONDS } from '../../config/policy.js';
import {
  createTestContext,
  db,
  newUserDetails,
  refreshCookieFrom,
  refreshCookieHeader,
  registerUser,
  resetDb,
} from '../../../test/helpers.js';

const API = '/api/v1';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe('registration', () => {
  it('creates the account, signs the user in and sends both verification codes', async () => {
    const ctx = createTestContext();
    const details = newUserDetails({ email: '  Asha@Example.com ', phone: '98765 43210' });

    const res = await request(ctx.app).post(`${API}/auth/register`).send(details);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: 'asha@example.com',
      phone: '+919876543210',
      emailVerified: false,
      phoneVerified: false,
      profile: { displayName: details.displayName, bio: null, photoUrl: null, locality: null },
    });
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const cookie = refreshCookieHeader(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/);

    expect(ctx.emailCode('asha@example.com')).toMatch(/^\d{6}$/);
    expect(ctx.phoneCode('+919876543210')).toMatch(/^\d{6}$/);
  });

  it('stores the password and the codes only as hashes', async () => {
    const ctx = createTestContext();
    const { details, user } = await registerUser(ctx);

    const row = await db.user.findUnique({
      where: { id: user.id },
      include: { verifications: true, sessions: true },
    });

    expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(row.passwordHash).not.toContain(details.password);
    const emailCode = ctx.emailCode(details.email);
    for (const verification of row.verifications) {
      expect(verification.codeHash).not.toContain(emailCode);
      expect(verification.codeHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(row.sessions).toHaveLength(1);
    expect(row.sessions[0].refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses an email or phone number that is already registered', async () => {
    const ctx = createTestContext();
    const { details } = await registerUser(ctx);

    const sameEmail = await request(ctx.app)
      .post(`${API}/auth/register`)
      .send(newUserDetails({ email: details.email.toUpperCase() }));
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.error.code).toBe('EMAIL_TAKEN');

    const samePhone = await request(ctx.app)
      .post(`${API}/auth/register`)
      .send(newUserDetails({ phone: details.phone.slice(3) }));
    expect(samePhone.status).toBe(409);
    expect(samePhone.body.error.code).toBe('PHONE_TAKEN');
  });

  it.each([
    ['a short password', { password: 'short' }],
    ['a password over 72 bytes', { password: 'x'.repeat(73) }],
    ['a malformed email', { email: 'not-an-email' }],
    ['a non-Indian phone number', { phone: '+14155550100' }],
    ['a blank display name', { displayName: ' ' }],
    ['an unknown field', { role: 'admin' }],
  ])('rejects %s', async (_label, overrides) => {
    const ctx = createTestContext();

    const res = await request(ctx.app).post(`${API}/auth/register`).send(newUserDetails(overrides));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await db.user.count()).toBe(0);
  });
});

describe('login', () => {
  it('signs in with the right email and password', async () => {
    const ctx = createTestContext();
    const { details, user } = await registerUser(ctx);

    const res = await request(ctx.app)
      .post(`${API}/auth/login`)
      .send({ email: details.email.toUpperCase(), password: details.password });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(refreshCookieFrom(res)).not.toBeNull();
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const ctx = createTestContext();
    const { details } = await registerUser(ctx);

    const wrongPassword = await request(ctx.app)
      .post(`${API}/auth/login`)
      .send({ email: details.email, password: 'not the password' });
    const unknownEmail = await request(ctx.app)
      .post(`${API}/auth/login`)
      .send({ email: 'nobody@example.com', password: details.password });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(refreshCookieFrom(wrongPassword)).toBeNull();
  });
});

describe('access tokens', () => {
  it('are required for protected routes', async () => {
    const ctx = createTestContext();

    const missing = await request(ctx.app).get(`${API}/me`);
    const garbage = await request(ctx.app).get(`${API}/me`).set('Authorization', 'Bearer nope');

    expect(missing.status).toBe(401);
    expect(garbage.status).toBe(401);
  });

  it('expire after 15 minutes', async () => {
    const ctx = createTestContext();
    const { bearer } = await registerUser(ctx);

    ctx.clock.advance({ minutes: 14, seconds: 59 });
    expect((await request(ctx.app).get(`${API}/me`).set(bearer)).status).toBe(200);

    ctx.clock.advance({ seconds: 1 });
    expect((await request(ctx.app).get(`${API}/me`).set(bearer)).status).toBe(401);
  });
});

describe('refresh', () => {
  it('issues a new access token and rotates the refresh token', async () => {
    const ctx = createTestContext();
    const { refreshCookie } = await registerUser(ctx);
    ctx.clock.advance({ minutes: 20 });

    const res = await request(ctx.app).post(`${API}/auth/refresh`).set('Cookie', refreshCookie);

    expect(res.status).toBe(200);
    const rotated = refreshCookieFrom(res);
    expect(rotated).not.toBeNull();
    expect(rotated).not.toBe(refreshCookie);

    const me = await request(ctx.app)
      .get(`${API}/me`)
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('revokes the session when an already-used refresh token is presented again', async () => {
    const ctx = createTestContext();
    const { refreshCookie } = await registerUser(ctx);

    const first = await request(ctx.app).post(`${API}/auth/refresh`).set('Cookie', refreshCookie);
    expect(first.status).toBe(200);

    ctx.clock.advance({ seconds: REFRESH_REUSE_GRACE_SECONDS });
    const replay = await request(ctx.app).post(`${API}/auth/refresh`).set('Cookie', refreshCookie);
    expect(replay.status).toBe(401);

    // The legitimate holder of the newer token is signed out too.
    const afterReplay = await request(ctx.app)
      .post(`${API}/auth/refresh`)
      .set('Cookie', refreshCookieFrom(first));
    expect(afterReplay.status).toBe(401);

    const me = await request(ctx.app)
      .get(`${API}/me`)
      .set('Authorization', `Bearer ${first.body.accessToken}`);
    expect(me.status).toBe(401);
  });

  it('refuses a replay right after the rotation without ending the session', async () => {
    const ctx = createTestContext();
    const { refreshCookie } = await registerUser(ctx);

    // Two tabs of one browser refreshing at the same moment with the same cookie.
    const first = await request(ctx.app).post(`${API}/auth/refresh`).set('Cookie', refreshCookie);
    ctx.clock.advance({ seconds: REFRESH_REUSE_GRACE_SECONDS - 1 });
    const second = await request(ctx.app).post(`${API}/auth/refresh`).set('Cookie', refreshCookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(401);

    const next = await request(ctx.app)
      .post(`${API}/auth/refresh`)
      .set('Cookie', refreshCookieFrom(first));
    expect(next.status).toBe(200);
  });

  it('stops working 30 days after the last use', async () => {
    const ctx = createTestContext();
    const { refreshCookie } = await registerUser(ctx);

    ctx.clock.advance({ days: 30 });
    const res = await request(ctx.app).post(`${API}/auth/refresh`).set('Cookie', refreshCookie);

    expect(res.status).toBe(401);
  });

  it('is refused without a cookie, with an unknown token, or from another site', async () => {
    const ctx = createTestContext();
    const { refreshCookie } = await registerUser(ctx);

    const noCookie = await request(ctx.app).post(`${API}/auth/refresh`);
    const unknown = await request(ctx.app)
      .post(`${API}/auth/refresh`)
      .set('Cookie', 'refresh_token=made-up');
    const otherSite = await request(ctx.app)
      .post(`${API}/auth/refresh`)
      .set('Cookie', refreshCookie)
      .set('Origin', 'https://evil.example');

    expect(noCookie.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(otherSite.status).toBe(403);
  });
});

describe('logout', () => {
  it('ends the session immediately', async () => {
    const ctx = createTestContext();
    const { bearer, refreshCookie } = await registerUser(ctx);

    const res = await request(ctx.app).post(`${API}/auth/logout`).set('Cookie', refreshCookie);
    expect(res.status).toBe(204);
    expect(refreshCookieFrom(res)).toBeNull();

    expect((await request(ctx.app).get(`${API}/me`).set(bearer)).status).toBe(401);
    const refresh = await request(ctx.app).post(`${API}/auth/refresh`).set('Cookie', refreshCookie);
    expect(refresh.status).toBe(401);
  });

  it('succeeds when there is no session to end', async () => {
    const ctx = createTestContext();
    expect((await request(ctx.app).post(`${API}/auth/logout`)).status).toBe(204);
  });
});

describe('rate limiting', () => {
  it('blocks login attempts from one address beyond the limit', async () => {
    const ctx = createTestContext({
      rateLimiting: { enabled: true, makeStore: () => new MemoryStore() },
    });
    const attempt = () =>
      request(ctx.app)
        .post(`${API}/auth/login`)
        .send({ email: 'nobody@example.com', password: 'whatever' });

    for (let i = 0; i < RATE_LIMITS.login.max; i += 1) {
      expect((await attempt()).status).toBe(401);
    }

    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
