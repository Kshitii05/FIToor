// Gives an existing account the admin role.
//
//   npm run make-admin --workspace server -- someone@example.com
//
// Admin actions are checked on the server and written to the admin audit log.

import { db } from '../src/lib/db.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run make-admin --workspace server -- <email>');
  process.exit(1);
}

try {
  const { count } = await db.user.updateMany({
    where: { email, status: 'ACTIVE' },
    data: { role: 'ADMIN' },
  });
  console.log(
    count === 1 ? `${email} is now an admin.` : `No active account with the email ${email}.`,
  );
  process.exitCode = count === 1 ? 0 : 1;
} finally {
  await db.$disconnect();
}
