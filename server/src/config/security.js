import { env } from './env.js';

// bcrypt work factor. Tests use the minimum so the suite stays fast.
export const BCRYPT_COST = env.NODE_ENV === 'test' ? 4 : 12;

export const REFRESH_COOKIE_NAME = 'refresh_token';
