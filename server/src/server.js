import { createApp } from './app.js';
import { createEmailQueue } from './lib/emailQueue.js';
import { createEmailSender } from './lib/mailer.js';
import { createRedisConnection } from './lib/redis.js';
import { APP_NAME } from './config/app.js';
import { env } from './config/env.js';
import { db } from './lib/db.js';
import { closeRedis } from './lib/redis.js';
import { startJobs } from './jobs/index.js';
import { attachRealtime } from './modules/messaging/realtime.js';

const logger = console;
// Notification emails go through a BullMQ queue with retries (I97).
const emailSender = createEmailSender({ logger });
const emailConnections = [
  createRedisConnection({ maxRetriesPerRequest: null }),
  createRedisConnection({ maxRetriesPerRequest: null }),
];
const emailQueue = createEmailQueue({
  emailSender,
  logger,
  connection: emailConnections[0],
  workerConnection: emailConnections[1],
});
const app = createApp({ logger, emailSender, emailQueue });

const server = app.listen(env.PORT, () => {
  logger.info(`${APP_NAME} API listening on http://localhost:${env.PORT}`);
});

attachRealtime(server, app);

const jobs = await startJobs(app.locals.deps);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  await jobs.close();
  await emailQueue.close();
  await Promise.all(emailConnections.map((connection) => connection.quit()));
  await closeRedis();
  await db.$disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
