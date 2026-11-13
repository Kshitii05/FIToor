import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { publicPoint } from '../../lib/geo.js';
import {
  createTestContext,
  db,
  registerUser,
  registerVerifiedUser,
  resetDb,
} from '../../../test/helpers.js';
import {
  createListing,
  INDIRANAGAR,
  insertListing,
  postListing,
  saleDetails,
} from '../../../test/listings.js';

const API = '/api/v1';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

// The search origin sits on a grid centre in central Bengaluru; listings are placed
// due north of it at known distances. One degree of latitude is about 111.32 km.
const ORIGIN = publicPoint({ lat: 12.9716, lng: 77.5946 });
const north = (km, locality = `Area ${km} km`) => ({
  lat: ORIGIN.lat + km / 111.32,
  lng: ORIGIN.lng,
  locality,
});
const near = (query = '') => `lat=${ORIGIN.lat}&lng=${ORIGIN.lng}${query}`;
const titles = (res) => res.body.items.map((listing) => listing.title);

async function spread(ctx) {
  const seller = await registerVerifiedUser(ctx);
  for (const km of [1, 4, 8, 20, 40, 60]) {
    await insertListing(seller, { title: `At ${km} km`, location: north(km) });
  }
  await insertListing(seller, { title: 'No location' });
  return seller;
}

describe('listing locations', () => {
  it('stores the pin for the seller and shows everyone else only the grid centre', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const visitor = await registerUser(ctx);
    const pin = { lat: 12.97194, lng: 77.64115 };

    const created = await postListing(
      ctx,
      seller,
      saleDetails({ location: { ...pin, locality: 'Indiranagar' } }),
    );
    expect(created.status).toBe(201);
    expect(created.body.listing.pin).toEqual(pin);

    const shown = publicPoint(pin);
    expect(created.body.listing.location).toEqual({ ...shown, locality: 'Indiranagar' });

    for (const account of [null, visitor]) {
      const req = request(ctx.app).get(`${API}/listings/${created.body.listing.id}`);
      const res = await (account ? req.set(account.bearer) : req);
      expect(res.body.listing.location).toEqual({ ...shown, locality: 'Indiranagar' });
      expect(res.body.listing).not.toHaveProperty('pin');
      expect(JSON.stringify(res.body)).not.toContain(String(pin.lat));
      expect(JSON.stringify(res.body)).not.toContain(String(pin.lng));
    }
  });

  it('is required for a new listing, and must be in India', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const send = (location) => postListing(ctx, seller, saleDetails({ location }));

    expect((await send(undefined)).status).toBe(400);
    expect((await send({ lat: 51.5, lng: -0.12, locality: 'London' })).status).toBe(400);
    expect((await send({ lat: 12.97, lng: 77.64, locality: '' })).status).toBe(400);
    expect((await send({ lat: '12.97', lng: 77.64, locality: 'Indiranagar' })).status).toBe(400);
    expect(await db.listing.count()).toBe(0);
  });

  it('can be moved, and the public point follows', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller);
    const moved = { lat: 12.93518, lng: 77.62448, locality: 'Koramangala' };

    const res = await request(ctx.app)
      .patch(`${API}/listings/${listing.id}`)
      .set(seller.bearer)
      .send({ location: moved });

    expect(res.status).toBe(200);
    expect(res.body.listing.pin).toEqual({ lat: moved.lat, lng: moved.lng });
    expect(res.body.listing.location).toEqual({ ...publicPoint(moved), locality: 'Koramangala' });
    const found = await request(ctx.app).get(
      `${API}/listings?lat=${moved.lat}&lng=${moved.lng}&radiusKm=2`,
    );
    expect(found.body.items.map((item) => item.id)).toEqual([listing.id]);
  });

  it('is refused by the database when incomplete or outside India', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);

    await expect(insertListing(seller, { pinLat: 12.97, pinLng: 77.64 })).rejects.toThrow(
      /listings_location_check/,
    );
    await expect(
      insertListing(seller, { location: { lat: 40.7, lng: -74, locality: 'New York' } }),
    ).rejects.toThrow(/listings_location_check/);
  });
});

