import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import {
  OTP_EXPIRY_MINUTES,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_RESENDS_PER_HOUR,
  OTP_RESEND_COOLDOWN_SECONDS,
} from '../../config/policy.js';
import { addHours, addMinutes } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { passwordResetEmail, verificationEmail } from './auth.emails.js';

// One-time codes (DECISIONS I2). Codes are stored only as keyed hashes.

function generateCode() {
  return String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

function hashCode({ userId, channel, purpose, code }) {
  return crypto
    .createHmac('sha256', env.OTP_SECRET)
    .update(`${userId}:${channel}:${purpose}:${code}`)
    .digest('hex');
}

function sameHash(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Creates a new code for the user, replacing any earlier one, and returns it.
 * Enforces the resend rules: a wait between sends, and one initial send plus
 * OTP_MAX_RESENDS_PER_HOUR resends in any rolling hour.
 */
export async function issueOtp({ db, clock }, { userId, channel, purpose }) {
  const now = clock.now();
  const scope = { userId, channel, purpose };

  const recent = await db.userVerification.findMany({
    where: { ...scope, createdAt: { gt: addHours(now, -1) } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  if (recent.length > 0) {
    const nextAllowedAt = addMinutes(recent[0].createdAt, OTP_RESEND_COOLDOWN_SECONDS / 60);
    if (nextAllowedAt > now) {
      const retryAfterSeconds = Math.ceil((nextAllowedAt.getTime() - now.getTime()) / 1000);
      throw new AppError(429, 'OTP_RESEND_TOO_SOON', 'Please wait before requesting another code', {
        retryAfterSeconds,
      });
    }
  }

  if (recent.length >= 1 + OTP_MAX_RESENDS_PER_HOUR) {
    throw new AppError(429, 'OTP_RESEND_LIMIT', 'Too many codes requested. Try again in a while.');
  }

  const code = generateCode();
  await db.userVerification.create({
    data: {
      ...scope,
      codeHash: hashCode({ ...scope, code }),
      expiresAt: addMinutes(now, OTP_EXPIRY_MINUTES),
      createdAt: now,
    },
  });

  return code;
}

/**
 * Checks a code against the newest one issued for the user, channel and purpose.
 * Every check counts as an attempt; a code is used up by its first success.
 */
export async function redeemOtp({ db, clock }, { userId, channel, purpose, code }) {
  const now = clock.now();
  const scope = { userId, channel, purpose };

  const latest = await db.userVerification.findFirst({
    where: scope,
    orderBy: { createdAt: 'desc' },
  });

  if (!latest || latest.consumedAt) {
    throw new AppError(400, 'OTP_INVALID', 'That code is not valid. Request a new one.');
  }
  if (latest.expiresAt <= now) {
    throw new AppError(400, 'OTP_EXPIRED', 'That code has expired. Request a new one.');
  }

  // Counting the attempt is a conditional update, so parallel guesses cannot exceed the limit.
  const counted = await db.userVerification.updateMany({
    where: { id: latest.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count !== 1) {
    throw new AppError(
      429,
      'OTP_ATTEMPTS_EXCEEDED',
      'Too many incorrect attempts. Request a new code.',
    );
  }

  if (!sameHash(latest.codeHash, hashCode({ ...scope, code }))) {
    throw new AppError(400, 'OTP_INVALID', 'That code is not valid.', {
      attemptsRemaining: OTP_MAX_ATTEMPTS - (latest.attempts + 1),
    });
  }

  const consumed = await db.userVerification.updateMany({
    where: { id: latest.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) {
    throw new AppError(400, 'OTP_INVALID', 'That code is not valid. Request a new one.');
  }
}

/** Sends a code over its channel: email through EmailSender, phone through OtpSender. */
export async function deliverOtp({ emailSender, otpSender }, { user, channel, purpose, code }) {
  if (channel === 'PHONE') {
    await otpSender.send({ phone: user.phone, code });
    return;
  }
  const message = purpose === 'PASSWORD_RESET' ? passwordResetEmail(code) : verificationEmail(code);
  await emailSender.send({ to: user.email, ...message });
}
