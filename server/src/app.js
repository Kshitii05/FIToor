import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { API_PREFIX } from './config/app.js';
import { env } from './config/env.js';
import { createOptionalAuth, createRequireAuth } from './lib/auth.js';
import { systemClock } from './lib/clock.js';
import { db as defaultDb } from './lib/db.js';
import { createErrorHandler, notFoundHandler } from './lib/errors.js';
import { createImageStorage, LOCAL_UPLOADS_ROUTE } from './lib/imageStorage.js';
import { createPaymentGateway } from './lib/paymentGateway.js';
import { createEmailSender } from './lib/mailer.js';
import { createOtpSender } from './lib/otpSender.js';
import { createLimiters } from './lib/rateLimit.js';
import { createRedisRateLimitStore } from './lib/redis.js';
import { createAddressesRouter } from './modules/addresses/addresses.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createCartRouter } from './modules/cart/cart.js';
import { createCheckoutRouter, createWebhookRouter } from './modules/checkout/checkout.routes.js';
import {
  createAdminOrdersRouter,
  createBuyerOrdersRouter,
  createSellerOrdersRouter,
} from './modules/orders/order.routes.js';
import {
  createBrowseRouter,
  createHomeRouter,
  createMyDiscoveryRouter,
  createSearchRouter,
} from './modules/discovery/discovery.routes.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import {
  createPlacesRouter,
  createSavedLocationsRouter,
} from './modules/locations/locations.routes.js';
import { createPlaceLookup } from './modules/locations/places.service.js';
import {
  createListingsRouter,
  createMyListingsRouter,
  createSellerListingsRouter,
} from './modules/listings/listings.routes.js';
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
  imageStorage = createImageStorage(),
  placeLookup = createPlaceLookup({ logger }),
  paymentGateway = createPaymentGateway(),
  rateLimiting = { enabled: env.NODE_ENV !== 'test', makeStore: createRedisRateLimitStore },
  configureRoutes,
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  // Behind the hosting platform's proxy in production; needed for the client IP.
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  // The raw body is kept for checking webhook signatures, which cover the exact bytes.
  app.use(
    express.json({
      limit: '100kb',
      verify: (req, _res, buffer) => {
        req.rawBody = buffer.toString('utf8');
      },
    }),
  );
  app.use(cookieParser());

  // Development without an image host keeps uploads on disk and serves them here.
  if (imageStorage.localDirectory) {
    app.use(LOCAL_UPLOADS_ROUTE, express.static(imageStorage.localDirectory, { index: false }));
  }

  const requireAuth = createRequireAuth({ db, clock });
  const deps = {
    db,
    clock,
    logger,
    emailSender,
    otpSender,
    imageStorage,
    placeLookup,
    paymentGateway,
    limiters: createLimiters(rateLimiting),
    requireAuth,
    optionalAuth: createOptionalAuth(requireAuth),
  };

  // Scheduled jobs and tests reach the same dependencies the routes use.
  app.locals.deps = deps;

  const api = express.Router();
  api.use('/health', createHealthRouter(deps));
  api.use('/auth', createAuthRouter(deps));
  api.use('/home', createHomeRouter(deps));
  api.use('/search', createSearchRouter(deps));
  api.use('/listings', createBrowseRouter(deps));
  api.use('/listings', createListingsRouter(deps));
  api.use('/me/listings', createMyListingsRouter(deps));
  api.use('/me/locations', createSavedLocationsRouter(deps));
  api.use('/places', createPlacesRouter(deps));
  api.use('/cart', createCartRouter(deps));
  api.use('/me/addresses', createAddressesRouter(deps));
  api.use('/checkouts', createCheckoutRouter(deps));
  api.use('/payments', createWebhookRouter(deps));
  api.use('/me/orders', createBuyerOrdersRouter(deps));
  api.use('/me/sales', createSellerOrdersRouter(deps));
  api.use('/admin/orders', createAdminOrdersRouter(deps));
  api.use('/me', createMeRouter(deps));
  api.use('/me', createMyDiscoveryRouter(deps));
  api.use('/users', createSellerListingsRouter(deps));
  api.use('/users', createUsersRouter(deps));
  configureRoutes?.(api);
  app.use(API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger, exposeStack: env.NODE_ENV === 'development' }));

  return app;
}
