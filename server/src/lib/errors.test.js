import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from '../app.js';
import { AppError } from './errors.js';

function appWith(configureRoutes, logger = { error: vi.fn() }) {
  return createApp({ configureRoutes, logger });
}

describe('central error handling', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(appWith()).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'No route for GET /api/v1/does-not-exist' },
    });
  });

  it('maps AppError to its status, code and details', async () => {
    const app = appWith((api) => {
      api.get('/boom', () => {
        throw AppError.conflict('Already taken', { field: 'email' });
      });
    });

    const res = await request(app).get('/api/v1/boom');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'CONFLICT', message: 'Already taken', details: { field: 'email' } },
    });
  });

  it('maps validation errors to 400 with field details', async () => {
    const app = appWith((api) => {
      api.post('/validate', (req, res) => {
        res.json(z.object({ quantity: z.number().int().positive() }).parse(req.body));
      });
    });

    const res = await request(app).post('/api/v1/validate').send({ quantity: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toHaveLength(1);
    expect(res.body.error.details[0].path).toBe('quantity');
  });

  it('returns 400 for malformed JSON bodies', async () => {
    const res = await request(appWith())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('hides the details of unexpected errors, including rejected async handlers', async () => {
    const logger = { error: vi.fn() };
    const app = appWith((api) => {
      api.get('/crash', async () => {
        throw new Error('secret database detail');
      });
    }, logger);

    const res = await request(app).get('/api/v1/crash');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
