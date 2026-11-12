import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { APP_NAME } from '../../config/app.js';
import { createFixedClock } from '../../lib/clock.js';
import { db } from '../../lib/db.js';

afterAll(async () => {
  await db.$disconnect();
});

describe('GET /api/v1/health', () => {
  it('reports ok with the app name, the clock time and a live database', async () => {
    const clock = createFixedClock('2026-11-13T06:30:00.000Z');
    const app = createApp({ clock });

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      app: APP_NAME,
      time: '2026-11-13T06:30:00.000Z',
      checks: { database: 'up' },
    });
  });

  it('runs against the test database with PostGIS and btree_gist installed', async () => {
    const [{ name }] = await db.$queryRaw`SELECT current_database() AS name`;
    expect(name).toBe('marketplace_test');

    const rows = await db.$queryRaw`
      SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'btree_gist') ORDER BY extname`;
    expect(rows.map((row) => row.extname)).toEqual(['btree_gist', 'postgis']);
  });

  it('reports degraded with 503 when the database is unreachable', async () => {
    const brokenDb = {
      $queryRaw: async () => {
        throw new Error('connection refused');
      },
    };
    const app = createApp({ db: brokenDb });

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks).toEqual({ database: 'down' });
  });
});
