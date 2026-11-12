import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig } from 'vitest/config';

const rootEnvPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');
dotenv.config({ path: rootEnvPath, quiet: true });

const testDatabaseUrl = process.env.DATABASE_URL_TEST;

if (!testDatabaseUrl) {
  throw new Error('DATABASE_URL_TEST is not set. Copy .env.example to .env first.');
}
if (testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL_TEST must not point at the development database.');
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    globalSetup: ['./test/globalSetup.js'],
    // Tests share one real database, so test files run one after another.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      // Fixed, test-only secrets so the suite does not depend on local .env values.
      JWT_SECRET: 'test-only-jwt-secret-0123456789abcdef0123456789',
      OTP_SECRET: 'test-only-otp-secret-0123456789abcdef0123456789',
      SMTP_HOST: '',
    },
  },
});
