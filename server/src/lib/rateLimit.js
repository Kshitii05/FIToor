import { rateLimit } from 'express-rate-limit';
import { RATE_LIMITS } from '../config/policy.js';
import { AppError } from './errors.js';

const passThrough = (_req, _res, next) => next();

/**
 * Builds one limiter per entry in RATE_LIMITS (config/policy.js).
 * `makeStore(name)` returns the counter store for a limiter; each limiter needs its own.
 */
export function createLimiters({ enabled, makeStore }) {
  const limiters = {};

  for (const [name, { windowMinutes, max }] of Object.entries(RATE_LIMITS)) {
    limiters[name] = enabled
      ? rateLimit({
          windowMs: windowMinutes * 60 * 1000,
          limit: max,
          standardHeaders: 'draft-7',
          legacyHeaders: false,
          store: makeStore(name),
          handler: (_req, _res, next) =>
            next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Try again later.')),
        })
      : passThrough;
  }

  return limiters;
}
