import { z } from 'zod';
import { LOCATION_LABEL_MAX_LENGTH, PLACE_QUERY_MAX_LENGTH } from '../../config/policy.js';
import { latitudeSchema, localitySchema, longitudeSchema } from '../../lib/geo.js';

const labelSchema = z
  .string('Enter a name for this place')
  .trim()
  .min(1, 'Enter a name for this place')
  .max(LOCATION_LABEL_MAX_LENGTH, `Use at most ${LOCATION_LABEL_MAX_LENGTH} characters`);

const fields = {
  label: labelSchema,
  locality: localitySchema,
  lat: latitudeSchema,
  lng: longitudeSchema,
  isDefault: z.boolean().optional(),
};

export const savedLocationSchema = z.strictObject(fields);

export const updateSavedLocationSchema = z
  .strictObject(fields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })
  .refine((value) => (value.lat === undefined) === (value.lng === undefined), {
    message: 'Send both lat and lng, or neither',
    path: ['lat'],
  });

export const savedLocationParamsSchema = z.object({ id: z.uuid() });

export const placeSearchQuerySchema = z.object({
  q: z
    .string('Type a place name or PIN code')
    .trim()
    .min(2, 'Type at least 2 characters')
    .max(PLACE_QUERY_MAX_LENGTH),
});

export const reverseQuerySchema = z.object({
  lat: z.coerce.number().pipe(latitudeSchema),
  lng: z.coerce.number().pipe(longitudeSchema),
});
