import { Prisma } from '@prisma/client';
import {
  BUDGET_MAX_PAISE,
  HOME_SECTION_SIZE,
  POPULARITY_LIKE_WEIGHT,
  RECOMMENDATION_MATCH_WEIGHTS,
  RECOMMENDATION_SIGNAL_WEIGHTS,
  TRENDING_NEAR_RADIUS_KM,
  TRENDING_WINDOW_DAYS,
} from '../../config/policy.js';
import { addDays, businessDate } from '../../lib/clock.js';
import { paged, pageWindow } from '../../lib/pagination.js';
import { listingInclude, PUBLICLY_VISIBLE, toListing } from '../listings/listings.service.js';
import { describeOrigin, resolveOrigin, withDistances } from '../locations/locations.service.js';
import { AVAILABLE, listingsInOrder, VISIBLE, within } from './search.service.js';

// The home page sections (SPEC Module 6). Every section draws only from listings
// that are live, belong to active sellers, and can be bought or rented right now.

const ELIGIBLE = Prisma.sql`FROM listings l JOIN users u ON u.id = l.seller_id
  WHERE ${VISIBLE} AND ${AVAILABLE}`;

const ids = (rows) => rows.map((row) => row.id);

/**
 * Most activity (views plus weighted likes) over the recent window; within reach of
 * the origin when there is one, everywhere otherwise.
 */
function trending(db, now, origin) {
  const nearby = origin
    ? Prisma.sql`AND ${within(origin, TRENDING_NEAR_RADIUS_KM * 1000)}`
    : Prisma.empty;
  const since = addDays(now, -TRENDING_WINDOW_DAYS);
  return db.$queryRaw`
    SELECT l.id
    FROM listings l
    JOIN users u ON u.id = l.seller_id
    LEFT JOIN (
      SELECT listing_id, count(*) AS views FROM listing_views
      WHERE viewed_on >= ${businessDate(since)}::date GROUP BY listing_id
    ) v ON v.listing_id = l.id
    LEFT JOIN (
      SELECT listing_id, count(*) AS likes FROM listing_likes
      WHERE created_at >= ${since} GROUP BY listing_id
    ) k ON k.listing_id = l.id
    WHERE ${VISIBLE} AND ${AVAILABLE} ${nearby}
    ORDER BY coalesce(v.views, 0) + ${POPULARITY_LIKE_WEIGHT} * coalesce(k.likes, 0) DESC,
      l.created_at DESC, l.id
    LIMIT ${HOME_SECTION_SIZE}`;
}

function recentlyListed(db) {
  return db.$queryRaw`
    SELECT l.id ${ELIGIBLE}
    ORDER BY l.created_at DESC, l.id
    LIMIT ${HOME_SECTION_SIZE}`;
}

function budgetFriendly(db) {
  return db.$queryRaw`
    SELECT l.id ${ELIGIBLE} AND l.headline_price_paise <= ${BUDGET_MAX_PAISE}
    ORDER BY l.popularity_score DESC, l.created_at DESC, l.id
    LIMIT ${HOME_SECTION_SIZE}`;
}

function rentForAnOccasion(db) {
  return db.$queryRaw`
    SELECT l.id ${ELIGIBLE} AND l.mode = 'RENT'
    ORDER BY l.popularity_score DESC, l.created_at DESC, l.id
    LIMIT ${HOME_SECTION_SIZE}`;
}

/**
 * Rule-based recommendations. What a person viewed and liked says which
 * categories, brands and sizes they care about; each kind of activity has a
 * weight. A listing scores by how strongly its category, brand and size match,
 * each match with its own weight. Their own listings and ones they already liked
 * are left out. With no activity every score is zero and popularity decides.
 *
 * Purchases join the signals when orders exist (RECOMMENDATION_SIGNAL_WEIGHTS.purchased).
 */
function forYou(db, userId) {
  const signal = RECOMMENDATION_SIGNAL_WEIGHTS;
  const match = RECOMMENDATION_MATCH_WEIGHTS;
  return db.$queryRaw`
    WITH signals AS (
      SELECT s.category, lower(s.brand) AS brand, lower(s.size) AS size, ${signal.liked}::int AS weight
      FROM listing_likes k JOIN listings s ON s.id = k.listing_id
      WHERE k.user_id = ${userId}::uuid
      UNION ALL
      SELECT s.category, lower(s.brand), lower(s.size), ${signal.viewed}::int
      FROM listing_views v JOIN listings s ON s.id = v.listing_id
      WHERE v.user_id = ${userId}::uuid
    ),
    by_category AS (SELECT category, sum(weight) AS score FROM signals GROUP BY category),
    by_brand AS (SELECT brand, sum(weight) AS score FROM signals GROUP BY brand),
    by_size AS (SELECT size, sum(weight) AS score FROM signals GROUP BY size)
    SELECT l.id
    FROM listings l
    JOIN users u ON u.id = l.seller_id
    LEFT JOIN by_category c ON c.category = l.category
    LEFT JOIN by_brand b ON b.brand = lower(l.brand)
    LEFT JOIN by_size z ON z.size = lower(l.size)
    WHERE ${VISIBLE} AND ${AVAILABLE}
      AND l.seller_id <> ${userId}::uuid
      AND NOT EXISTS (
        SELECT 1 FROM listing_likes mine
        WHERE mine.user_id = ${userId}::uuid AND mine.listing_id = l.id
      )
    ORDER BY
      coalesce(c.score, 0) * ${match.category}
        + coalesce(b.score, 0) * ${match.brand}
        + coalesce(z.score, 0) * ${match.size} DESC,
      l.popularity_score DESC, l.created_at DESC, l.id
    LIMIT ${HOME_SECTION_SIZE}`;
}

/**
 * The home page: named sections of listings. "For You" appears only when signed
 * in. With an origin (see resolveOrigin) trending is limited to nearby listings and
 * every listing carries its distance.
 */
export async function homeSections({ db, clock }, viewerId = null, query = {}) {
  const origin = await resolveOrigin({ db }, query, viewerId);
  const sources = [
    { key: 'trending', title: 'Trending Near You', rows: trending(db, clock.now(), origin) },
    { key: 'recent', title: 'Recently Listed', rows: recentlyListed(db) },
    { key: 'budget', title: 'Budget-Friendly Finds', rows: budgetFriendly(db) },
    { key: 'rent', title: 'Rent for an Occasion', rows: rentForAnOccasion(db) },
  ];
  if (viewerId) sources.push({ key: 'forYou', title: 'For You', rows: forYou(db, viewerId) });

  const sections = await Promise.all(
    sources.map(async ({ key, title, rows }) => ({
      key,
      title,
      items: await withDistances(db, await listingsInOrder(db, ids(await rows), viewerId), origin),
    })),
  );
  return { origin: describeOrigin(origin), sections };
}

/** The listings a user has liked that can still be seen, most recently liked first. */
export async function listLikedListings({ db }, userId, query) {
  const where = { userId, listing: PUBLICLY_VISIBLE };
  const [likes, total] = await Promise.all([
    db.listingLike.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { listingId: 'asc' }],
      include: { listing: { include: listingInclude } },
      ...pageWindow(query),
    }),
    db.listingLike.count({ where }),
  ]);
  return paged(
    likes.map((like) => toListing(like.listing, true)),
    total,
    query,
  );
}
