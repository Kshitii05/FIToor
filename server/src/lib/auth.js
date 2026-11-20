import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ACCESS_TOKEN_TTL_MINUTES } from '../config/policy.js';
import { AppError } from './errors.js';

const ALGORITHM = 'HS256';

function epochSeconds(clock) {
  return Math.floor(clock.now().getTime() / 1000);
}

/** Short-lived access token. Issue and expiry times come from the injected clock. */
export function signAccessToken({ userId, sessionId }, clock) {
  const issuedAt = epochSeconds(clock);
  return jwt.sign(
    {
      sub: userId,
      sid: sessionId,
      iat: issuedAt,
      exp: issuedAt + ACCESS_TOKEN_TTL_MINUTES * 60,
    },
    env.JWT_SECRET,
    { algorithm: ALGORITHM },
  );
}

function readAccessToken(token, clock) {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: [ALGORITHM],
      clockTimestamp: epochSeconds(clock),
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}

/**
 * Checks an access token and its session: the session must still be live and the
 * account active, so logout, password reset and account deletion take effect
 * immediately. Returns `{ userId, sessionId, role, verified }` or null. Used by the
 * API and by live chat connections.
 */
export async function authenticateToken({ db, clock }, token) {
  const claims = typeof token === 'string' && token ? readAccessToken(token, clock) : null;
  if (!claims) return null;
  const session = await db.userSession.findUnique({
    where: { id: claims.sessionId },
    select: {
      userId: true,
      revokedAt: true,
      expiresAt: true,
      user: {
        select: { status: true, role: true, emailVerifiedAt: true, phoneVerifiedAt: true },
      },
    },
  });
  const live =
    session &&
    session.userId === claims.userId &&
    !session.revokedAt &&
    session.expiresAt > clock.now() &&
    session.user.status === 'ACTIVE';
  if (!live) return null;
  return {
    ...claims,
    role: session.user.role,
    verified: session.user.emailVerifiedAt !== null && session.user.phoneVerifiedAt !== null,
  };
}

/** Requires a valid access token (see authenticateToken). Sets `req.auth`. */
export function createRequireAuth({ db, clock }) {
  return async function requireAuth(req, _res, next) {
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw AppError.unauthorized();
    const auth = await authenticateToken({ db, clock }, token);
    if (!auth) throw AppError.unauthorized('Session expired or invalid');
    req.auth = auth;
    next();
  };
}

/**
 * For public routes that show more to a signed-in user. No Authorization header
 * means an anonymous visitor; a header that is present must be valid.
 */
export function createOptionalAuth(requireAuth) {
  return function optionalAuth(req, res, next) {
    if (!req.get('authorization')) return next();
    return requireAuth(req, res, next);
  };
}

/**
 * Use after requireAuth. Listing, buying and renting need both the email and the
 * phone number verified (DECISIONS I18).
 */
export function requireVerified(req, _res, next) {
  if (!req.auth?.verified) {
    throw new AppError(
      403,
      'VERIFICATION_REQUIRED',
      'Verify your email and phone number to do this',
    );
  }
  next();
}

/**
 * For endpoints that act on the refresh cookie. Browsers send an Origin header on
 * cross-site requests, so a request from any other site is refused.
 */
export function requireTrustedOrigin(req, _res, next) {
  const origin = req.get('origin');
  if (origin && origin !== env.CLIENT_ORIGIN) {
    throw AppError.forbidden('Request origin not allowed');
  }
  next();
}

/**
 * Use after requireAuth. Admin routes check the role on the server for every
 * request (SPEC Module 10); hiding admin screens is never enough.
 */
export function requireAdmin(req, _res, next) {
  if (req.auth?.role !== 'ADMIN') throw AppError.forbidden('Admins only');
  next();
}
