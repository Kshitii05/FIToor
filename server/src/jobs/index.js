import { Queue, Worker } from 'bullmq';
import { ACCOUNT_PURGE_INTERVAL_MINUTES } from '../config/policy.js';
import { createRedisConnection } from '../lib/redis.js';
import { purgeExpiredDeletions } from '../modules/users/deletion.service.js';

const QUEUE_NAME = 'maintenance';
const PURGE_DELETED_ACCOUNTS = 'purge-deleted-accounts';

/**
 * Starts the scheduled background jobs. Called once by the server process;
 * tests exercise the job functions directly instead.
 */
export async function startJobs({ db, clock, logger }) {
  // BullMQ requires its connections to retry commands indefinitely.
  const queueConnection = createRedisConnection({ maxRetriesPerRequest: null });
  const workerConnection = createRedisConnection({ maxRetriesPerRequest: null });

  const queue = new Queue(QUEUE_NAME, { connection: queueConnection });
  await queue.upsertJobScheduler(
    PURGE_DELETED_ACCOUNTS,
    { every: ACCOUNT_PURGE_INTERVAL_MINUTES * 60 * 1000 },
    { name: PURGE_DELETED_ACCOUNTS, opts: { removeOnComplete: 50, removeOnFail: 200 } },
  );

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === PURGE_DELETED_ACCOUNTS) {
        const purged = await purgeExpiredDeletions({ db, clock });
        if (purged > 0) logger.info(`Erased ${purged} account(s) past their recovery period`);
        return { purged };
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
