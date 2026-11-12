import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

/**
 * EmailSender interface: `send({ to, subject, text })`.
 *
 * With SMTP_HOST set, mail goes out through Nodemailer. Without it, development
 * prints the message to the server console; production refuses to start sending
 * rather than silently dropping mail.
 */
export function createEmailSender({ logger = console } = {}) {
  if (env.SMTP_HOST) {
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
    return {
      send: ({ to, subject, text }) =>
        transport.sendMail({ from: env.EMAIL_FROM, to, subject, text }),
    };
  }

  return {
    async send({ to, subject, text }) {
      if (env.NODE_ENV === 'production') {
        throw new Error('Email is not configured: set SMTP_HOST');
      }
      logger.info(
        `[email not sent: no SMTP configured]\n  To: ${to}\n  Subject: ${subject}\n  ${text}`,
      );
    },
  };
}
