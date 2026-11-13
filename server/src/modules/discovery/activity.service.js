import { POPULARITY_LIKE_WEIGHT } from '../../config/policy.js';
import { businessDate } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';

// Views and likes: what people do with listings. Both feed the popularity score on
// the listing row, so "most popular" can be sorted without counting rows each time.
// Each change is one SQL statement: the activity row and the counters move together.

/** The ids, out of `listingIds`, that the user has liked. Empty for a visitor. */
export async function likedListingIds(db, userId, listingIds) {
  if (!userId || listingIds.length === 0) return new Set();
  const likes = await db.listingLike.findMany({
    where: { userId, listingId: { in: listingIds } },
    select: { listingId: true },
  });
  return new Set(likes.map((like) => like.listingId));
}

/**
 * Counts a view: at most one per user, listing and calendar day (DECISIONS I15).
 * Callers decide who counts; the owner's own visits and signed-out visitors do not.
 */
export async function recordView({ db, clock }, { userId, listingId }) {
  const day = businessDate(clock.now());
  await db.$executeRaw`
    WITH new_view AS (
      INSERT INTO listing_views (user_id, listing_id, viewed_on)
      VALUES (${userId}::uuid, ${listingId}::uuid, ${day}::date)
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    UPDATE listings
    SET view_count = view_count + 1, popularity_score = popularity_score + 1
    WHERE id = ${listingId}::uuid AND EXISTS (SELECT 1 FROM new_view)`;
}

async function likeState(db, listingId, liked) {
  const { likeCount } = await db.listing.findUniqueOrThrow({
    where: { id: listingId },
    select: { likeCount: true },
  });
  return { liked, likeCount };
}

/** Likes a listing. Liking twice changes nothing. */
export async function likeListing({ db, clock }, { userId, listingId }) {
  const listing = await db.listing.findFirst({
    where: { id: listingId, deletedAt: null, status: 'ACTIVE', seller: { status: 'ACTIVE' } },
    select: { sellerId: true },
  });
  if (!listing) throw AppError.notFound('Listing not found');
  if (listing.sellerId === userId) throw AppError.forbidden('You cannot like your own listing');

  await db.$executeRaw`
    WITH new_like AS (
      INSERT INTO listing_likes (user_id, listing_id, created_at)
      VALUES (${userId}::uuid, ${listingId}::uuid, ${clock.now()})
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    UPDATE listings
    SET like_count = like_count + 1,
        popularity_score = popularity_score + ${POPULARITY_LIKE_WEIGHT}
    WHERE id = ${listingId}::uuid AND EXISTS (SELECT 1 FROM new_like)`;

  return likeState(db, listingId, true);
}

/** Removes a like. Works on any listing the user once liked, even one no longer public. */
export async function unlikeListing({ db }, { userId, listingId }) {
  const exists = await db.listing.findUnique({ where: { id: listingId }, select: { id: true } });
  if (!exists) throw AppError.notFound('Listing not found');

  await db.$executeRaw`
    WITH removed_like AS (
      DELETE FROM listing_likes
      WHERE user_id = ${userId}::uuid AND listing_id = ${listingId}::uuid
      RETURNING 1
    )
    UPDATE listings
    SET like_count = like_count - 1,
        popularity_score = popularity_score - ${POPULARITY_LIKE_WEIGHT}
    WHERE id = ${listingId}::uuid AND EXISTS (SELECT 1 FROM removed_like)`;

  return likeState(db, listingId, false);
}
