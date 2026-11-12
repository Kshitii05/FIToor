import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs once before the suite: brings the test database up to the latest migration.
export default function setup() {
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  execSync('npx prisma migrate deploy', {
    cwd: serverDir,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST },
  });
}
