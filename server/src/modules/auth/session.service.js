import crypto from 'node:crypto';
import { API_PREFIX } from '../../config/app.js';
import { env } from '../../config/env.js';
import { REFRESH_REUSE_GRACE_SECONDS, REFRESH_TOKEN_TTL_DAYS } from '../../config/policy.js';
import { REFRESH_COOKIE_NAME } from '../../config/security.js';
import { signAccessToken } from '../../lib/auth.js';
import { addDays, addSeconds, businessDate } from '../../lib/clock.js';
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

/**
 * Notes that the person was active today (business time zone), once per day: the
 * source of the active-user counts (I101). `client` may be a transaction client.
 */
export async function recordActivity(client, now, userId) {
  const day = businessDate(now);
  await client.$executeRaw`
    INSERT INTO user_activity_days (user_id, day) VALUES (${userId}::uuid, ${day}::date)
    ON CONFLICT DO NOTHING`;
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
  await recordActivity(client, now, userId);

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
    // The token was already exchanged. Two tabs of one browser refreshing at the
    // same moment look like this too, so a replay right after the rotation is only
    // refused; any later replay means the token leaked and ends the session.
    await db.userSession.updateMany({
      where: {
        previousRefreshTokenHash: presentedHash,
        revokedAt: null,
        lastRotatedAt: { lte: addSeconds(now, -REFRESH_REUSE_GRACE_SECONDS) },
      },
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
  await recordActivity(db, now, session.userId);

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
