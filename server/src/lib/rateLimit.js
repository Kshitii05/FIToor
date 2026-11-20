import { rateLimit } from 'express-rate-limit';
import { RATE_LIMITS } from '../config/policy.js';
import { AppError } from './errors.js';

const passThrough = (_req, _res, next) => next();

/**
 * Builds two limiters per entry in RATE_LIMITS (config/policy.js): `<name>` counts
 * per IP address, and `<name>PerUser` counts per signed-in person (use it after
 * requireAuth). `makeStore(name)` returns the counter store; each limiter needs its own.
 */
export function createLimiters({ enabled, makeStore }) {
  const limiters = {};
  const build = (name, { windowMinutes, max }, keyGenerator) =>
    rateLimit({
      windowMs: windowMinutes * 60 * 1000,
      limit: max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      store: makeStore(name),
      ...(keyGenerator ? { keyGenerator } : {}),
      handler: (_req, _res, next) =>
        next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Try again later.')),
    });

  for (const [name, limit] of Object.entries(RATE_LIMITS)) {
    limiters[name] = enabled ? build(name, limit) : passThrough;
    limiters[`${name}PerUser`] = enabled
      ? build(`${name}-user`, limit, (req) => `user:${req.auth.userId}`)
      : passThrough;
  }

  return limiters;
}
