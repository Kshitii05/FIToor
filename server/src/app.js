import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { API_PREFIX } from './config/app.js';
import { env } from './config/env.js';
import { createRequireAuth } from './lib/auth.js';
import { systemClock } from './lib/clock.js';
import { db as defaultDb } from './lib/db.js';
import { createErrorHandler, notFoundHandler } from './lib/errors.js';
import { createEmailSender } from './lib/mailer.js';
import { createOtpSender } from './lib/otpSender.js';
import { createLimiters } from './lib/rateLimit.js';
import { createRedisRateLimitStore } from './lib/redis.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createMeRouter, createUsersRouter } from './modules/users/users.routes.js';

/**
 * Builds the Express app. Dependencies are passed in so tests can supply a fixed
 * clock, capture outgoing email and codes, or use a failing database;
 * `configureRoutes` lets tests mount extra routes ahead of the 404 and error handlers.
 *
 * Rate limiting is off under test unless a test turns it on with its own store.
 */
export function createApp({
  db = defaultDb,
  clock = systemClock,
  logger = console,
  emailSender = createEmailSender({ logger }),
  otpSender = createOtpSender({ logger }),
  rateLimiting = { enabled: env.NODE_ENV !== 'test', makeStore: createRedisRateLimitStore },
  configureRoutes,
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  // Behind the hosting platform's proxy in production; needed for the client IP.
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const deps = {
    db,
    clock,
    logger,
    emailSender,
    otpSender,
    limiters: createLimiters(rateLimiting),
    requireAuth: createRequireAuth({ db, clock }),
  };

  const api = express.Router();
  api.use('/health', createHealthRouter(deps));
  api.use('/auth', createAuthRouter(deps));
  api.use('/me', createMeRouter(deps));
  api.use('/users', createUsersRouter(deps));
  configureRoutes?.(api);
  app.use(API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger, exposeStack: env.NODE_ENV === 'development' }));

  return app;
}
