import { Prisma } from '@prisma/client';
import {
  FACET_VALUES_MAX,
  SEARCH_HISTORY_MAX,
  SEARCH_TERMS_MAX,
  SUGGESTION_MIN_LENGTH,
  SUGGESTIONS_MAX,
} from '../../config/policy.js';
import { AppError } from '../../lib/errors.js';
import { pointSql } from '../../lib/geo.js';
import { paged, pageWindow } from '../../lib/pagination.js';
import { listingInclude, toListings } from '../listings/listings.service.js';
import { describeOrigin, resolveOrigin, withDistances } from '../locations/locations.service.js';

// Search runs as SQL so PostgreSQL does the matching, filtering, ranking and paging
// with its indexes. Values always travel as bound parameters, never as SQL text.

const FROM_LISTINGS = Prisma.sql`FROM listings l JOIN users u ON u.id = l.seller_id`;

/** Only live listings of sellers with active accounts are ever found. */
export const VISIBLE = Prisma.sql`l.deleted_at IS NULL AND l.status = 'ACTIVE' AND u.status = 'ACTIVE'`;

/** In stock. Rentals count as available until bookings exist to say otherwise. */
export const AVAILABLE = Prisma.sql`(l.mode = 'RENT' OR l.quantity > 0)`;

/**
 * Turns what someone typed into a full-text query: every word must match, and the
 * last word matches by prefix so results appear while typing ("kur" finds "kurta").
 * Returns null when there is nothing searchable in the text.
 */
export function toTsQuery(text) {
  const words = (text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!words) return null;
  const terms = words.slice(0, SEARCH_TERMS_MAX);
  return terms.map((word, index) => (index === terms.length - 1 ? `${word}:*` : word)).join(' & ');
}

const keywordMatch = (tsQuery) => Prisma.sql`l.search_vector @@ to_tsquery('english', ${tsQuery})`;

/** Within `metres` of the origin, measured from the listing's public point. */
export const within = (origin, metres) =>
  Prisma.sql`ST_DWithin(l.public_location, ${pointSql(origin)}, ${metres}::float8)`;

function conditionsFor(filters, tsQuery, origin) {
  const conditions = [VISIBLE];
  if (tsQuery) conditions.push(keywordMatch(tsQuery));
  if (filters.category) {
    conditions.push(Prisma.sql`l.category::text = ANY(${filters.category}::text[])`);
  }
  if (filters.condition) {
    conditions.push(Prisma.sql`l.condition::text = ANY(${filters.condition}::text[])`);
  }
  if (filters.mode) conditions.push(Prisma.sql`l.mode::text = ${filters.mode}`);
  if (filters.size) conditions.push(Prisma.sql`lower(l.size) = ${filters.size.toLowerCase()}`);
  if (filters.brand) conditions.push(Prisma.sql`lower(l.brand) = ${filters.brand.toLowerCase()}`);
  if (filters.colour) {
    conditions.push(Prisma.sql`lower(l.colour) = ${filters.colour.toLowerCase()}`);
  }
  if (filters.minPricePaise !== undefined) {
    conditions.push(Prisma.sql`l.headline_price_paise >= ${filters.minPricePaise}`);
  }
  if (filters.maxPricePaise !== undefined) {
    conditions.push(Prisma.sql`l.headline_price_paise <= ${filters.maxPricePaise}`);
  }
  if (filters.available) conditions.push(AVAILABLE);
  if (filters.radiusKm) conditions.push(within(origin, filters.radiusKm * 1000));
  if (filters.deliversToMe) {
    conditions.push(
      Prisma.sql`l.offers_delivery AND ST_DWithin(l.public_location, ${pointSql(origin)}, l.delivery_radius_km * 1000)`,
    );
  }
  return Prisma.join(conditions, ' AND ');
}

function orderFor(sort, tsQuery, origin) {
  switch (sort) {
    case 'nearest':
      // Listings without a location come last.
      return Prisma.sql`ST_Distance(l.public_location, ${pointSql(origin)}) ASC NULLS LAST,
        l.created_at DESC, l.id`;
    case 'price_asc':
      return Prisma.sql`l.headline_price_paise ASC, l.created_at DESC, l.id`;
    case 'price_desc':
      return Prisma.sql`l.headline_price_paise DESC, l.created_at DESC, l.id`;
    case 'popular':
      return Prisma.sql`l.popularity_score DESC, l.created_at DESC, l.id`;
    case 'relevance':
      if (tsQuery) {
        return Prisma.sql`ts_rank(l.search_vector, to_tsquery('english', ${tsQuery})) DESC,
          l.popularity_score DESC, l.created_at DESC, l.id`;
      }
    // Without a keyword there is nothing to rank by: fall through to newest.
    // eslint-disable-next-line no-fallthrough
    default:
      return Prisma.sql`l.created_at DESC, l.id`;
  }
}

/** The values of one text column across the matches, most common first. */
function facet(db, column, where) {
  return db.$queryRaw`
    SELECT min(${column}) AS value, count(*)::int AS count
    ${FROM_LISTINGS}
    WHERE ${where}
    GROUP BY lower(${column})
    ORDER BY count DESC, value
    LIMIT ${FACET_VALUES_MAX}`;
}

