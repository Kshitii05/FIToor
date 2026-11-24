import crypto from 'node:crypto';
import { env } from '../config/env.js';

// Encrypts small secrets at rest, such as seller bank account numbers (I14):
// AES-256-GCM with a random 12-byte nonce, so the same number never encrypts to the
// same text and any tampering fails to decrypt. The key comes from BANK_DETAILS_KEY.

const VERSION = 'v1';

function keyFrom(secret) {
  return crypto.createHash('sha256').update(`bank-details:${secret}`).digest();
}

export function createSecretBox(secret = env.BANK_DETAILS_KEY) {
  const key = keyFrom(secret);
  return {
    seal(plain) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
      const sealed = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, nonce, tag, sealed]
        .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
        .join('.');
    },
    open(text) {
      const [version, nonce, tag, sealed] = text.split('.');
      if (version !== VERSION) throw new Error('Unknown sealed value version');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(sealed, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}
