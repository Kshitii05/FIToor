import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLACE_LOOKUP_MIN_INTERVAL_MS, SAVED_LOCATIONS_MAX } from '../../config/policy.js';
import { createTestContext, db, registerUser, resetDb } from '../../../test/helpers.js';
import { createPlaceLookup } from './places.service.js';

const API = '/api/v1';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const HOME = { label: 'Home', locality: 'Indiranagar', lat: 12.9784, lng: 77.6408 };
const WORK = { label: 'Work', locality: 'Whitefield', lat: 12.9698, lng: 77.75 };

const save = (ctx, account, place) =>
  request(ctx.app).post(`${API}/me/locations`).set(account.bearer).send(place);
const list = async (ctx, account) =>
  (await request(ctx.app).get(`${API}/me/locations`).set(account.bearer)).body.items;

describe('saved locations', () => {
  it('saves places, making the first one the default', async () => {
    const ctx = createTestContext();
    const user = await registerUser(ctx);

    const home = await save(ctx, user, HOME);
    const work = await save(ctx, user, WORK);

    expect(home.status).toBe(201);
    expect(home.body.location).toMatchObject({ ...HOME, isDefault: true });
    expect(work.body.location.isDefault).toBe(false);
    expect((await list(ctx, user)).map((l) => [l.label, l.isDefault])).toEqual([
      ['Home', true],
      ['Work', false],
    ]);
  });

  it('keeps exactly one default', async () => {
    const ctx = createTestContext();
    const user = await registerUser(ctx);
    await save(ctx, user, HOME);
    const work = (await save(ctx, user, { ...WORK, isDefault: true })).body.location;

    expect((await list(ctx, user)).filter((l) => l.isDefault).map((l) => l.label)).toEqual([
      'Work',
    ]);

    const unset = await request(ctx.app)
      .patch(`${API}/me/locations/${work.id}`)
      .set(user.bearer)
      .send({ isDefault: false });
    expect(unset.status).toBe(409);

    const home = (await list(ctx, user)).find((l) => l.label === 'Home');
    await request(ctx.app)
      .patch(`${API}/me/locations/${home.id}`)
      .set(user.bearer)
      .send({ isDefault: true });
    expect((await list(ctx, user)).filter((l) => l.isDefault).map((l) => l.label)).toEqual([
      'Home',
    ]);
  });

  it('renames and moves a place', async () => {
    const ctx = createTestContext();
    const user = await registerUser(ctx);
    const home = (await save(ctx, user, HOME)).body.location;

    const res = await request(ctx.app)
      .patch(`${API}/me/locations/${home.id}`)
      .set(user.bearer)
      .send({ label: 'New home', lat: 12.93, lng: 77.62, locality: 'Koramangala' });

    expect(res.status).toBe(200);
    expect(res.body.location).toMatchObject({
      label: 'New home',
      locality: 'Koramangala',
      lat: 12.93,
      lng: 77.62,
      isDefault: true,
    });
    const halfMove = await request(ctx.app)
      .patch(`${API}/me/locations/${home.id}`)
      .set(user.bearer)
      .send({ lat: 12.9 });
    expect(halfMove.status).toBe(400);
  });

  it('hands the default to the oldest remaining place when it is removed', async () => {
    const ctx = createTestContext();
    const user = await registerUser(ctx);
    const home = (await save(ctx, user, HOME)).body.location;
    ctx.clock.advance({ minutes: 1 });
    await save(ctx, user, WORK);
    ctx.clock.advance({ minutes: 1 });
    await save(ctx, user, { ...HOME, label: 'Gym' });

    const res = await request(ctx.app).delete(`${API}/me/locations/${home.id}`).set(user.bearer);

    expect(res.status).toBe(204);
    expect((await list(ctx, user)).map((l) => [l.label, l.isDefault])).toEqual([
      ['Work', true],
      ['Gym', false],
    ]);
  });

  it('allows at most 5', async () => {
    const ctx = createTestContext();
    const user = await registerUser(ctx);
    for (let i = 1; i <= SAVED_LOCATIONS_MAX; i += 1) {
      expect((await save(ctx, user, { ...HOME, label: `Place ${i}` })).status).toBe(201);
    }

    const extra = await save(ctx, user, { ...HOME, label: 'One too many' });

    expect(extra.status).toBe(409);
    expect(extra.body.error.code).toBe('TOO_MANY_LOCATIONS');
  });

  it.each([
    ['a place outside India', { ...HOME, lat: 48.85, lng: 2.35 }],
    ['no name', { ...HOME, label: ' ' }],
    ['no area name', { ...HOME, locality: '' }],
    ['coordinates as text', { ...HOME, lat: '12.97' }],
    ['an unknown field', { ...HOME, userId: 'x' }],
  ])('rejects %s', async (_label, place) => {
    const ctx = createTestContext();
    const user = await registerUser(ctx);
    expect((await save(ctx, user, place)).status).toBe(400);
  });

  it('is private: only the owner can see, change or remove their places', async () => {
    const ctx = createTestContext();
    const owner = await registerUser(ctx);
    const other = await registerUser(ctx);
    const home = (await save(ctx, owner, HOME)).body.location;
    const url = `${API}/me/locations/${home.id}`;

    expect(await list(ctx, other)).toEqual([]);
    expect(
      (await request(ctx.app).patch(url).set(other.bearer).send({ label: 'Mine' })).status,
    ).toBe(404);
    expect((await request(ctx.app).delete(url).set(other.bearer)).status).toBe(404);
    expect((await request(ctx.app).get(`${API}/me/locations`)).status).toBe(401);

    // Not visible anywhere public either.
    const profile = await request(ctx.app).get(`${API}/users/${owner.user.id}`);
    expect(JSON.stringify(profile.body)).not.toContain(String(HOME.lat));
    expect((await list(ctx, owner))[0].label).toBe('Home');
  });
});

