import { z } from 'zod';
import {
  BANK_ACCOUNT_NUMBER_MAX_LENGTH,
  BANK_ACCOUNT_NUMBER_MIN_LENGTH,
  BANK_HOLDER_NAME_MAX_LENGTH,
} from '../../config/policy.js';
import { AppError } from '../../lib/errors.js';
import { createSecretBox } from '../../lib/secretBox.js';
import { deliver } from '../notifications/notifications.service.js';
import { writeAudit } from '../admin/admin.query.js';

// Seller bank details (SPEC 12, DECISIONS I14, I105): the account number is kept
// encrypted and shown only as its last 4 digits. An admin checks every new or
// changed account before any payout uses it.

const box = createSecretBox();

export const bankAccountInput = z.strictObject({
  holderName: z
    .string('Enter the account holder name')
    .trim()
    .min(2, 'Enter the account holder name')
    .max(BANK_HOLDER_NAME_MAX_LENGTH),
  accountNumber: z
    .string('Enter the account number')
    .trim()
    .regex(
      new RegExp(`^\\d{${BANK_ACCOUNT_NUMBER_MIN_LENGTH},${BANK_ACCOUNT_NUMBER_MAX_LENGTH}}$`),
      `Account numbers have ${BANK_ACCOUNT_NUMBER_MIN_LENGTH} to ${BANK_ACCOUNT_NUMBER_MAX_LENGTH} digits`,
    ),
  ifsc: z
    .string('Enter the IFSC')
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'An IFSC looks like HDFC0001234'),
});

export const masked = (last4) => `XXXXXX${last4}`;

/** What the seller sees of their own account. */
export function toOwnBankAccount(account) {
  if (!account) return null;
  return {
    holderName: account.holderName,
    accountNumber: masked(account.accountLast4),
    ifsc: account.ifsc,
    status: account.status,
    note: account.note,
    submittedAt: account.submittedAt.toISOString(),
    verifiedAt: account.verifiedAt?.toISOString() ?? null,
  };
}

/** What an admin sees while checking an account: still masked (I105). */
export function toAdminBankAccount(account) {
  return {
    id: account.id,
    ...toOwnBankAccount(account),
    user: {
      id: account.user.id,
      email: account.user.email,
      displayName: account.user.profile?.displayName ?? null,
      status: account.user.status,
    },
  };
}

export const bankAccountInclude = {
  user: {
    select: { id: true, email: true, status: true, profile: { select: { displayName: true } } },
  },
};

/** The full account number, for the bank file only. */
export const accountNumberOf = (account) => box.open(account.accountNumberEncrypted);

export async function getOwnBankAccount({ db }, userId) {
  return toOwnBankAccount(await db.sellerBankAccount.findUnique({ where: { userId } }));
}

/** Saves new or changed details. Any change needs a new check before payouts use it. */
export async function saveOwnBankAccount({ db, clock }, userId, input) {
  const now = clock.now();
  const data = {
    holderName: input.holderName,
    accountNumberEncrypted: box.seal(input.accountNumber),
    accountLast4: input.accountNumber.slice(-4),
    ifsc: input.ifsc,
    status: 'PENDING',
    note: null,
    submittedAt: now,
    verifiedAt: null,
    verifiedById: null,
  };
  const account = await db.sellerBankAccount.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return toOwnBankAccount(account);
}

/**
 * Marks an account as needing a new check, inside `tx`: used when a payout to it
 * failed (SPEC 12: verify bank details before a retry).
 */
export async function requireNewCheck(tx, userId, note) {
  await tx.sellerBankAccount.updateMany({
    where: { userId },
    data: { status: 'PENDING', note, verifiedAt: null, verifiedById: null },
  });
}

async function decide(deps, adminId, id, { reason, verified }) {
  const { db, clock } = deps;
  const account = await db.sellerBankAccount.findUnique({
    where: { id },
    include: bankAccountInclude,
  });
  if (!account) throw AppError.notFound('Bank account not found');
  if (account.status !== 'PENDING') {
    throw new AppError(409, 'BANK_ACCOUNT_CHECKED', 'This bank account was already checked');
  }
  const now = clock.now();
  await db.$transaction(async (tx) => {
    // Only the details the admin looked at: a change since then needs its own check.
    const { count } = await tx.sellerBankAccount.updateMany({
      where: { id, status: 'PENDING', submittedAt: account.submittedAt },
      data: verified
        ? { status: 'VERIFIED', note: null, verifiedAt: now, verifiedById: adminId }
        : { status: 'REJECTED', note: reason, verifiedAt: null, verifiedById: adminId },
    });
    if (count !== 1) {
      throw new AppError(
        409,
        'BANK_ACCOUNT_CHANGED',
        'These details just changed; check them again',
      );
    }
    await writeAudit(tx, now, {
      adminId,
      action: verified ? 'VERIFY_BANK_ACCOUNT' : 'REJECT_BANK_ACCOUNT',
      targetType: 'bankAccount',
      targetId: id,
      reason,
      details: { userId: account.userId, accountLast4: account.accountLast4, ifsc: account.ifsc },
    });
  });
  await deliver(deps, {
    userId: account.userId,
    key: `bank:${id}:${verified ? 'verified' : 'rejected'}:${now.getTime()}`,
    category: 'ACCOUNT',
    type: verified ? 'bankVerified' : 'bankRejected',
    title: verified ? 'Your bank details are verified' : 'Your bank details need fixing',
    body: verified
      ? `Payouts will go to the account ending ${account.accountLast4}.`
      : `We could not verify the account ending ${account.accountLast4}: ${reason} Update your bank details to get paid.`,
    link: '/dashboard',
  });
  return toAdminBankAccount(
    await db.sellerBankAccount.findUniqueOrThrow({ where: { id }, include: bankAccountInclude }),
  );
}

export const verifyBankAccount = (deps, adminId, id, { reason }) =>
  decide(deps, adminId, id, { reason, verified: true });

export const rejectBankAccount = (deps, adminId, id, { reason }) =>
  decide(deps, adminId, id, { reason, verified: false });
