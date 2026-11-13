import { Queue, Worker } from 'bullmq';
import { ACCOUNT_PURGE_INTERVAL_MINUTES, ORDER_JOBS_INTERVAL_SECONDS } from '../config/policy.js';
import { createRedisConnection } from '../lib/redis.js';
import { runOrderJobs } from '../modules/orders/order.jobs.js';
import { runRentalJobs } from '../modules/rentals/rental.jobs.js';
import { purgeExpiredDeletions } from '../modules/users/deletion.service.js';

const QUEUE_NAME = 'maintenance';
const PURGE_DELETED_ACCOUNTS = 'purge-deleted-accounts';
const ORDER_DEADLINES = 'order-deadlines';

/**
 * Starts the scheduled background jobs. Called once by the server process;
 * tests exercise the job functions directly instead. `deps` are the app's
 * dependencies (database, clock, email, payment gateway).
 */
export async function startJobs(deps) {
  const { db, clock, logger } = deps;
  // BullMQ requires its connections to retry commands indefinitely.
  const queueConnection = createRedisConnection({ maxRetriesPerRequest: null });
  const workerConnection = createRedisConnection({ maxRetriesPerRequest: null });

  const queue = new Queue(QUEUE_NAME, { connection: queueConnection });
  await queue.upsertJobScheduler(
    PURGE_DELETED_ACCOUNTS,
    { every: ACCOUNT_PURGE_INTERVAL_MINUTES * 60 * 1000 },
    { name: PURGE_DELETED_ACCOUNTS, opts: { removeOnComplete: 50, removeOnFail: 200 } },
  );
  // Checkout expiry, dispatch, receipt and issue deadlines, refund retries, and the
  // rental deadlines (holds, payment window, return reminders, inspection, claims).
  await queue.upsertJobScheduler(
    ORDER_DEADLINES,
    { every: ORDER_JOBS_INTERVAL_SECONDS * 1000 },
    { name: ORDER_DEADLINES, opts: { removeOnComplete: 50, removeOnFail: 200 } },
  );

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === PURGE_DELETED_ACCOUNTS) {
        const purged = await purgeExpiredDeletions({ db, clock });
        if (purged > 0) logger.info(`Erased ${purged} account(s) past their recovery period`);
        return { purged };
      }
      if (job.name === ORDER_DEADLINES) {
        return { orders: await runOrderJobs(deps), rentals: await runRentalJobs(deps) };
      }
      throw new Error(`Unknown job: ${job.name}`);
    },
    { connection: workerConnection },
  );

  worker.on('failed', (job, error) => {
    logger.error(`Job ${job?.name ?? 'unknown'} failed`, error);
  });
  worker.on('error', (error) => logger.error(error));

  return {
    async close() {
      await worker.close();
      await queue.close();
      await Promise.all([queueConnection.quit(), workerConnection.quit()]);
    },
  };
}
