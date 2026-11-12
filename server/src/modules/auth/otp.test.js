import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_RESENDS_PER_HOUR,
  OTP_RESEND_COOLDOWN_SECONDS,
} from '../../config/policy.js';
import { createTestContext, db, registerUser, resetDb } from '../../../test/helpers.js';

const API = '/api/v1';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

function wrongCodeFor(code) {
  return code === '000000' ? '000001' : '000000';
}

function verify(ctx, account, channel, code) {
  return request(ctx.app)
    .post(`${API}/auth/otp/verify`)
    .set(account.bearer)
    .send({ channel, code });
}

function resend(ctx, account, channel) {
  return request(ctx.app).post(`${API}/auth/otp/send`).set(account.bearer).send({ channel });
}

// Tests that span more than the 15-minute access token sign in again as needed.
async function freshBearer(ctx, account) {
  const res = await request(ctx.app)
    .post(`${API}/auth/login`)
    .send({ email: account.details.email, password: account.details.password });
  return { ...account, bearer: { Authorization: `Bearer ${res.body.accessToken}` } };
}

describe('contact verification', () => {
  it('verifies the email with the emailed code', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);

    const res = await verify(ctx, account, 'email', ctx.emailCode(account.details.email));

    expect(res.status).toBe(200);
    expect(res.body.user.emailVerified).toBe(true);
    expect(res.body.user.phoneVerified).toBe(false);
  });

  it('verifies the phone with the code sent to the phone', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);

    const res = await verify(ctx, account, 'phone', ctx.phoneCode(account.details.phone));

    expect(res.status).toBe(200);
    expect(res.body.user.phoneVerified).toBe(true);
    expect(res.body.user.emailVerified).toBe(false);
  });

  it('does not accept the email code for the phone', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    const emailCode = ctx.emailCode(account.details.email);
    // Only meaningful when the two random codes differ.
    if (emailCode === ctx.phoneCode(account.details.phone)) return;

    const res = await verify(ctx, account, 'phone', emailCode);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OTP_INVALID');
  });

  it('requires sign-in and a well-formed code', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);

    const anonymous = await request(ctx.app)
      .post(`${API}/auth/otp/verify`)
      .send({ channel: 'email', code: '123456' });
    const malformed = await verify(ctx, account, 'email', '12345');

    expect(anonymous.status).toBe(401);
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('a code works once, and a verified contact cannot be verified again', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    const code = ctx.emailCode(account.details.email);

    expect((await verify(ctx, account, 'email', code)).status).toBe(200);

    const again = await verify(ctx, account, 'email', code);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_VERIFIED');

    const resent = await resend(ctx, account, 'email');
    expect(resent.status).toBe(409);
  });
});

describe('code expiry', () => {
  it('accepts a code just before it expires', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    const code = ctx.emailCode(account.details.email);

    ctx.clock.advance({ minutes: OTP_EXPIRY_MINUTES - 1 });

    expect((await verify(ctx, account, 'email', code)).status).toBe(200);
  });

  it('rejects a code once the expiry time is reached', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    const code = ctx.emailCode(account.details.email);

    ctx.clock.advance({ minutes: OTP_EXPIRY_MINUTES });
    const res = await verify(ctx, account, 'email', code);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
    const row = await db.user.findUnique({ where: { id: account.user.id } });
    expect(row.emailVerifiedAt).toBeNull();
  });

  it('a fresh code works after the old one expired', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);

    ctx.clock.advance({ minutes: OTP_EXPIRY_MINUTES });
    expect((await resend(ctx, account, 'email')).status).toBe(202);

    const res = await verify(ctx, account, 'email', ctx.emailCode(account.details.email));
    expect(res.status).toBe(200);
  });
});

