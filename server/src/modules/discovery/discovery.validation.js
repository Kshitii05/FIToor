import { z } from 'zod';
import {
  LISTING_AMOUNT_MAX_PAISE,
  LISTING_BRAND_MAX_LENGTH,
  LISTING_COLOUR_MAX_LENGTH,
  LISTING_SIZE_MAX_LENGTH,
  SEARCH_QUERY_MAX_LENGTH,
} from '../../config/policy.js';
import { paginationQuery } from '../../lib/pagination.js';
import {
  ITEM_CONDITIONS,
  LISTING_CATEGORIES,
  LISTING_MODES,
} from '../listings/listings.validation.js';

export const SORT_OPTIONS = ['relevance', 'newest', 'price_asc', 'price_desc', 'popular'];

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
  })
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

export const likedListingsQuerySchema = z.object({ ...paginationQuery });
