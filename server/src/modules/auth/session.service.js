import crypto from 'node:crypto';
import { API_PREFIX } from '../../config/app.js';
import { env } from '../../config/env.js';
import { REFRESH_TOKEN_TTL_DAYS } from '../../config/policy.js';
import { REFRESH_COOKIE_NAME } from '../../config/security.js';
import { signAccessToken } from '../../lib/auth.js';
import { addDays } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';

// Refresh tokens are random, so a plain SHA-256 is enough to keep them out of the database.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function invalidSession() {
  return AppError.unauthorized('Session expired or invalid');
}

/** Starts a session. `client` may be a transaction client. */
export async function createSession(client, clock, { userId, userAgent, ipAddress }) {
  const now = clock.now();
  const refreshToken = newRefreshToken();
  const session = await client.userSession.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: addDays(now, REFRESH_TOKEN_TTL_DAYS),
      createdAt: now,
      userAgent: userAgent?.slice(0, 255) ?? null,
      ipAddress: ipAddress ?? null,
    },
  });

  return {
    accessToken: signAccessToken({ userId, sessionId: session.id }, clock),
    refreshToken,
    refreshExpiresAt: session.expiresAt,
  };
}

/**
 * Exchanges a refresh token for a new one. Each token works once: presenting the
 * token that was already exchanged means it leaked, so the session is revoked.
 */
export async function rotateSession(db, clock, refreshToken) {
  const now = clock.now();
  const presentedHash = hashToken(refreshToken);

  const session = await db.userSession.findUnique({
    where: { refreshTokenHash: presentedHash },
    include: { user: { select: { status: true } } },
  });

  if (!session) {
    await db.userSession.updateMany({
      where: { previousRefreshTokenHash: presentedHash, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'REFRESH_TOKEN_REUSED' },
    });
    throw invalidSession();
  }

  if (session.revokedAt || session.expiresAt <= now || session.user.status !== 'ACTIVE') {
    throw invalidSession();
  }

  const nextToken = newRefreshToken();
  const expiresAt = addDays(now, REFRESH_TOKEN_TTL_DAYS);

  // Conditional update: of two simultaneous refreshes with the same token, one wins.
  const { count } = await db.userSession.updateMany({
    where: { id: session.id, refreshTokenHash: presentedHash, revokedAt: null },
    data: {
      refreshTokenHash: hashToken(nextToken),
      previousRefreshTokenHash: presentedHash,
      expiresAt,
      lastRotatedAt: now,
    },
  });
  if (count !== 1) throw invalidSession();

  return {
    accessToken: signAccessToken({ userId: session.userId, sessionId: session.id }, clock),
    refreshToken: nextToken,
    refreshExpiresAt: expiresAt,
  };
}

export async function revokeSessionByRefreshToken(db, clock, refreshToken) {
  await db.userSession.updateMany({
    where: { refreshTokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: clock.now(), revokedReason: 'LOGOUT' },
  });
}

/** `client` may be a transaction client. */
export async function revokeAllSessions(client, clock, userId, reason) {
  await client.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: clock.now(), revokedReason: reason },
  });
}

// The cookie is scoped to the auth routes: the only endpoints that read it.
function cookieOptions() {
  const production = env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: production,
    // In production the client and the API are on different sites.
    sameSite: production ? 'none' : 'lax',
    path: `${API_PREFIX}/auth`,
  };
}

export function setRefreshCookie(res, { refreshToken, refreshExpiresAt }) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, { ...cookieOptions(), expires: refreshExpiresAt });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions());
}

export function readRefreshCookie(req) {
  const value = req.cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
