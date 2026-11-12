import { env } from '../config/env.js';

/**
 * OtpSender interface: `send({ phone, code })` (DECISIONS I1).
 *
 * No SMS provider is chosen yet. In development the code is printed to the server
 * console; a real provider is added by implementing the same interface.
 */
export function createOtpSender({ logger = console } = {}) {
  return {
    async send({ phone, code }) {
      if (env.NODE_ENV === 'production') {
        throw new Error('No SMS provider is configured');
      }
      logger.info(`[sms not sent: no provider configured] code for ${phone}: ${code}`);
    },
  };
}
