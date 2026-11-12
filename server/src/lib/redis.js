import { Redis } from 'ioredis';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env.js';

let client;

/** Shared Redis connection, opened on first use. */
export function getRedis() {
  if (!client) client = new Redis(env.REDIS_URL);
  return client;
}

/** A dedicated connection, for consumers (such as job workers) that need their own. */
export function createRedisConnection(options = {}) {
  return new Redis(env.REDIS_URL, options);
}

export async function closeRedis() {
  if (client) {
    await client.quit();
    client = undefined;
  }
}

/** Rate-limit counters live in Redis so limits hold across restarts and instances. */
export function createRedisRateLimitStore(name) {
  return new RedisStore({
    prefix: `rate-limit:${name}:`,
    sendCommand: (...args) => getRedis().call(...args),
  });
}
