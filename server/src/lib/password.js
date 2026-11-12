import bcrypt from 'bcrypt';
import { BCRYPT_COST } from '../config/security.js';

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

// Compared against when no account matches, so a login attempt for an unknown
// email takes about as long as one for a real account.
const dummyHash = bcrypt.hashSync('no-such-account', BCRYPT_COST);

export async function burnPasswordCheck(password) {
  await bcrypt.compare(password, dummyHash);
}
