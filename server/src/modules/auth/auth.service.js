import { AppError } from '../../lib/errors.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../lib/password.js';
import { toPrivateUser } from '../users/users.service.js';
import { deliverOtp, issueOtp, redeemOtp } from './otp.service.js';
import { createSession, revokeAllSessions } from './session.service.js';

const VERIFIED_FIELD = { EMAIL: 'emailVerifiedAt', PHONE: 'phoneVerifiedAt' };

function invalidCredentials() {
  return AppError.unauthorized('Incorrect email or password');
}

function isUniqueViolation(error) {
  return error?.code === 'P2002';
}

/** Issues a code and sends it. A failed delivery is logged, not surfaced: the user can resend. */
async function sendOtp(deps, { user, channel, purpose }) {
  const code = await issueOtp(deps, { userId: user.id, channel, purpose });
  try {
    await deliverOtp(deps, { user, channel, purpose, code });
  } catch (error) {
    deps.logger.error(error);
  }
}

export async function register(deps, { email, phone, password, displayName }, client) {
  const { db, clock } = deps;

  const existing = await db.user.findFirst({
    where: { OR: [{ email }, { phone }] },
    select: { email: true },
  });
  if (existing) throw duplicateAccount(existing.email === email);

  const passwordHash = await hashPassword(password);

  let user;
  let session;
  try {
    ({ user, session } = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          phone,
          passwordHash,
          createdAt: clock.now(),
          profile: { create: { displayName } },
        },
        include: { profile: true },
      });
      return {
        user: created,
        session: await createSession(tx, clock, { userId: created.id, ...client }),
      };
    }));
  } catch (error) {
    // Two registrations raced past the check above; the unique indexes decided.
    if (isUniqueViolation(error)) {
      throw duplicateAccount(error.meta?.target?.includes('email') ?? true);
    }
    throw error;
  }

  await sendOtp(deps, { user, channel: 'EMAIL', purpose: 'VERIFY' });
  await sendOtp(deps, { user, channel: 'PHONE', purpose: 'VERIFY' });

  return { user: toPrivateUser(user), session };
}

function duplicateAccount(emailTaken) {
  return emailTaken
    ? new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists')
    : new AppError(409, 'PHONE_TAKEN', 'An account with this phone number already exists');
}

/**
 * Finds the account for an email and password. Unknown email and wrong password
 * are indistinguishable to the caller, in both response and timing.
 */
export async function authenticate({ db }, { email, password }) {
  const user = await db.user.findUnique({ where: { email }, include: { profile: true } });

  if (!user || user.status === 'DELETED') {
    await burnPasswordCheck(password);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(password, user.passwordHash))) throw invalidCredentials();

  return user;
}

export async function login(deps, credentials, client) {
  const { db, clock } = deps;
  const user = await authenticate(deps, credentials);

  if (user.status === 'PENDING_DELETION') {
    throw new AppError(
      403,
      'ACCOUNT_PENDING_DELETION',
      'This account is scheduled for deletion. Recover it to sign in again.',
      { recoverableUntil: user.deletionScheduledFor.toISOString() },
    );
  }

  if (user.status === 'SUSPENDED') {
    throw new AppError(
      403,
      'ACCOUNT_SUSPENDED',
      'This account is suspended. Contact support if you think this is a mistake.',
    );
  }

  const session = await createSession(db, clock, { userId: user.id, ...client });
  return { user: toPrivateUser(user), session };
}

export async function sendVerificationOtp(deps, { userId, channel }) {
  const user = await deps.db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user[VERIFIED_FIELD[channel]]) throw alreadyVerified(channel);

  await sendOtp(deps, { user, channel, purpose: 'VERIFY' });
}

export async function verifyContact(deps, { userId, channel, code }) {
  const { db, clock } = deps;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user[VERIFIED_FIELD[channel]]) throw alreadyVerified(channel);

  await redeemOtp(deps, { userId, channel, purpose: 'VERIFY', code });

  const updated = await db.user.update({
    where: { id: userId },
    data: { [VERIFIED_FIELD[channel]]: clock.now() },
    include: { profile: true },
  });
  return toPrivateUser(updated);
}

function alreadyVerified(channel) {
  const label = channel === 'EMAIL' ? 'Email' : 'Phone number';
  return new AppError(409, 'ALREADY_VERIFIED', `${label} is already verified`);
}

/**
 * Starts a password reset. Never reveals whether the email belongs to an account:
 * the caller always answers the same way, and throttling errors are swallowed.
 */
export async function requestPasswordReset(deps, { email }) {
  const user = await deps.db.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE') return;

  try {
    await sendOtp(deps, { user, channel: 'EMAIL', purpose: 'PASSWORD_RESET' });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
  }
}

export async function resetPassword(deps, { email, code, password }) {
  const { db, clock } = deps;
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE') {
    throw new AppError(400, 'OTP_INVALID', 'That code is not valid. Request a new one.');
  }

  await redeemOtp(deps, { userId: user.id, channel: 'EMAIL', purpose: 'PASSWORD_RESET', code });

  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      // Receiving the code proves control of the mailbox.
      data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? clock.now() },
    });
    await revokeAllSessions(tx, clock, user.id, 'PASSWORD_RESET');
  });
}
