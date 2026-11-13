import { SAVED_LOCATIONS_MAX } from '../../config/policy.js';
import { AppError } from '../../lib/errors.js';
import { pointSql, roundOrigin, shownDistanceSql } from '../../lib/geo.js';

// Saved locations are private: they are only ever returned to their owner, and are
// only used to measure distances from, never shown to anyone else.

function toSavedLocation(row) {
  return {
    id: row.id,
    label: row.label,
    locality: row.locality,
    lat: row.lat,
    lng: row.lng,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
  };
}

const newestFirst = [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }];

export async function listSavedLocations({ db }, userId) {
  const rows = await db.savedLocation.findMany({ where: { userId }, orderBy: newestFirst });
  return rows.map(toSavedLocation);
}

async function loadOwn(db, userId, id) {
  const row = await db.savedLocation.findFirst({ where: { id, userId } });
  if (!row) throw AppError.notFound('Saved location not found');
  return row;
}

/** Saves a place. The first one saved becomes the default. */
export async function addSavedLocation({ db, clock }, userId, input) {
  const created = await db.$transaction(async (tx) => {
    // Serialises concurrent saves by the same person, so the limit holds.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const count = await tx.savedLocation.count({ where: { userId } });
    if (count >= SAVED_LOCATIONS_MAX) {
      throw new AppError(
        409,
        'TOO_MANY_LOCATIONS',
        `You can save up to ${SAVED_LOCATIONS_MAX} locations. Remove one first.`,
      );
    }
    const isDefault = count === 0 || input.isDefault === true;
    if (isDefault) {
      await tx.savedLocation.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return tx.savedLocation.create({
      data: {
        userId,
        label: input.label,
        locality: input.locality,
        lat: input.lat,
        lng: input.lng,
        isDefault,
        createdAt: clock.now(),
      },
    });
  });
  return toSavedLocation(created);
}

/** Changes a saved place. `isDefault: true` makes it the default; the default cannot be unset directly. */
export async function updateSavedLocation({ db }, userId, id, changes) {
  const existing = await loadOwn(db, userId, id);
  const { isDefault, ...fields } = changes;
  if (isDefault === false && existing.isDefault) {
    throw new AppError(409, 'DEFAULT_REQUIRED', 'Choose another location as your default instead');
  }

  const updated = await db.$transaction(async (tx) => {
    if (isDefault === true && !existing.isDefault) {
      await tx.savedLocation.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return tx.savedLocation.update({
      where: { id },
      data: { ...fields, ...(isDefault === true ? { isDefault: true } : {}) },
    });
  });
  return toSavedLocation(updated);
}

/** Removes a saved place. If it was the default, the oldest remaining one takes over. */
export async function removeSavedLocation({ db }, userId, id) {
  const existing = await loadOwn(db, userId, id);
  await db.$transaction(async (tx) => {
    await tx.savedLocation.delete({ where: { id } });
    if (!existing.isDefault) return;
    const next = await tx.savedLocation.findFirst({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (next) await tx.savedLocation.update({ where: { id: next.id }, data: { isDefault: true } });
  });
}

// ---------------------------------------------------------------------------
// Where to measure distances from
// ---------------------------------------------------------------------------

/**
 * The point a search measures distances from, or null when there is none:
 * a position sent by the device (rounded to ~100 m, never stored), else a saved
 * location named in the request, else the signed-in person's default location.
 * Returns `{ lat, lng, source, label }`.
 */
export async function resolveOrigin({ db }, { lat, lng, locationId }, viewerId) {
  if (locationId) {
    if (!viewerId) throw AppError.unauthorized('Sign in to search around a saved location');
    const saved = await loadOwn(db, viewerId, locationId);
    return { lat: saved.lat, lng: saved.lng, source: 'saved', label: saved.label };
  }
  if (lat !== undefined && lng !== undefined) {
    return { ...roundOrigin({ lat, lng }), source: 'device', label: null };
  }
  if (!viewerId) return null;
  const saved = await db.savedLocation.findFirst({ where: { userId: viewerId, isDefault: true } });
  return saved ? { lat: saved.lat, lng: saved.lng, source: 'saved', label: saved.label } : null;
}

/** How a search origin is described in a response: what it was, never its coordinates. */
export function describeOrigin(origin) {
  return origin ? { source: origin.source, label: origin.label } : null;
}

/**
 * Adds, to listings already shaped for a response, the shown distance from
 * `origin` and whether the seller delivers that far. Both null without an origin
 * or a listing location. One query for the whole list.
 */
export async function withDistances(db, items, origin) {
  if (!origin || items.length === 0) {
    return items.map((item) => ({ ...item, distanceKm: null, deliversToYou: null }));
  }
  const rows = await db.$queryRaw`
    SELECT l.id,
      CASE WHEN l.public_location IS NULL THEN NULL ELSE ${shownDistanceSql(origin)} END AS distance_km,
      CASE
        WHEN l.public_location IS NULL THEN NULL
        ELSE l.offers_delivery
          AND ST_DWithin(l.public_location, ${pointSql(origin)}, l.delivery_radius_km * 1000)
      END AS delivers
    FROM listings l
    WHERE l.id = ANY(${items.map((item) => item.id)}::uuid[])`;
  const byId = new Map(rows.map((row) => [row.id, row]));
  return items.map((item) => ({
    ...item,
    distanceKm: byId.get(item.id)?.distance_km ?? null,
    deliversToYou: byId.get(item.id)?.delivers ?? null,
  }));
}
