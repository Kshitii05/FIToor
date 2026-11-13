import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  ALLOWED_AREA,
  DISTANCE_ROUNDING_KM,
  LOCALITY_MAX_LENGTH,
  LOCATION_GRID_DEGREES,
  ORIGIN_DECIMALS,
} from '../config/policy.js';

// Location helpers. Nothing here measures distance: that is always done by PostGIS
// in SQL. These only shape coordinates before they are stored or used.

const roundTo = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * The centre of the grid square (~500 m, DECISIONS I6) that a point falls in. This
 * is the only position of a listing anyone but its seller sees, so two listings in
 * the same square look the same however their distance is measured.
 */
export function publicPoint({ lat, lng }) {
  const centre = (value) =>
    roundTo((Math.floor(value / LOCATION_GRID_DEGREES) + 0.5) * LOCATION_GRID_DEGREES, 6);
  return { lat: centre(lat), lng: centre(lng) };
}

/** A device position rounded to about 100 m before it is used as a search origin. */
export function roundOrigin({ lat, lng }) {
  return { lat: roundTo(lat, ORIGIN_DECIMALS), lng: roundTo(lng, ORIGIN_DECIMALS) };
}

const OUTSIDE_AREA = 'Choose a place in India';

export const latitudeSchema = z
  .number('Enter a latitude')
  .min(ALLOWED_AREA.minLat, OUTSIDE_AREA)
  .max(ALLOWED_AREA.maxLat, OUTSIDE_AREA);

export const longitudeSchema = z
  .number('Enter a longitude')
  .min(ALLOWED_AREA.minLng, OUTSIDE_AREA)
  .max(ALLOWED_AREA.maxLng, OUTSIDE_AREA);

export const localitySchema = z
  .string('Enter the area name')
  .trim()
  .min(2, 'Enter the area name')
  .max(LOCALITY_MAX_LENGTH, `Use at most ${LOCALITY_MAX_LENGTH} characters`);

/** A point chosen by a person, with the area name to show for it. */
export const placeSchema = z.strictObject({
  lat: latitudeSchema,
  lng: longitudeSchema,
  locality: localitySchema,
});

/** A geography point for use inside a $queryRaw template. */
export function pointSql({ lat, lng }) {
  return Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography`;
}

/**
 * SQL for the shown distance in km from a listing's public point to `origin`:
 * rounded up to the next 0.5 km, and never less than 0.5 km.
 */
export function shownDistanceSql(origin) {
  const step = DISTANCE_ROUNDING_KM * 1000;
  return Prisma.sql`GREATEST(
    ${DISTANCE_ROUNDING_KM}::float8,
    CEIL(ST_Distance(l.public_location, ${pointSql(origin)}) / ${step}::float8) * ${DISTANCE_ROUNDING_KM}::float8
  )`;
}
