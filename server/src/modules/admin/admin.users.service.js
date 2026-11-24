import { AppError } from '../../lib/errors.js';
import { revokeAllSessions } from '../auth/session.service.js';
import { deliver } from '../notifications/notifications.service.js';
import { dayRange, writeAudit } from './admin.query.js';

// User management for the Super Admin (SPEC Module 10; DECISIONS I100, I102):
// search, inspect, warn, suspend (optionally removing every listing: a ban) and
// restore. Every action needs a reason and is written to the audit log.

export function usersWhere({ q, status, role, from, to }) {
  const where = {};
  if (status) where.status = status;
  if (role) where.role = role;
  const created = dayRange({ from, to });
  if (created) where.createdAt = created;
  if (q) {
    where.OR = [
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
      { profile: { displayName: { contains: q, mode: 'insensitive' } } },
    ];
  }
  return where;
}

export const userInclude = { profile: true, bankAccount: { select: { status: true } } };

export function toAdminUser(user) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    displayName: user.profile?.displayName ?? null,
    locality: user.profile?.locality ?? null,
    role: user.role,
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
    phoneVerified: Boolean(user.phoneVerifiedAt),
    suspendedAt: user.suspendedAt?.toISOString() ?? null,
    suspensionReason: user.suspensionReason,
    bankAccountStatus: user.bankAccount?.status ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export const userColumns = [
  ['id', (u) => u.id],
  ['email', (u) => u.email],
  ['phone', (u) => u.phone],
  ['name', (u) => u.profile?.displayName],
  ['role', (u) => u.role],
  ['status', (u) => u.status],
  ['email verified', (u) => Boolean(u.emailVerifiedAt)],
  ['phone verified', (u) => Boolean(u.phoneVerifiedAt)],
  ['bank account', (u) => u.bankAccount?.status ?? ''],
  ['joined', (u) => u.createdAt],
];

const RECENT = 10;

