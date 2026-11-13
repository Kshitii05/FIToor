import { z } from 'zod';
import {
  SEARCH_RADIUS_OPTIONS_KM,
  LISTING_AMOUNT_MAX_PAISE,
  LISTING_BRAND_MAX_LENGTH,
  LISTING_COLOUR_MAX_LENGTH,
  LISTING_SIZE_MAX_LENGTH,
  SEARCH_QUERY_MAX_LENGTH,
} from '../../config/policy.js';
import { latitudeSchema, longitudeSchema } from '../../lib/geo.js';
import { paginationQuery } from '../../lib/pagination.js';
import {
  ITEM_CONDITIONS,
  LISTING_CATEGORIES,
  LISTING_MODES,
} from '../listings/listings.validation.js';

export const SORT_OPTIONS = [
  'relevance',
  'newest',
  'price_asc',
  'price_desc',
  'popular',
  'nearest',
];

// Query strings arrive as text. An empty value means the filter is not set.
const blankToUndefined = (value) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const optional = (schema) => z.preprocess(blankToUndefined, schema.optional());

/** Several values in one parameter, separated by commas: `category=BAGS,FOOTWEAR`. */
const oneOrMore = (values) =>
  optional(
    z
      .string()
      .transform((text) =>
        text
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.enum(values)).min(1).max(values.length)),
  );

const textFilter = (maxLength) => optional(z.string().trim().min(1).max(maxLength));
const pricePaise = optional(z.coerce.number().int().min(0).max(LISTING_AMOUNT_MAX_PAISE));

/**
 * Where to measure distances from: a device position, or one of the person's saved
 * locations. Both are optional; see resolveOrigin for the order they are used in.
 */
export const originQuery = {
  lat: optional(z.coerce.number().pipe(latitudeSchema)),
  lng: optional(z.coerce.number().pipe(longitudeSchema)),
  locationId: optional(z.uuid()),
};

const bothOrNeither = (query) => (query.lat === undefined) === (query.lng === undefined);
const BOTH_MESSAGE = { message: 'Send both lat and lng, or neither', path: ['lat'] };
const radiusKm = optional(
  z.coerce.number().refine((value) => SEARCH_RADIUS_OPTIONS_KM.includes(value), {
    message: `Choose ${SEARCH_RADIUS_OPTIONS_KM.join(', ')} km`,
  }),
);

export const searchQuerySchema = z
  .object({
    ...paginationQuery,
    q: optional(z.string().trim().max(SEARCH_QUERY_MAX_LENGTH)),
    category: oneOrMore(LISTING_CATEGORIES),
    condition: oneOrMore(ITEM_CONDITIONS),
    mode: optional(z.enum(LISTING_MODES)),
    size: textFilter(LISTING_SIZE_MAX_LENGTH),
    brand: textFilter(LISTING_BRAND_MAX_LENGTH),
    colour: textFilter(LISTING_COLOUR_MAX_LENGTH),
    minPricePaise: pricePaise,
    maxPricePaise: pricePaise,
    // `available=true` leaves out sold-out listings.
    available: optional(z.enum(['true', 'false']).transform((value) => value === 'true')),
    sort: optional(z.enum(SORT_OPTIONS)),
    ...originQuery,
    radiusKm,
    deliversToMe: optional(z.enum(['true', 'false']).transform((value) => value === 'true')),
  })
  .refine(bothOrNeither, BOTH_MESSAGE)
  .refine(
    (query) =>
      query.minPricePaise === undefined ||
      query.maxPricePaise === undefined ||
      query.minPricePaise <= query.maxPricePaise,
    { message: 'The lowest price cannot be above the highest price', path: ['minPricePaise'] },
  );

export const suggestionsQuerySchema = z.object({
  q: optional(z.string().trim().max(SEARCH_QUERY_MAX_LENGTH)),
});

export const homeQuerySchema = z.object({ ...originQuery }).refine(bothOrNeither, BOTH_MESSAGE);

export const likedListingsQuerySchema = z.object({ ...paginationQuery });