describe('attempt limit', () => {
  it('counts down remaining attempts and then locks the code, even for the right code', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    const code = ctx.emailCode(account.details.email);
    const wrong = wrongCodeFor(code);

    for (let attempt = 1; attempt <= OTP_MAX_ATTEMPTS; attempt += 1) {
      const res = await verify(ctx, account, 'email', wrong);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('OTP_INVALID');
      expect(res.body.error.details.attemptsRemaining).toBe(OTP_MAX_ATTEMPTS - attempt);
    }

    const locked = await verify(ctx, account, 'email', code);
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
    const row = await db.user.findUnique({ where: { id: account.user.id } });
    expect(row.emailVerifiedAt).toBeNull();
  });

  it('accepts the right code on the last allowed attempt', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    const code = ctx.emailCode(account.details.email);

    for (let attempt = 1; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
      await verify(ctx, account, 'email', wrongCodeFor(code));
    }

    expect((await verify(ctx, account, 'email', code)).status).toBe(200);
  });

  it('a new code starts with a fresh set of attempts, and the locked one stays dead', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    const oldCode = ctx.emailCode(account.details.email);
    for (let attempt = 1; attempt <= OTP_MAX_ATTEMPTS; attempt += 1) {
      await verify(ctx, account, 'email', wrongCodeFor(oldCode));
    }

    ctx.clock.advance({ seconds: OTP_RESEND_COOLDOWN_SECONDS });
    expect((await resend(ctx, account, 'email')).status).toBe(202);
    const newCode = ctx.emailCode(account.details.email);

    if (newCode !== oldCode) {
      expect((await verify(ctx, account, 'email', oldCode)).status).toBe(400);
    }
    expect((await verify(ctx, account, 'email', newCode)).status).toBe(200);
  });

  it('attempts on the email code do not use up the phone code', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    const emailCode = ctx.emailCode(account.details.email);
    for (let attempt = 1; attempt <= OTP_MAX_ATTEMPTS; attempt += 1) {
      await verify(ctx, account, 'email', wrongCodeFor(emailCode));
    }

    const res = await verify(ctx, account, 'phone', ctx.phoneCode(account.details.phone));
    expect(res.status).toBe(200);
  });
});

describe('resend throttling', () => {
  it('refuses a resend inside the 60-second wait and says how long is left', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);

    ctx.clock.advance({ seconds: OTP_RESEND_COOLDOWN_SECONDS - 15 });
    const res = await resend(ctx, account, 'email');

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('OTP_RESEND_TOO_SOON');
    expect(res.body.error.details.retryAfterSeconds).toBe(15);
    expect(ctx.emails.filter((m) => m.to === account.details.email)).toHaveLength(1);
  });

  it('allows a resend once the wait is over, and only the newest code works', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);
    const firstCode = ctx.emailCode(account.details.email);

    ctx.clock.advance({ seconds: OTP_RESEND_COOLDOWN_SECONDS });
    expect((await resend(ctx, account, 'email')).status).toBe(202);
    const secondCode = ctx.emailCode(account.details.email);

    if (firstCode !== secondCode) {
      const stale = await verify(ctx, account, 'email', firstCode);
      expect(stale.status).toBe(400);
      expect(stale.body.error.code).toBe('OTP_INVALID');
    }
    expect((await verify(ctx, account, 'email', secondCode)).status).toBe(200);
  });

  it('throttles email and phone separately', async () => {
    const ctx = createTestContext();
    const account = await registerUser(ctx);

    ctx.clock.advance({ seconds: OTP_RESEND_COOLDOWN_SECONDS });
    expect((await resend(ctx, account, 'email')).status).toBe(202);
    expect((await resend(ctx, account, 'phone')).status).toBe(202);
    expect((await resend(ctx, account, 'phone')).status).toBe(429);
  });

  it('allows 5 resends in an hour, refuses the next, and recovers as the hour rolls on', async () => {
    const ctx = createTestContext();
    let account = await registerUser(ctx); // the initial send, at minute 0

    // Resends at minutes 2, 4, 6, 8 and 10.
    for (let i = 1; i <= OTP_MAX_RESENDS_PER_HOUR; i += 1) {
      ctx.clock.advance({ minutes: 2 });
      expect((await resend(ctx, account, 'email')).status).toBe(202);
    }

    ctx.clock.advance({ minutes: 2 });
    const refused = await resend(ctx, account, 'email');
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe('OTP_RESEND_LIMIT');
    expect(ctx.emails.filter((m) => m.to === account.details.email)).toHaveLength(
      1 + OTP_MAX_RESENDS_PER_HOUR,
    );

    // At minute 59 all six sends are still inside the hour.
    ctx.clock.advance({ minutes: 47 });
    account = await freshBearer(ctx, account);
    expect((await resend(ctx, account, 'email')).status).toBe(429);

    // At minute 60 the initial send has aged out.
    ctx.clock.advance({ minutes: 1 });
    expect((await resend(ctx, account, 'email')).status).toBe(202);
  });
});