/** Loads listings by id and returns them in the order of `ids`. */
export async function listingsInOrder(db, ids, viewerId) {
  if (ids.length === 0) return [];
  const rows = await db.listing.findMany({ where: { id: { in: ids } }, include: listingInclude });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return toListings(db, ids.map((id) => byId.get(id)).filter(Boolean), viewerId);
}

/**
 * Keyword search with filters, sorting and paging. Also returns the brands, sizes
 * and colours found among the matches, for the filter lists. With an origin (see
 * resolveOrigin) each listing carries its shown distance, and the distance filters
 * and nearest-first sort become available.
 */
export async function searchListings({ db, clock }, query, viewerId = null) {
  const origin = await resolveOrigin({ db }, query, viewerId);
  if (!origin && (query.radiusKm || query.deliversToMe || query.sort === 'nearest')) {
    throw new AppError(400, 'LOCATION_REQUIRED', 'Choose a location to search near');
  }
  const tsQuery = toTsQuery(query.q);
  const where = conditionsFor(query, tsQuery, origin);
  const sort = query.sort ?? (tsQuery ? 'relevance' : 'newest');
  const { skip, take } = pageWindow(query);

  const [page, [{ total }], brands, sizes, colours] = await Promise.all([
    db.$queryRaw`
      SELECT l.id ${FROM_LISTINGS}
      WHERE ${where}
      ORDER BY ${orderFor(sort, tsQuery, origin)}
      LIMIT ${take} OFFSET ${skip}`,
    db.$queryRaw`SELECT count(*)::int AS total ${FROM_LISTINGS} WHERE ${where}`,
    facet(db, Prisma.sql`l.brand`, where),
    facet(db, Prisma.sql`l.size`, where),
    facet(db, Prisma.sql`l.colour`, where),
  ]);

  if (viewerId && tsQuery && query.page === 1) {
    await rememberSearch({ db, clock }, viewerId, query.q);
  }

  const items = await withDistances(
    db,
    await listingsInOrder(
      db,
      page.map((row) => row.id),
      viewerId,
    ),
    origin,
  );
  return {
    ...paged(items, total, query),
    sort,
    origin: describeOrigin(origin),
    facets: { brands, sizes, colours },
  };
}

// ---------------------------------------------------------------------------
// Suggestions and search history
// ---------------------------------------------------------------------------

const normaliseQuery = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/** Escapes the characters that have a meaning inside a LIKE pattern. */
const likeLiteral = (text) => text.replace(/[\\%_]/g, (character) => `\\${character}`);

async function rememberSearch({ db, clock }, userId, text) {
  const query = normaliseQuery(text);
  const now = clock.now();

  await db.searchHistory.upsert({
    where: { userId_query: { userId, query } },
    create: { userId, query, createdAt: now },
    update: { createdAt: now },
  });

  // Keep only the most recent searches.
  const old = await db.searchHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    skip: SEARCH_HISTORY_MAX,
    select: { id: true },
  });
  if (old.length > 0) {
    await db.searchHistory.deleteMany({ where: { id: { in: old.map((row) => row.id) } } });
  }
}

async function recentSearches(db, userId, prefix) {
  if (!userId) return [];
  const rows = await db.searchHistory.findMany({
    where: { userId, query: prefix ? { startsWith: prefix } : undefined },
    orderBy: { createdAt: 'desc' },
    take: SUGGESTIONS_MAX,
    select: { query: true },
  });
  return rows.map((row) => row.query);
}

/**
 * Autocomplete: listing titles and brands that match what has been typed so far,
 * plus the signed-in user's own matching recent searches.
 */
export async function suggest({ db }, text, viewerId = null) {
  const typed = normaliseQuery(text ?? '');
  const recent = await recentSearches(db, viewerId, typed);
  if (typed.length < SUGGESTION_MIN_LENGTH) return { titles: [], brands: [], recent };

  const anywhere = `%${likeLiteral(typed)}%`;
  const atStart = `${likeLiteral(typed)}%`;

  const [titles, brands] = await Promise.all([
    db.$queryRaw`
      SELECT l.title AS value
      ${FROM_LISTINGS}
      WHERE ${VISIBLE} AND l.title ILIKE ${anywhere}
      GROUP BY l.title
      ORDER BY bool_or(l.title ILIKE ${atStart}) DESC, max(l.popularity_score) DESC, l.title
      LIMIT ${SUGGESTIONS_MAX}`,
    db.$queryRaw`
      SELECT min(l.brand) AS value
      ${FROM_LISTINGS}
      WHERE ${VISIBLE} AND l.brand ILIKE ${atStart}
      GROUP BY lower(l.brand)
      ORDER BY count(*) DESC, value
      LIMIT ${SUGGESTIONS_MAX}`,
  ]);

  return {
    titles: titles.map((row) => row.value),
    brands: brands.map((row) => row.value),
    recent,
  };
}

export async function clearSearchHistory({ db }, userId) {
  await db.searchHistory.deleteMany({ where: { userId } });
}
