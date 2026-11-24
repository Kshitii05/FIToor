import { Queue, Worker } from 'bullmq';
import {
  EMAIL_JOB_KEEP_DAYS,
  EMAIL_RETRY_ATTEMPTS,
  EMAIL_RETRY_DELAY_SECONDS,
} from '../config/policy.js';

// Email delivery for notifications (I91, I92, I97). Each email is a job whose id is
// the notification's key, so the same email can never be queued twice: BullMQ
// ignores an add whose job id already exists. Finished jobs are kept for a week so
// their ids stay taken. Failed sends are retried 3 times, waiting longer each time.
//
//   add({ jobId, to, subject, text })   counts()   obliterate()   close()

const DEFAULT_NAME = 'email';

/** The BullMQ queue, with its worker (the server process runs one). */
export function createEmailQueue({
  emailSender,
  logger,
  connection,
  workerConnection = connection,
  name = DEFAULT_NAME,
  startWorker = true,
}) {
  const queue = new Queue(name, { connection });
  const worker = startWorker
    ? new Worker(
        name,
        async (job) => {
          const { to, subject, text } = job.data;
          await emailSender.send({ to, subject, text });
        },
        { connection: workerConnection },
      )
    : null;
  worker?.on('failed', (job, error) =>
    logger.error(`Email job ${job?.id} failed (try ${job?.attemptsMade})`, error),
  );
  worker?.on('error', (error) => logger.error(error));

  return {
    async add({ jobId, to, subject, text }) {
      await queue.add(
        'email',
        { to, subject, text },
        {
          jobId,
          attempts: EMAIL_RETRY_ATTEMPTS,
          backoff: { type: 'exponential', delay: EMAIL_RETRY_DELAY_SECONDS * 1000 },
          removeOnComplete: { age: EMAIL_JOB_KEEP_DAYS * 24 * 3600 },
          removeOnFail: { age: EMAIL_JOB_KEEP_DAYS * 24 * 3600 },
        },
      );
    },
    counts: () => queue.getJobCounts('waiting', 'delayed', 'active', 'completed', 'failed'),
    obliterate: () => queue.obliterate({ force: true }),
    async close() {
      await worker?.close();
      await queue.close();
    },
  };
}

/**
 * Sends at once, in the same process: tests, and running the app without the job
 * worker. It follows the same rule as the queue: one job id, one email.
 */
export function createInlineEmailQueue({ emailSender, logger }) {
  const seen = new Set();
  return {
    async add({ jobId, to, subject, text }) {
      if (seen.has(jobId)) return;
      seen.add(jobId);
      try {
        await emailSender.send({ to, subject, text });
      } catch (error) {
        logger.error(error);
      }
    },
    counts: async () => ({ waiting: 0, delayed: 0, active: 0, completed: seen.size, failed: 0 }),
    obliterate: async () => seen.clear(),
    close: async () => {},
  };
}
