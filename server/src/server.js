import { createApp } from './app.js';
import { APP_NAME } from './config/app.js';
import { env } from './config/env.js';
import { db } from './lib/db.js';
import { closeRedis } from './lib/redis.js';
import { startJobs } from './jobs/index.js';

const logger = console;
const app = createApp({ logger });

const server = app.listen(env.PORT, () => {
  logger.info(`${APP_NAME} API listening on http://localhost:${env.PORT}`);
});

const jobs = await startJobs(app.locals.deps);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  await jobs.close();
  await closeRedis();
  await db.$disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
