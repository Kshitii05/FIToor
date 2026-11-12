import { createApp } from './app.js';
import { APP_NAME } from './config/app.js';
import { env } from './config/env.js';
import { db } from './lib/db.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`${APP_NAME} API listening on http://localhost:${env.PORT}`);
});

async function shutdown() {
  server.close();
  await db.$disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
