import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OTP_EXPIRY_MINUTES, OTP_MAX_ATTEMPTS } from '../../config/policy.js';
import { createTestContext, db, registerUser, resetDb } from '../../../test/helpers.js';

const API = '/api/v1';
const NEW_PASSWORD = 'a brand new password';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

function forgot(ctx, email) {
  return request(ctx.app).post(`${API}/auth/password/forgot`).send({ email });
}

function reset(ctx, body) {
  return request(ctx.app).post(`${API}/auth/password/reset`).send(body);
}

function login(ctx, email, password) {
  return request(ctx.app).post(`${API}/auth/login`).send({ email, password });
}

describe('password reset', () => {
  it('answers the same way for a known and an unknown email', async () => {
    const ctx = createTestContext();
    const { details } = await registerUser(ctx);
    const emailsBefore = ctx.emails.length;

    const known = await forgot(ctx, details.email);
    const unknown = await forgot(ctx, 'nobody@example.com');

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(ctx.emails).toHaveLength(emailsBefore + 1);
    expect(ctx.lastEmailTo('nobody@example.com')).toBeUndefined();
  });

  it('sets a new password with the emailed code and signs out every device', async () => {
    const ctx = createTestContext();
    const { details, bearer, refreshCookie } = await registerUser(ctx);
    await forgot(ctx, details.email);
    const code = ctx.emailCode(details.email);

    const res = await reset(ctx, { email: details.email, code, password: NEW_PASSWORD });
    expect(res.status).toBe(204);

    expect((await login(ctx, details.email, details.password)).status).toBe(401);
    expect((await login(ctx, details.email, NEW_PASSWORD)).status).toBe(200);

    expect((await request(ctx.app).get(`${API}/me`).set(bearer)).status).toBe(401);
    const refresh = await request(ctx.app).post(`${API}/auth/refresh`).set('Cookie', refreshCookie);
    expect(refresh.status).toBe(401);
  });

  it('a reset code cannot be used twice', async () => {
    const ctx = createTestContext();
    const { details } = await registerUser(ctx);
    await forgot(ctx, details.email);
    const code = ctx.emailCode(details.email);
    await reset(ctx, { email: details.email, code, password: NEW_PASSWORD });

    const again = await reset(ctx, {
      email: details.email,
      code,
      password: 'yet another password',
    });

    expect(again.status).toBe(400);
    expect((await login(ctx, details.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('rejects a wrong code, an expired code and a weak new password', async () => {
    const ctx = createTestContext();
    const { details } = await registerUser(ctx);
    await forgot(ctx, details.email);
    const code = ctx.emailCode(details.email);
    const wrong = code === '000000' ? '000001' : '000000';

    const wrongCode = await reset(ctx, {
      email: details.email,
      code: wrong,
      password: NEW_PASSWORD,
    });
    expect(wrongCode.status).toBe(400);
    expect(wrongCode.body.error.code).toBe('OTP_INVALID');

    const weak = await reset(ctx, { email: details.email, code, password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');

    ctx.clock.advance({ minutes: OTP_EXPIRY_MINUTES });
    const expired = await reset(ctx, { email: details.email, code, password: NEW_PASSWORD });
    expect(expired.status).toBe(400);
    expect(expired.body.error.code).toBe('OTP_EXPIRED');

    expect((await login(ctx, details.email, details.password)).status).toBe(200);
  });

  it('locks the reset code after too many wrong attempts', async () => {
    const ctx = createTestContext();
    const { details } = await registerUser(ctx);
    await forgot(ctx, details.email);
    const code = ctx.emailCode(details.email);
    const wrong = code === '000000' ? '000001' : '000000';

    for (let attempt = 1; attempt <= OTP_MAX_ATTEMPTS; attempt += 1) {
      await reset(ctx, { email: details.email, code: wrong, password: NEW_PASSWORD });
    }
    const locked = await reset(ctx, { email: details.email, code, password: NEW_PASSWORD });

    expect(locked.status).toBe(429);
    expect((await login(ctx, details.email, details.password)).status).toBe(200);
  });

  it('the email verification code cannot be used to reset the password', async () => {
    const ctx = createTestContext();
    const { details } = await registerUser(ctx);
    const verificationCode = ctx.emailCode(details.email);

    const res = await reset(ctx, {
      email: details.email,
      code: verificationCode,
      password: NEW_PASSWORD,
    });

    expect(res.status).toBe(400);
    expect((await login(ctx, details.email, details.password)).status).toBe(200);
  });

  it('an unknown email gets the same rejection as a wrong code', async () => {
    const ctx = createTestContext();

    const res = await reset(ctx, {
      email: 'nobody@example.com',
      code: '123456',
      password: NEW_PASSWORD,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OTP_INVALID');
  });

  it('repeated requests inside the resend wait send no second email and still answer 202', async () => {
    const ctx = createTestContext();
    const { details } = await registerUser(ctx);

    await forgot(ctx, details.email);
    const sent = ctx.emails.length;
    const second = await forgot(ctx, details.email);

    expect(second.status).toBe(202);
    expect(ctx.emails).toHaveLength(sent);
  });
});
