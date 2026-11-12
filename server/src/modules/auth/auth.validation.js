import { z } from 'zod';
import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  OTP_LENGTH,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
} from '../../config/policy.js';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

// Indian mobile numbers, with or without the +91 prefix; stored as +91XXXXXXXXXX.
export const phoneSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a valid Indian mobile number'))
  .transform((value) => (value.startsWith('+91') ? value : `+91${value}`));

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES, {
    message: 'Password is too long',
  });

// For checking an existing password: no length rules, so old passwords keep working
// if the rules change.
export const currentPasswordSchema = z.string().min(1).max(1024);

export const displayNameSchema = z
  .string()
  .trim()
  .min(DISPLAY_NAME_MIN_LENGTH)
  .max(DISPLAY_NAME_MAX_LENGTH);

const codeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code`);

const channelSchema = z.enum(['email', 'phone']).transform((value) => value.toUpperCase());

export const registerSchema = z.strictObject({
  email: emailSchema,
  phone: phoneSchema,
  password: newPasswordSchema,
  displayName: displayNameSchema,
});

export const credentialsSchema = z.strictObject({
  email: emailSchema,
  password: currentPasswordSchema,
});

export const otpSendSchema = z.strictObject({ channel: channelSchema });

export const otpVerifySchema = z.strictObject({ channel: channelSchema, code: codeSchema });

export const forgotPasswordSchema = z.strictObject({ email: emailSchema });

export const resetPasswordSchema = z.strictObject({
  email: emailSchema,
  code: codeSchema,
  password: newPasswordSchema,
});
