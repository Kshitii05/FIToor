import crypto from 'node:crypto';
import { ACCOUNT_RECOVERY_DAYS } from '../../config/policy.js';
import { addDays } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { accountRecoveredEmail, deletionScheduledEmail } from '../auth/auth.emails.js';
import { authenticate } from '../auth/auth.service.js';
import { createSession, revokeAllSessions } from '../auth/session.service.js';
import { toPrivateUser } from './users.service.js';

// Account deletion (SPEC 15, DECISIONS I16): the request deactivates the account
// and starts a recovery period; when it ends, personal data is erased.
//
// Deletion is refused while the user has active orders, rentals, disputes or unpaid
// payouts. Those modules register a check here when they are built; each check
// returns a short reason when it blocks deletion, or null.
const deletionBlockers = [];

export function registerDeletionBlocker(check) {
  deletionBlockers.push(check);
  return () => {
    const index = deletionBlockers.indexOf(check);
    if (index !== -1) deletionBlockers.splice(index, 1);
  };
}

async function sendEmail({ emailSender, logger }, message) {
  try {
    await emailSender.send(message);
  } catch (error) {
    logger.error(error);
  }
}

export async function requestDeletion(deps, { userId, password }) {
  const { db, clock } = deps;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });

  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new AppError(403, 'INVALID_PASSWORD', 'Incorrect password');
  }

  const reasons = [];
  for (const check of deletionBlockers) {
    const reason = await check({ db, userId });
    if (reason) reasons.push(reason);
  }
  if (reasons.length > 0) {
    throw new AppError(
      409,
      'DELETION_BLOCKED',
      'This account cannot be deleted while it has unfinished activity',
      { reasons },
    );
  }

  const now = clock.now();
  const scheduledFor = addDays(now, ACCOUNT_RECOVERY_DAYS);

  await db.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: userId, status: 'ACTIVE' },
      data: {
        status: 'PENDING_DELETION',
        deletionRequestedAt: now,
        deletionScheduledFor: scheduledFor,
      },
    });
    if (count !== 1) throw AppError.conflict('Account is not active');
    await revokeAllSessions(tx, clock, userId, 'ACCOUNT_DELETION');
  });

  await sendEmail(deps, { to: user.email, ...deletionScheduledEmail(scheduledFor) });

  return { recoverableUntil: scheduledFor.toISOString() };
}

/** Cancels a pending deletion and signs the user in. Needs the email and password. */
export async function recoverAccount(deps, credentials, client) {
  const { db, clock } = deps;
  const user = await authenticate(deps, credentials);

  if (user.status !== 'PENDING_DELETION') {
    throw new AppError(
      409,
      'ACCOUNT_NOT_PENDING_DELETION',
      'This account is not scheduled for deletion',
    );
  }

  const now = clock.now();
  const recovered = await db.$transaction(async (tx) => {
    // Conditional on the deadline, so a recovery cannot slip in after the period ends.
    const { count } = await tx.user.updateMany({
      where: { id: user.id, status: 'PENDING_DELETION', deletionScheduledFor: { gt: now } },
      data: { status: 'ACTIVE', deletionRequestedAt: null, deletionScheduledFor: null },
    });
    if (count !== 1) return null;
    return createSession(tx, clock, { userId: user.id, ...client });
  });

  if (!recovered) {
    throw new AppError(
      403,
      'ACCOUNT_RECOVERY_EXPIRED',
      'The recovery period for this account has ended',
    );
  }

  await sendEmail(deps, { to: user.email, ...accountRecoveredEmail() });

  return { user: toPrivateUser(user), session: recovered };
}

/**
 * Erases accounts whose recovery period has ended. Run on a schedule.
 * The user row is kept, stripped of personal data, so records that must be
 * retained (orders, payments, disputes) still have something to refer to.
 */
export async function purgeExpiredDeletions({ db, clock }) {
  const now = clock.now();
  const due = await db.user.findMany({
    where: { status: 'PENDING_DELETION', deletionScheduledFor: { lte: now } },
    select: { id: true },
  });

  let purged = 0;
  for (const { id } of due) {
    // A password hash nobody knows the password for.
    const passwordHash = await hashPassword(crypto.randomBytes(32).toString('base64url'));

    await db.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id, status: 'PENDING_DELETION', deletionScheduledFor: { lte: now } },
        data: {
          status: 'DELETED',
          deletedAt: now,
          deletionScheduledFor: null,
          email: `deleted-${id}@deleted.invalid`,
          phone: null,
          passwordHash,
          emailVerifiedAt: null,
          phoneVerifiedAt: null,
        },
      });
      if (count !== 1) return; // recovered in the meantime

      await tx.userProfile.update({
        where: { userId: id },
        data: { displayName: 'Deleted user', bio: null, photoUrl: null, locality: null },
      });
      await tx.userPreferences.deleteMany({ where: { userId: id } });
      await tx.userVerification.deleteMany({ where: { userId: id } });
      await tx.userSession.deleteMany({ where: { userId: id } });
      // Their listings leave the marketplace; the rows stay for past transactions.
      await tx.listing.updateMany({
        where: { sellerId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      purged += 1;
    });
  }

  return purged;
}