describe('privacy of locations in every public list', () => {
  it('never exposes a pin from search, home, a seller’s list or liked listings', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const viewer = await registerUser(ctx);
    const pin = { lat: 12.97194, lng: 77.64115 };
    const listing = await createListing(
      ctx,
      seller,
      saleDetails({ location: { ...pin, locality: 'Indiranagar' } }),
    );
    await request(ctx.app).put(`${API}/listings/${listing.id}/like`).set(viewer.bearer);

    const responses = await Promise.all([
      request(ctx.app).get(`${API}/listings`),
      request(ctx.app).get(`${API}/listings?lat=12.97&lng=77.64&radiusKm=5&sort=nearest`),
      request(ctx.app).get(`${API}/listings/${listing.id}?lat=12.97&lng=77.64`),
      request(ctx.app).get(`${API}/home?lat=12.97&lng=77.64`),
      request(ctx.app).get(`${API}/users/${seller.user.id}/listings`),
      request(ctx.app).get(`${API}/me/likes`).set(viewer.bearer),
      request(ctx.app).get(`${API}/home`).set(viewer.bearer),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(String(publicPoint(pin).lat));
      expect(body).not.toContain(String(pin.lat));
      expect(body).not.toContain(String(pin.lng));
      expect(body).not.toMatch(/"pin"|pinLat|pin_lat|public_location/);
    }
  });

  it('gives the same position and distances for two listings in one square, wherever you search from', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const centre = publicPoint(INDIRANAGAR);
    // Two pins about 400 m apart inside the same square.
    await insertListing(seller, {
      title: 'A',
      location: { lat: centre.lat - 0.0018, lng: centre.lng - 0.0018, locality: 'Indiranagar' },
    });
    await insertListing(seller, {
      title: 'B',
      location: { lat: centre.lat + 0.0018, lng: centre.lng + 0.0018, locality: 'Indiranagar' },
    });

    const origins = [
      { lat: 12.95, lng: 77.6 },
      { lat: 12.99, lng: 77.66 },
      { lat: centre.lat, lng: centre.lng + 0.02 },
      { lat: centre.lat + 0.0018, lng: centre.lng + 0.0018 }, // standing on pin B
    ];
    for (const origin of origins) {
      const res = await request(ctx.app).get(`${API}/listings?lat=${origin.lat}&lng=${origin.lng}`);
      const [a, b] = ['A', 'B'].map((title) => res.body.items.find((item) => item.title === title));
      expect(a.location).toEqual(b.location);
      expect(a.distanceKm).toBe(b.distanceKm);
    }
  });
});

