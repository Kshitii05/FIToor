import { AppError } from '../../lib/errors.js';
import { rupees } from '../../lib/csv.js';
import { dayRange, writeAudit } from './admin.query.js';

// Listing moderation (SPEC Module 10): find listings, remove them and restore them,
// each with a reason, a status event and an audit row.

export function listingsWhere({ q, mode, status, category, sellerId, from, to }) {
  const where = { deletedAt: null };
  if (mode) where.mode = mode;
  if (status) where.status = status;
  if (category) where.category = category;
  if (sellerId) where.sellerId = sellerId;
  const created = dayRange({ from, to });
  if (created) where.createdAt = created;
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { brand: { contains: q, mode: 'insensitive' } },
      { seller: { email: { contains: q, mode: 'insensitive' } } },
    ];
  }
  return where;
}

export const listingInclude = {
  seller: {
    select: { id: true, email: true, status: true, profile: { select: { displayName: true } } },
  },
};

export function toAdminListing(listing) {
  return {
    id: listing.id,
    title: listing.title,
    mode: listing.mode,
    status: listing.status,
    category: listing.category,
    brand: listing.brand,
    headlinePricePaise: listing.headlinePricePaise,
    locality: listing.locality,
    seller: {
      id: listing.seller.id,
      email: listing.seller.email,
      displayName: listing.seller.profile?.displayName ?? null,
      status: listing.seller.status,
    },
    createdAt: listing.createdAt.toISOString(),
  };
}

export const listingColumns = [
  ['id', (l) => l.id],
  ['title', (l) => l.title],
  ['mode', (l) => l.mode],
  ['status', (l) => l.status],
  ['category', (l) => l.category],
  ['brand', (l) => l.brand],
  ['price (rupees)', (l) => rupees(l.headlinePricePaise)],
  ['locality', (l) => l.locality],
  ['seller email', (l) => l.seller.email],
  ['created', (l) => l.createdAt],
];

async function loadListing(db, id) {
  const listing = await db.listing.findFirst({
    where: { id, deletedAt: null },
    include: listingInclude,
  });
  if (!listing) throw AppError.notFound('Listing not found');
  return listing;
}

export async function removeListing({ db, clock }, adminId, id, { reason }) {
  const listing = await loadListing(db, id);
  if (listing.status === 'REMOVED') {
    throw new AppError(409, 'LISTING_REMOVED', 'This listing is already removed');
  }
  const now = clock.now();
  await db.$transaction(async (tx) => {
    const { count } = await tx.listing.updateMany({
      where: { id, status: listing.status },
      data: { status: 'REMOVED' },
    });
    if (count !== 1)
      throw new AppError(409, 'LISTING_CHANGED', 'This listing just changed; try again');
    await tx.listingStatusEvent.create({
      data: {
        listingId: id,
        actorUserId: adminId,
        action: 'REMOVED',
        fromStatus: listing.status,
        toStatus: 'REMOVED',
        reason,
        createdAt: now,
      },
    });
    await writeAudit(tx, now, {
      adminId,
      action: 'REMOVE_LISTING',
      targetType: 'listing',
      targetId: id,
      reason,
    });
  });
  return toAdminListing(await loadListing(db, id));
}

/**
 * Restores a removed listing to the status it had before it was removed (I103),
 * or paused when that is not known, so the seller decides when it goes live.
 */
export async function restoreListing({ db, clock }, adminId, id, { reason }) {
  const listing = await loadListing(db, id);
  if (listing.status !== 'REMOVED') {
    throw new AppError(409, 'LISTING_NOT_REMOVED', 'This listing is not removed');
  }
  const removal = await db.listingStatusEvent.findFirst({
    where: { listingId: id, toStatus: 'REMOVED' },
    orderBy: { createdAt: 'desc' },
  });
  const back =
    removal?.fromStatus && removal.fromStatus !== 'REMOVED' ? removal.fromStatus : 'PAUSED';
  const now = clock.now();
  await db.$transaction(async (tx) => {
    const { count } = await tx.listing.updateMany({
      where: { id, status: 'REMOVED' },
      data: { status: back },
    });
    if (count !== 1)
      throw new AppError(409, 'LISTING_CHANGED', 'This listing just changed; try again');
    await tx.listingStatusEvent.create({
      data: {
        listingId: id,
        actorUserId: adminId,
        action: 'RESTORED',
        fromStatus: 'REMOVED',
        toStatus: back,
        reason,
        createdAt: now,
      },
    });
    await writeAudit(tx, now, {
      adminId,
      action: 'RESTORE_LISTING',
      targetType: 'listing',
      targetId: id,
      reason,
      details: { status: back },
    });
  });
  return toAdminListing(await loadListing(db, id));
}
