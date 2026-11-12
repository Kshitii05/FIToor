import { Router } from 'express';
import { APP_NAME } from '../../config/app.js';

export function createHealthRouter({ db, clock }) {
  const router = Router();

  router.get('/', async (_req, res) => {
    let database = 'up';
    try {
      await db.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    const healthy = database === 'up';
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      app: APP_NAME,
      time: clock.now().toISOString(),
      checks: { database },
    });
  });

  return router;
}
