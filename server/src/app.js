import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { API_PREFIX } from './config/app.js';
import { env } from './config/env.js';
import { systemClock } from './lib/clock.js';
import { db as defaultDb } from './lib/db.js';
import { createErrorHandler, notFoundHandler } from './lib/errors.js';
import { createHealthRouter } from './modules/health/health.routes.js';

/**
 * Builds the Express app. Dependencies are passed in so tests can supply a fixed
 * clock or a failing database; `configureRoutes` lets tests mount extra routes
 * ahead of the 404 and error handlers.
 */
export function createApp({
  db = defaultDb,
  clock = systemClock,
  logger = console,
  configureRoutes,
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();
  api.use('/health', createHealthRouter({ db, clock }));
  configureRoutes?.(api);
  app.use(API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger, exposeStack: env.NODE_ENV === 'development' }));

  return app;
}
