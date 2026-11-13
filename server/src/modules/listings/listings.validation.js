import { z } from 'zod';
import {
  DELIVERY_CHARGE_MAX_PAISE,
  DELIVERY_RADIUS_MAX_KM,
  DELIVERY_RADIUS_MIN_KM,
  LATE_FEE_PER_DAY_MAX_PAISE,
  LISTING_AMOUNT_MAX_PAISE,
  LISTING_AMOUNT_MIN_PAISE,
  LISTING_BRAND_MAX_LENGTH,
  LISTING_COLOUR_MAX_LENGTH,
  LISTING_DESCRIPTION_MAX_LENGTH,
  LISTING_DESCRIPTION_MIN_LENGTH,
  LISTING_QUANTITY_MAX,
  LISTING_SIZE_MAX_LENGTH,
  LISTING_TITLE_MAX_LENGTH,
  LISTING_TITLE_MIN_LENGTH,
  RENTAL_PACKAGE_MAX_DAYS,
  RENTAL_PACKAGES_MAX,
} from '../../config/policy.js';
import { placeSchema } from '../../lib/geo.js';
import { paginationQuery } from '../../lib/pagination.js';

export const LISTING_MODES = ['SALE', 'RENT'];
export const LISTING_STATUSES = ['ACTIVE', 'PAUSED', 'UNDER_REVIEW', 'REMOVED'];
export const LISTING_CATEGORIES = [
  'ETHNIC_WEAR',
  'WESTERN_WEAR',
  'FOOTWEAR',
  'ACCESSORIES',
  'BAGS',
  'FORMAL_WEAR',
];
export const ITEM_CONDITIONS = ['NEW', 'GOOD', 'FAIR'];

// Money is always whole paise. Fractions and numeric strings are rejected, not rounded.
const rupees = (paiseValue) => `₹${(paiseValue / 100).toLocaleString('en-IN')}`;
const paise = (min, max) => {
  const message = `Enter an amount between ${rupees(min)} and ${rupees(max)}`;
  return z.number(message).int(message).min(min, message).max(max, message);
};

/** A whole number within a range, with one plain message for every way it can be wrong. */
const wholeNumber = (min, max, message) =>
  z.number(message).int(message).min(min, message).max(max, message);
const amountPaise = paise(LISTING_AMOUNT_MIN_PAISE, LISTING_AMOUNT_MAX_PAISE);

const text = (min, max) => {
  const message = min > 1 ? `Use between ${min} and ${max} characters` : 'This is required';
  return z.string(message).trim().min(min, message).max(max, `Use at most ${max} characters`);
};

const deliverySchema = z.strictObject({
  chargePaise: paise(0, DELIVERY_CHARGE_MAX_PAISE),
  radiusKm: wholeNumber(
    DELIVERY_RADIUS_MIN_KM,
    DELIVERY_RADIUS_MAX_KM,
    `Enter a distance between ${DELIVERY_RADIUS_MIN_KM} and ${DELIVERY_RADIUS_MAX_KM} km`,
  ),
});

const packagesSchema = z
  .array(
    z.strictObject({
      durationDays: wholeNumber(
        1,
        RENTAL_PACKAGE_MAX_DAYS,
        `Enter between 1 and ${RENTAL_PACKAGE_MAX_DAYS} days`,
      ),
      pricePaise: amountPaise,
    }),
  )
  .min(1, 'Add at least one rental package')
  .max(RENTAL_PACKAGES_MAX, `Add at most ${RENTAL_PACKAGES_MAX} rental packages`)
  .refine((packages) => new Set(packages.map((p) => p.durationDays)).size === packages.length, {
    message: 'Each rental package needs a different duration',
  });

const commonFields = {
  title: text(LISTING_TITLE_MIN_LENGTH, LISTING_TITLE_MAX_LENGTH),
  description: text(LISTING_DESCRIPTION_MIN_LENGTH, LISTING_DESCRIPTION_MAX_LENGTH),
  category: z.enum(LISTING_CATEGORIES, 'Choose a category'),
  condition: z.enum(ITEM_CONDITIONS, 'Choose a condition'),
  brand: text(1, LISTING_BRAND_MAX_LENGTH),
  size: text(1, LISTING_SIZE_MAX_LENGTH),
  colour: text(1, LISTING_COLOUR_MAX_LENGTH),
  // null means the listing does not offer delivery.
  delivery: deliverySchema.nullable(),
  pickup: z.boolean(),
  // Where the item is: the seller's pin and the area name to show with it.
  location: placeSchema,
};

const saleFields = {
  pricePaise: amountPaise,
  quantity: wholeNumber(
    1,
    LISTING_QUANTITY_MAX,
    `Enter a quantity between 1 and ${LISTING_QUANTITY_MAX}`,
  ),
};

const rentFields = {
  depositPaise: amountPaise,
  lateFeePerDayPaise: paise(0, LATE_FEE_PER_DAY_MAX_PAISE),
  packages: packagesSchema,
};

const FULFILMENT_MESSAGE = 'Offer delivery, pickup or both';
const offersFulfilment = (value) => value.delivery !== null || value.pickup;

// Strict objects: a sale listing carrying rent fields (or the reverse) is rejected
// here, before the database constraint would reject it.
export const createListingSchema = z
  .discriminatedUnion('mode', [
    z.strictObject({
      mode: z.literal('SALE'),
      ...commonFields,
      ...saleFields,
      quantity: saleFields.quantity.default(1),
    }),
    z.strictObject({ mode: z.literal('RENT'), ...commonFields, ...rentFields }),
  ])
  .refine(offersFulfilment, { message: FULFILMENT_MESSAGE, path: ['pickup'] });

const atLeastOneField = (value) => Object.keys(value).length > 0;
const NO_CHANGES_MESSAGE = 'Provide at least one field to update';

// The mode is not editable: `mode` is not a field of either schema, so sending it
// is rejected as an unknown field.
const updateSchemas = {
  SALE: z
    .strictObject({ ...commonFields, ...saleFields })
    .partial()
    .refine(atLeastOneField, { message: NO_CHANGES_MESSAGE }),
  RENT: z
    .strictObject({ ...commonFields, ...rentFields })
    .partial()
    .refine(atLeastOneField, { message: NO_CHANGES_MESSAGE }),
};

/** The update schema for a listing of the given mode. */
export function updateListingSchemaFor(mode) {
  return updateSchemas[mode];
}

export const listingIdParamsSchema = z.object({ id: z.uuid() });
export const listingImageParamsSchema = z.object({ id: z.uuid(), imageId: z.uuid() });
export const sellerIdParamsSchema = z.object({ id: z.uuid() });

export const reorderImagesSchema = z.strictObject({
  imageIds: z.array(z.uuid()).min(1).max(8),
});

const listFilters = {
  mode: z.enum(LISTING_MODES).optional(),
  category: z.enum(LISTING_CATEGORIES).optional(),
};

export const myListingsQuerySchema = z.object({
  ...paginationQuery,
  ...listFilters,
  status: z.enum(LISTING_STATUSES).optional(),
});

export const sellerListingsQuerySchema = z.object({ ...paginationQuery, ...listFilters });
