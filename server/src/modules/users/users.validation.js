import { z } from 'zod';
import { BIO_MAX_LENGTH, LOCALITY_MAX_LENGTH } from '../../config/policy.js';
import { currentPasswordSchema, displayNameSchema } from '../auth/auth.validation.js';

// Empty text clears an optional field.
const optionalText = (maxLength) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => (value === '' ? null : value))
    .nullable();

const atLeastOneField = (value) => Object.keys(value).length > 0;

export const updateProfileSchema = z
  .strictObject({
    displayName: displayNameSchema,
    bio: optionalText(BIO_MAX_LENGTH),
    locality: optionalText(LOCALITY_MAX_LENGTH),
  })
  .partial()
  .refine(atLeastOneField, { message: 'Provide at least one field to update' });

export const requestDeletionSchema = z.strictObject({ password: currentPasswordSchema });

export const userIdParamsSchema = z.object({ id: z.uuid() });
