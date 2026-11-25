// SPEC 18 and CLAUDE.md: auth, OTP, messaging, offers and reporting endpoints are
// rate-limited. Sign-in and messages have their own tests; these cover OTP checks,
// offers and reports. Every request counts, whatever its outcome, so a flood of bad
// guesses or junk is cut off as well.
import { MemoryStore } from 'express-rate-limit';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RATE_LIMITS } from '../config/policy.js';
import {
  createTestContext,
  db,
  registerUser,
  registerVerifiedUser,
  resetDb,
} from '../../test/helpers.js';

const API = '/api/v1';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const limited = () =>
  createTestContext({ rateLimiting: { enabled: true, makeStore: () => new MemoryStore() } });

/**
 * Sends `send()` one more time than the limit allows; returns each answer's error
 * code. The limiter answers RATE_LIMITED; other refusals (a bad code, a locked
 * code, invalid input) have their own codes and still count towards the limit.
 */
async function flood(send, max) {
  const codes = [];
  for (let i = 0; i <= max; i += 1) codes.push((await send(i)).body?.error?.code);
  return codes;
}

describe('rate limits', () => {
  it(`OTP checks: ${RATE_LIMITS.otp.max} in ${RATE_LIMITS.otp.windowMinutes} minutes, then refused`, async () => {
    const ctx = limited();
    const account = await registerUser(ctx);
    const codes = await flood(
      () =>
        request(ctx.app)
          .post(`${API}/auth/otp/verify`)
          .set(account.bearer)
          .send({ channel: 'email', code: '000000' }),
      RATE_LIMITS.otp.max,
    );
    expect(codes.slice(0, -1)).not.toContain('RATE_LIMITED');
    expect(codes.at(-1)).toBe('RATE_LIMITED');
  });

  it(`offers: ${RATE_LIMITS.offer.max} an hour, then refused`, async () => {
    const ctx = limited();
    const buyer = await registerVerifiedUser(ctx);
    const codes = await flood(
      () => request(ctx.app).post(`${API}/offers`).set(buyer.bearer).send({}),
      RATE_LIMITS.offer.max,
    );
    expect(codes.slice(0, -1)).not.toContain('RATE_LIMITED');
    expect(codes.at(-1)).toBe('RATE_LIMITED');
  });

  it(`reports: ${RATE_LIMITS.report.max} an hour, then refused`, async () => {
    const ctx = limited();
    const reporter = await registerVerifiedUser(ctx);
    const codes = await flood(
      () => request(ctx.app).post(`${API}/reports`).set(reporter.bearer).send({}),
      RATE_LIMITS.report.max,
    );
    expect(codes.slice(0, -1)).not.toContain('RATE_LIMITED');
    expect(codes.at(-1)).toBe('RATE_LIMITED');
    const res = await request(ctx.app).post(`${API}/reports`).set(reporter.bearer).send({});
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