/** One user with everything an admin needs to judge them: activity on both sides. */
export async function userDetail({ db }, userId) {
  const user = await db.user.findUnique({ where: { id: userId }, include: userInclude });
  if (!user) throw AppError.notFound('User not found');

  const orderSelect = {
    id: true,
    ref: true,
    status: true,
    totalPaise: true,
    refundedPaise: true,
    createdAt: true,
  };
  const bookingSelect = {
    id: true,
    ref: true,
    title: true,
    status: true,
    totalPaise: true,
    createdAt: true,
  };
  const [listings, purchases, sales, rentals, rentedOut, disputes, reports, audit, counts] =
    await Promise.all([
      db.listing.groupBy({
        by: ['status'],
        where: { sellerId: userId, deletedAt: null },
        _count: true,
      }),
      db.order.findMany({
        where: { buyerId: userId },
        select: orderSelect,
        orderBy: { createdAt: 'desc' },
        take: RECENT,
      }),
      db.order.findMany({
        where: { sellerId: userId },
        select: orderSelect,
        orderBy: { createdAt: 'desc' },
        take: RECENT,
      }),
      db.rentalBooking.findMany({
        where: { renterId: userId },
        select: bookingSelect,
        orderBy: { createdAt: 'desc' },
        take: RECENT,
      }),
      db.rentalBooking.findMany({
        where: { ownerId: userId },
        select: bookingSelect,
        orderBy: { createdAt: 'desc' },
        take: RECENT,
      }),
      db.dispute.findMany({
        where: { OR: [{ claimantId: userId }, { respondentId: userId }] },
        select: { id: true, kind: true, status: true, createdAt: true, claimantId: true },
        orderBy: { createdAt: 'desc' },
        take: RECENT,
      }),
      db.report.findMany({
        where: { targetType: 'USER', targetId: userId },
        select: { id: true, reason: true, status: true, details: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: RECENT,
      }),
      db.adminAuditLog.findMany({
        where: { targetType: 'user', targetId: userId },
        include: { admin: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
        take: RECENT,
      }),
      Promise.all([
        db.order.count({ where: { buyerId: userId } }),
        db.order.count({ where: { sellerId: userId } }),
        db.rentalBooking.count({ where: { renterId: userId } }),
        db.rentalBooking.count({ where: { ownerId: userId } }),
      ]),
    ]);

  const iso = (row) => ({ ...row, createdAt: row.createdAt.toISOString() });
  return {
    user: toAdminUser(user),
    listings: Object.fromEntries(listings.map((row) => [row.status, row._count])),
    counts: {
      purchases: counts[0],
      sales: counts[1],
      rentals: counts[2],
      rentedOut: counts[3],
    },
    purchases: purchases.map(iso),
    sales: sales.map(iso),
    rentals: rentals.map(iso),
    rentedOut: rentedOut.map(iso),
    disputes: disputes.map((d) => ({
      id: d.id,
      kind: d.kind,
      status: d.status,
      side: d.claimantId === userId ? 'claimant' : 'respondent',
      createdAt: d.createdAt.toISOString(),
    })),
    reports: reports.map(iso),
    audit: audit.map((row) => ({
      id: row.id,
      action: row.action,
      reason: row.reason,
      admin: row.admin.email,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

async function loadTarget(db, adminId, userId) {
  const user = await db.user.findUnique({ where: { id: userId }, include: userInclude });
  if (!user) throw AppError.notFound('User not found');
  if (user.id === adminId) throw AppError.forbidden('You cannot do this to your own account');
  if (user.role === 'ADMIN') throw AppError.forbidden('Admin accounts cannot be changed here');
  return user;
}

const notifyAccount = (deps, user, { key, type, title, body }) =>
  deliver(deps, {
    userId: user.id,
    key,
    category: 'ACCOUNT',
    type,
    title,
    body,
    link: '/profile',
  });

/**
 * Suspends an account (I102): it cannot sign in, its sessions end and its listings
 * leave every public list. With `removeListings` (a ban) its live listings are also
 * removed. Open orders and rentals are not changed: the admin handles each one.
 */
export async function suspendUser(deps, adminId, userId, { reason, removeListings = false }) {
  const { db, clock } = deps;
  const user = await loadTarget(db, adminId, userId);
  if (user.status !== 'ACTIVE') {
    throw new AppError(409, 'USER_NOT_ACTIVE', 'Only an active account can be suspended');
  }
  const now = clock.now();
  const removed = await db.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: user.id, status: 'ACTIVE' },
      data: { status: 'SUSPENDED', suspendedAt: now, suspensionReason: reason },
    });
    if (count !== 1) {
      throw new AppError(409, 'USER_NOT_ACTIVE', 'Only an active account can be suspended');
    }
    await revokeAllSessions(tx, clock, user.id, 'SUSPENDED');
    let listingIds = [];
    if (removeListings) {
      const live = await tx.listing.findMany({
        where: { sellerId: user.id, deletedAt: null, status: { not: 'REMOVED' } },
        select: { id: true, status: true },
      });
      listingIds = live.map((l) => l.id);
      await tx.listing.updateMany({
        where: { id: { in: listingIds } },
        data: { status: 'REMOVED' },
      });
      await tx.listingStatusEvent.createMany({
        data: live.map((l) => ({
          listingId: l.id,
          actorUserId: adminId,
          action: 'REMOVED',
          fromStatus: l.status,
          toStatus: 'REMOVED',
          reason,
          createdAt: now,
        })),
      });
    }
    await writeAudit(tx, now, {
      adminId,
      action: removeListings ? 'BAN_USER' : 'SUSPEND_USER',
      targetType: 'user',
      targetId: user.id,
      reason,
      details: removeListings ? { removedListings: listingIds } : undefined,
    });
    return listingIds.length;
  });
  await notifyAccount(deps, user, {
    key: `user:${user.id}:suspended:${now.getTime()}`,
    type: 'accountSuspended',
    title: 'Your account is suspended',
    body: `An admin suspended your account. Reason: ${reason}`,
  });
  return { ...(await userDetail(deps, user.id)), removedListings: removed };
}

/** Restores a suspended account. Removed listings stay removed until restored one by one. */
export async function restoreUser(deps, adminId, userId, { reason }) {
  const { db, clock } = deps;
  const user = await loadTarget(db, adminId, userId);
  const now = clock.now();
  await db.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: user.id, status: 'SUSPENDED' },
      data: { status: 'ACTIVE', suspendedAt: null, suspensionReason: null },
    });
    if (count !== 1) {
      throw new AppError(409, 'USER_NOT_SUSPENDED', 'This account is not suspended');
    }
    await writeAudit(tx, now, {
      adminId,
      action: 'RESTORE_USER',
      targetType: 'user',
      targetId: user.id,
      reason,
    });
  });
  await notifyAccount(deps, user, {
    key: `user:${user.id}:restored:${now.getTime()}`,
    type: 'accountRestored',
    title: 'Your account is active again',
    body: `An admin restored your account. ${reason}`,
  });
  return userDetail(deps, user.id);
}

/** Sends a written warning (I90, I102): a notification and an email, and an audit row. */
export async function warnUser(deps, adminId, userId, { reason }) {
  const { db, clock } = deps;
  const user = await loadTarget(db, adminId, userId);
  if (user.status === 'DELETED') throw new AppError(409, 'USER_DELETED', 'This account is erased');
  const now = clock.now();
  const audit = await writeAudit(db, now, {
    adminId,
    action: 'WARN_USER',
    targetType: 'user',
    targetId: user.id,
    reason,
  });
  await notifyAccount(deps, user, {
    key: `user:${user.id}:warning:${audit.id}`,
    type: 'accountWarning',
    title: 'A warning about your account',
    body: `${reason} Repeated problems can lead to your account being suspended.`,
  });
  return userDetail(deps, user.id);
}