describe('place search endpoints', () => {
  it('returns matching places and area names through the place service', async () => {
    const ctx = createTestContext();

    const found = await request(ctx.app).get(`${API}/places/search?q=indiranagar`);
    const named = await request(ctx.app).get(`${API}/places/reverse?lat=12.9784&lng=77.6408`);

    expect(found.status).toBe(200);
    expect(found.body.items[0]).toMatchObject({ locality: 'Indiranagar', pincode: '560038' });
    expect(named.body.place).toMatchObject({ locality: 'Indiranagar', city: 'Bengaluru' });
    expect(ctx.placeLookup.calls).toEqual([
      { search: 'indiranagar' },
      { reverse: { lat: 12.9784, lng: 77.6408 } },
    ]);
  });

  it('rejects too-short searches and points outside India', async () => {
    const ctx = createTestContext();

    expect((await request(ctx.app).get(`${API}/places/search?q=a`)).status).toBe(400);
    expect((await request(ctx.app).get(`${API}/places/reverse?lat=48.8&lng=2.3`)).status).toBe(400);
    expect(ctx.placeLookup.calls).toEqual([]);
  });
});

describe('the place service', () => {
  const nominatimResult = (overrides = {}) => ({
    lat: '12.9783692',
    lon: '77.6408356',
    name: 'Indiranagar',
    address: { suburb: 'Indiranagar', city: 'Bengaluru', postcode: '560038', state: 'Karnataka' },
    ...overrides,
  });

  function setup(responses) {
    const requests = [];
    const memory = new Map();
    let time = 0;
    const sleeps = [];
    const lookup = createPlaceLookup({
      fetchFn: async (url, options) => {
        requests.push({ url: new URL(url), headers: options.headers });
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return { ok: next.ok ?? true, status: next.status ?? 200, json: async () => next.body };
      },
      cache: {
        get: async (key) => (memory.has(key) ? memory.get(key) : null),
        set: async (key, value) => void memory.set(key, value),
      },
      logger: { error: vi.fn() },
      now: () => time,
      sleep: async (ms) => {
        sleeps.push(ms);
        time += ms;
      },
    });
    return { lookup, requests, sleeps };
  }

  it('asks for places in India only, identifies itself, and shapes the results', async () => {
    const { lookup, requests } = setup([
      {
        body: [
          nominatimResult(),
          nominatimResult(), // a duplicate
          nominatimResult({
            lat: '51.5',
            lon: '-0.12',
            address: { suburb: 'Soho', city: 'London' },
          }),
        ],
      },
    ]);

    const places = await lookup.search('  Indiranagar ');

    expect(places).toEqual([
      {
        locality: 'Indiranagar',
        city: 'Bengaluru',
        pincode: '560038',
        label: 'Indiranagar, Bengaluru',
        lat: 12.97837,
        lng: 77.64084,
      },
    ]);
    const { url, headers } = requests[0];
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('indiranagar');
    expect(url.searchParams.get('countrycodes')).toBe('in');
    expect(headers['User-Agent']).toMatch(/^\S+\/0\.1 \(/);
  });

  it('answers repeated questions from its cache', async () => {
    const { lookup, requests } = setup([{ body: [nominatimResult()] }]);

    await lookup.search('Indiranagar');
    const again = await lookup.search('indiranagar');

    expect(requests).toHaveLength(1);
    expect(again[0].locality).toBe('Indiranagar');
  });

  it('waits at least the minimum interval between requests', async () => {
    const { lookup, sleeps } = setup([
      { body: [nominatimResult()] },
      { body: [nominatimResult({ address: { suburb: 'Koramangala', city: 'Bengaluru' } })] },
    ]);

    await Promise.all([lookup.search('indiranagar'), lookup.search('koramangala')]);

    expect(sleeps).toEqual([PLACE_LOOKUP_MIN_INTERVAL_MS]);
  });

  it('rounds a position to about 100 m before sending it', async () => {
    const { lookup, requests } = setup([
      { body: { address: { suburb: 'Indiranagar', city: 'Bengaluru' } } },
    ]);

    const place = await lookup.reverse({ lat: 12.978369, lng: 77.640836 });

    expect(place).toEqual({
      locality: 'Indiranagar',
      city: 'Bengaluru',
      label: 'Indiranagar, Bengaluru',
    });
    expect(requests[0].url.searchParams.get('lat')).toBe('12.978');
    expect(requests[0].url.searchParams.get('lon')).toBe('77.641');
  });

  it('reports the service as unavailable when it fails', async () => {
    const { lookup } = setup([new Error('network down'), { ok: false, status: 429, body: {} }]);

    await expect(lookup.search('indiranagar')).rejects.toMatchObject({ status: 503 });
    await expect(lookup.search('koramangala')).rejects.toMatchObject({
      code: 'PLACES_UNAVAILABLE',
    });
  });
});
