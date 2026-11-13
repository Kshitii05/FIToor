import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// One .env at the repository root serves both the server and the client.
// Values already present in the environment (for example the test database URL set
// by the test runner) are not overridden.
const rootEnvPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
dotenv.config({ path: rootEnvPath, quiet: true });

// An empty value in .env (`SMTP_HOST=`) means "not set".
const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

const schema = z.object({
  APP_NAME: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32),
  OTP_SECRET: z.string().min(32),
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  EMAIL_FROM: z.string().min(1).default('no-reply@localhost'),
  CLOUDINARY_CLOUD_NAME: optionalString,
  CLOUDINARY_API_KEY: optionalString,
  CLOUDINARY_API_SECRET: optionalString,
  // Development only: password given to the demo accounts made by the seed script.
  SEED_USER_PASSWORD: optionalString,
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration (see .env.example):\n${problems}`);
}

const cloudinary = [
  parsed.data.CLOUDINARY_CLOUD_NAME,
  parsed.data.CLOUDINARY_API_KEY,
  parsed.data.CLOUDINARY_API_SECRET,
];
if (cloudinary.some(Boolean) && !cloudinary.every(Boolean)) {
  throw new Error(
    'Invalid environment configuration: set all three CLOUDINARY_* values, or none of them',
  );
}

export const env = Object.freeze(parsed.data);