describe('nearby search', () => {
  it.each([
    [2, ['At 1 km']],
    [5, ['At 1 km', 'At 4 km']],
    [10, ['At 1 km', 'At 4 km', 'At 8 km']],
    [25, ['At 1 km', 'At 4 km', 'At 8 km', 'At 20 km']],
    [50, ['At 1 km', 'At 4 km', 'At 8 km', 'At 20 km', 'At 40 km']],
  ])('within %s km', async (radius, expected) => {
    const ctx = createTestContext();
    await spread(ctx);

    const res = await request(ctx.app).get(
      `${API}/listings?${near(`&radiusKm=${radius}&sort=nearest`)}`,
    );

    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(expected);
    expect(res.body.total).toBe(expected.length);
  });

  it('shows distances rounded up to the next half kilometre, and at least 0.5 km', async () => {
    const ctx = createTestContext();
    const seller = await spread(ctx);
    await insertListing(seller, { title: 'Next door', location: { ...ORIGIN, locality: 'Here' } });

    const res = await request(ctx.app).get(`${API}/listings?${near('&sort=nearest')}`);
    const distance = Object.fromEntries(
      res.body.items.map((item) => [item.title, item.distanceKm]),
    );

    expect(distance['Next door']).toBe(0.5);
    for (const km of [1, 4, 8, 20, 40, 60]) {
      const shown = distance[`At ${km} km`];
      expect(shown * 2).toBe(Math.round(shown * 2));
      expect(shown).toBeGreaterThanOrEqual(km - 0.5);
      expect(shown).toBeLessThanOrEqual(km + 0.5);
    }
    expect(distance['No location']).toBeNull();
  });

  it('sorts nearest first, with listings without a location last', async () => {
    const ctx = createTestContext();
    await spread(ctx);

    const res = await request(ctx.app).get(`${API}/listings?${near('&sort=nearest')}`);

    expect(titles(res)).toEqual([
      'At 1 km',
      'At 4 km',
      'At 8 km',
      'At 20 km',
      'At 40 km',
      'At 60 km',
      'No location',
    ]);
  });

  it('combines distance with keywords and other filters', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    await insertListing(seller, {
      title: 'Silk kurta near',
      location: north(1),
      category: 'ETHNIC_WEAR',
    });
    await insertListing(seller, {
      title: 'Silk kurta far',
      location: north(30),
      category: 'ETHNIC_WEAR',
    });
    await insertListing(seller, {
      title: 'Leather bag near',
      location: north(1),
      category: 'BAGS',
    });

    const res = await request(ctx.app).get(`${API}/listings?${near('&radiusKm=10&q=kurta')}`);

    expect(titles(res)).toEqual(['Silk kurta near']);
    expect(res.body.facets.brands).toEqual([{ value: 'Generic', count: 1 }]);
  });

  it('says whether the seller delivers that far, and can show only those', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const delivery = (radiusKm) => ({
      offersDelivery: true,
      deliveryChargePaise: 0,
      deliveryRadiusKm: radiusKm,
    });
    await insertListing(seller, {
      title: 'Delivers 5 km, at 4 km',
      location: north(4),
      ...delivery(5),
    });
    await insertListing(seller, {
      title: 'Delivers 5 km, at 8 km',
      location: north(8),
      ...delivery(5),
    });
    await insertListing(seller, { title: 'Pickup only, at 1 km', location: north(1) });

    const all = await request(ctx.app).get(`${API}/listings?${near('&sort=nearest')}`);
    const delivers = Object.fromEntries(
      all.body.items.map((item) => [item.title, item.deliversToYou]),
    );
    expect(delivers).toEqual({
      'Pickup only, at 1 km': false,
      'Delivers 5 km, at 4 km': true,
      'Delivers 5 km, at 8 km': false,
    });

    const filtered = await request(ctx.app).get(`${API}/listings?${near('&deliversToMe=true')}`);
    expect(titles(filtered)).toEqual(['Delivers 5 km, at 4 km']);
  });

  it('gives no distances without an origin, and refuses distance features without one', async () => {
    const ctx = createTestContext();
    await spread(ctx);

    const plain = await request(ctx.app).get(`${API}/listings`);
    expect(plain.body.origin).toBeNull();
    expect(plain.body.items.every((item) => item.distanceKm === null)).toBe(true);

    for (const query of ['radiusKm=5', 'sort=nearest', 'deliversToMe=true']) {
      const res = await request(ctx.app).get(`${API}/listings?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('LOCATION_REQUIRED');
    }
  });

  it.each([
    ['lat without lng', 'lat=12.97'],
    ['a point outside India', 'lat=51.5&lng=-0.12'],
    ['a radius that is not offered', `${near('&radiusKm=3')}`],
    ['a malformed saved location', 'locationId=home'],
  ])('rejects %s', async (_label, query) => {
    const ctx = createTestContext();
    const res = await request(ctx.app).get(`${API}/listings?${query}`);
    expect(res.status).toBe(400);
  });

  it('describes the origin without echoing coordinates', async () => {
    const ctx = createTestContext();
    await spread(ctx);

    const res = await request(ctx.app).get(`${API}/listings?${near()}`);

    expect(res.body.origin).toEqual({ source: 'device', label: null });
  });
});

describe('searching around saved locations', () => {
  async function saveLocation(ctx, account, place) {
    const res = await request(ctx.app).post(`${API}/me/locations`).set(account.bearer).send(place);
    expect(res.status).toBe(201);
    return res.body.location;
  }

  it('uses the default saved location when nothing else is given', async () => {
    const ctx = createTestContext();
    await spread(ctx);
    const user = await registerUser(ctx);
    await saveLocation(ctx, user, { label: 'Home', ...ORIGIN, locality: 'Centre' });

    const res = await request(ctx.app)
      .get(`${API}/listings?radiusKm=5&sort=nearest`)
      .set(user.bearer);

    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(['At 1 km', 'At 4 km']);
    expect(res.body.origin).toEqual({ source: 'saved', label: 'Home' });
  });

  it('uses a chosen saved location, and a device position over the default', async () => {
    const ctx = createTestContext();
    await spread(ctx);
    const user = await registerUser(ctx);
    await saveLocation(ctx, user, { label: 'Home', ...ORIGIN, locality: 'Centre' });
    const work = await saveLocation(ctx, user, { label: 'Work', ...north(40), locality: 'Far' });

    const atWork = await request(ctx.app)
      .get(`${API}/listings?locationId=${work.id}&radiusKm=2`)
      .set(user.bearer);
    expect(titles(atWork)).toEqual(['At 40 km']);

    const device = north(20);
    const here = await request(ctx.app)
      .get(`${API}/listings?lat=${device.lat}&lng=${device.lng}&radiusKm=2`)
      .set(user.bearer);
    expect(titles(here)).toEqual(['At 20 km']);
  });

  it('cannot use someone else’s saved location, or one while signed out', async () => {
    const ctx = createTestContext();
    const owner = await registerUser(ctx);
    const other = await registerUser(ctx);
    const home = await saveLocation(ctx, owner, { label: 'Home', ...ORIGIN, locality: 'Centre' });

    const byOther = await request(ctx.app)
      .get(`${API}/listings?locationId=${home.id}`)
      .set(other.bearer);
    const signedOut = await request(ctx.app).get(`${API}/listings?locationId=${home.id}`);

    expect(byOther.status).toBe(404);
    expect(signedOut.status).toBe(401);
  });
});

describe('location on the home page and listing page', () => {
  it('limits Trending Near You to 10 km when there is an origin, and adds distances', async () => {
    const ctx = createTestContext();
    await spread(ctx);

    const visitor = await request(ctx.app).get(`${API}/home`);
    const trendingEverywhere = visitor.body.sections.find((s) => s.key === 'trending');
    expect(trendingEverywhere.items).toHaveLength(7);

    const nearby = await request(ctx.app).get(`${API}/home?${near()}`);
    const trending = nearby.body.sections.find((s) => s.key === 'trending');
    expect(trending.items.map((l) => l.title).sort()).toEqual(['At 1 km', 'At 4 km', 'At 8 km']);
    expect(trending.items.every((l) => typeof l.distanceKm === 'number')).toBe(true);
    const recent = nearby.body.sections.find((s) => s.key === 'recent');
    expect(recent.items).toHaveLength(7);
    expect(nearby.body.origin).toEqual({ source: 'device', label: null });
  });

  it('shows the distance on the listing page when an origin is given', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await insertListing(seller, { location: north(4) });

    const withOrigin = await request(ctx.app).get(`${API}/listings/${listing.id}?${near()}`);
    const without = await request(ctx.app).get(`${API}/listings/${listing.id}`);

    expect(withOrigin.body.listing.distanceKm).toBeGreaterThanOrEqual(3.5);
    expect(withOrigin.body.listing.distanceKm).toBeLessThanOrEqual(4.5);
    expect(without.body.listing.distanceKm).toBeNull();
  });
});
