import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, db, registerUser, resetDb } from '../../../test/helpers.js';

const API = '/api/v1';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe('own account', () => {
  it('returns the signed-in user', async () => {
    const ctx = createTestContext();
    const { details, user, bearer } = await registerUser(ctx);

    const res = await request(ctx.app).get(`${API}/me`).set(bearer);

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual(user);
    expect(res.body.user.email).toBe(details.email);
  });

  it('updates profile details, trimming text and clearing fields sent empty', async () => {
    const ctx = createTestContext();
    const { bearer } = await registerUser(ctx);

    const set = await request(ctx.app).patch(`${API}/me/profile`).set(bearer).send({
      displayName: '  Asha K  ',
      bio: 'Vintage saris and jackets',
      locality: 'Indiranagar',
    });
    expect(set.status).toBe(200);
    expect(set.body.user.profile).toEqual({
      displayName: 'Asha K',
      bio: 'Vintage saris and jackets',
      photoUrl: null,
      locality: 'Indiranagar',
    });

    const cleared = await request(ctx.app).patch(`${API}/me/profile`).set(bearer).send({ bio: '' });
    expect(cleared.body.user.profile.bio).toBeNull();
    expect(cleared.body.user.profile.locality).toBe('Indiranagar');
  });

  it('rejects profile changes that are empty, invalid or touch other fields', async () => {
    const ctx = createTestContext();
    const { bearer } = await registerUser(ctx);
    const patch = (body) => request(ctx.app).patch(`${API}/me/profile`).set(bearer).send(body);

    expect((await patch({})).status).toBe(400);
    expect((await patch({ displayName: 'A' })).status).toBe(400);
    expect((await patch({ bio: 'x'.repeat(501) })).status).toBe(400);
    expect((await patch({ email: 'other@example.com' })).status).toBe(400);
    expect((await patch({ photoUrl: 'https://example.com/a.png' })).status).toBe(400);
  });

  it('one user cannot change another user’s profile', async () => {
    const ctx = createTestContext();
    const asha = await registerUser(ctx);
    const ravi = await registerUser(ctx);

    await request(ctx.app).patch(`${API}/me/profile`).set(ravi.bearer).send({ bio: 'Ravi here' });

    const res = await request(ctx.app).get(`${API}/me`).set(asha.bearer);
    expect(res.body.user.profile.bio).toBeNull();
  });

  it('reads and updates notification preferences', async () => {
    const ctx = createTestContext();
    const { bearer } = await registerUser(ctx);

    const initial = await request(ctx.app).get(`${API}/me/preferences`).set(bearer);
    expect(initial.body.preferences).toEqual({
      emailNotifications: true,
      inAppNotifications: true,
    });

    const updated = await request(ctx.app)
      .patch(`${API}/me/preferences`)
      .set(bearer)
      .send({ emailNotifications: false });
    expect(updated.status).toBe(200);
    expect(updated.body.preferences).toEqual({
      emailNotifications: false,
      inAppNotifications: true,
    });

    const invalid = await request(ctx.app)
      .patch(`${API}/me/preferences`)
      .set(bearer)
      .send({ emailNotifications: 'no' });
    expect(invalid.status).toBe(400);
  });

  it('requires sign-in for every /me route', async () => {
    const ctx = createTestContext();

    expect((await request(ctx.app).get(`${API}/me`)).status).toBe(401);
    expect((await request(ctx.app).patch(`${API}/me/profile`).send({ bio: 'x' })).status).toBe(401);
    expect((await request(ctx.app).get(`${API}/me/preferences`)).status).toBe(401);
    expect((await request(ctx.app).patch(`${API}/me/preferences`).send({})).status).toBe(401);
    expect((await request(ctx.app).post(`${API}/me/deletion`).send({})).status).toBe(401);
  });
});

describe('public profile', () => {
  it('shows only public fields: no email, phone, address or coordinates', async () => {
    const ctx = createTestContext();
    const { details, user, bearer } = await registerUser(ctx);
    await request(ctx.app)
      .patch(`${API}/me/profile`)
      .set(bearer)
      .send({ bio: 'Hello', locality: 'Indiranagar' });

    const res = await request(ctx.app).get(`${API}/users/${user.id}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.user).sort()).toEqual(
      ['bio', 'displayName', 'id', 'locality', 'memberSince', 'photoUrl'].sort(),
    );
    expect(res.body.user).toMatchObject({
      id: user.id,
      displayName: details.displayName,
      bio: 'Hello',
      locality: 'Indiranagar',
    });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(details.email);
    expect(body).not.toContain(details.phone);
    expect(body).not.toContain(details.phone.slice(3));
  });

  it('returns 404 for an unknown user and 400 for a malformed id', async () => {
    const ctx = createTestContext();

    const unknown = await request(ctx.app).get(`${API}/users/00000000-0000-4000-8000-000000000000`);
    const malformed = await request(ctx.app).get(`${API}/users/not-a-uuid`);

    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(400);
  });
});
