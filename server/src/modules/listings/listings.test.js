import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  db,
  registerUser,
  registerVerifiedUser,
  resetDb,
} from '../../../test/helpers.js';
import { createListing, postListing, rentDetails, saleDetails } from '../../../test/listings.js';

const API = '/api/v1';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe('creating a listing', () => {
  it('publishes a sale listing straight away', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);

    const res = await postListing(ctx, seller, saleDetails());

    expect(res.status).toBe(201);
    expect(res.body.listing).toMatchObject({
      mode: 'SALE',
      status: 'ACTIVE',
      available: true,
      title: 'Block-print cotton kurta',
      category: 'ETHNIC_WEAR',
      condition: 'GOOD',
      brand: 'Fabindia',
      size: 'M',
      colour: 'Indigo',
      sale: { pricePaise: 120000, quantity: 1 },
      rent: null,
      delivery: { chargePaise: 8000, radiusKm: 10 },
      pickup: true,
      seller: { id: seller.user.id, displayName: seller.details.displayName },
    });
    expect(res.body.listing.images).toHaveLength(1);
    expect(res.body.listing.images[0]).toMatchObject({ position: 0 });

    const events = await db.listingStatusEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'CREATED',
      toStatus: 'ACTIVE',
      actorUserId: seller.user.id,
    });
  });

  it('publishes a rent listing with its packages, deposit and late fee', async () => {
    const ctx = createTestContext();
    const owner = await registerVerifiedUser(ctx);

    const res = await postListing(ctx, owner, rentDetails());

    expect(res.status).toBe(201);
    expect(res.body.listing).toMatchObject({
      mode: 'RENT',
      sale: null,
      delivery: null,
      pickup: true,
      rent: { depositPaise: 1000000, lateFeePerDayPaise: 50000 },
    });
    expect(
      res.body.listing.rent.packages.map(({ durationDays, pricePaise }) => [
        durationDays,
        pricePaise,
      ]),
    ).toEqual([
      [1, 250000],
      [3, 600000],
      [7, 1200000],
    ]);
  });

  it('accepts custom package durations alongside the presets', async () => {
    const ctx = createTestContext();
    const owner = await registerVerifiedUser(ctx);

    const listing = await createListing(
      ctx,
      owner,
      rentDetails({
        packages: [
          { durationDays: 5, pricePaise: 900000 },
          { durationDays: 1, pricePaise: 250000 },
        ],
      }),
    );

    expect(listing.rent.packages.map((p) => p.durationDays)).toEqual([1, 5]);
  });

  it('defaults the quantity of a sale listing to 1', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const details = saleDetails();
    delete details.quantity;

    const listing = await createListing(ctx, seller, details);

    expect(listing.sale.quantity).toBe(1);
  });

  it('requires sign-in and a verified account', async () => {
    const ctx = createTestContext();
    const unverified = await registerUser(ctx);

    const anonymous = await request(ctx.app)
      .post(`${API}/listings`)
      .field('data', JSON.stringify(saleDetails()));
    const refused = await postListing(ctx, unverified, saleDetails());

    expect(anonymous.status).toBe(401);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('VERIFICATION_REQUIRED');
    expect(await db.listing.count()).toBe(0);
    expect(ctx.imageStorage.stored.size).toBe(0);
  });

  it.each([
    ['title', { title: 'abc' }],
    ['description', { description: 'too short' }],
    ['brand', { brand: ' ' }],
    ['size', { size: '' }],
    ['colour', { colour: '' }],
    ['condition', { condition: 'USED' }],
    ['category', { category: 'ELECTRONICS' }],
    ['pricePaise', { pricePaise: undefined }],
  ])('rejects a listing with a missing or invalid %s', async (field, overrides) => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);

    const res = await postListing(ctx, seller, saleDetails(overrides));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.path)).toContain(field);
    expect(await db.listing.count()).toBe(0);
  });

  it.each([
    ['a fractional amount', { pricePaise: 1200.5 }],
    ['an amount sent as text', { pricePaise: '120000' }],
    ['a price under ₹1', { pricePaise: 99 }],
    ['a price over ₹5,00,000', { pricePaise: 50000001 }],
    ['a zero quantity', { quantity: 0 }],
    ['a quantity over 99', { quantity: 100 }],
    ['a delivery charge over ₹5,000', { delivery: { chargePaise: 500001, radiusKm: 5 } }],
    ['a delivery radius of 0 km', { delivery: { chargePaise: 0, radiusKm: 0 } }],
    ['a delivery radius over 50 km', { delivery: { chargePaise: 0, radiusKm: 51 } }],
    ['neither delivery nor pickup', { delivery: null, pickup: false }],
  ])('rejects %s', async (_label, overrides) => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);

    const res = await postListing(ctx, seller, saleDetails(overrides));

    expect(res.status).toBe(400);
    expect(await db.listing.count()).toBe(0);
  });

  it.each([
    ['no packages', { packages: [] }],
    ['more than 6 packages', { packages: [1, 2, 3, 4, 5, 6, 7].map(toPackage) }],
    ['two packages of the same duration', { packages: [1, 1].map(toPackage) }],
    ['a package longer than 30 days', { packages: [31].map(toPackage) }],
    ['a zero deposit', { depositPaise: 0 }],
    ['no deposit', { depositPaise: undefined }],
    ['no late fee', { lateFeePerDayPaise: undefined }],
  ])('rejects a rent listing with %s', async (_label, overrides) => {
    const ctx = createTestContext();
    const owner = await registerVerifiedUser(ctx);

    const res = await postListing(ctx, owner, rentDetails(overrides));

    expect(res.status).toBe(400);
    expect(await db.listing.count()).toBe(0);
  });

  it('allows a late fee of zero and free delivery', async () => {
    const ctx = createTestContext();
    const owner = await registerVerifiedUser(ctx);

    const listing = await createListing(
      ctx,
      owner,
      rentDetails({ lateFeePerDayPaise: 0, delivery: { chargePaise: 0, radiusKm: 5 } }),
    );

    expect(listing.rent.lateFeePerDayPaise).toBe(0);
    expect(listing.delivery).toEqual({ chargePaise: 0, radiusKm: 5 });
  });
});

function toPackage(durationDays) {
  return { durationDays, pricePaise: 100000 };
}

describe('sale or rent, never both', () => {
  it('rejects a sale listing that carries rent fields', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);

    const withDeposit = await postListing(ctx, seller, saleDetails({ depositPaise: 100000 }));
    const withPackages = await postListing(ctx, seller, saleDetails({ packages: [toPackage(3)] }));

    expect(withDeposit.status).toBe(400);
    expect(withPackages.status).toBe(400);
  });

  it('rejects a rent listing that carries sale fields', async () => {
    const ctx = createTestContext();
    const owner = await registerVerifiedUser(ctx);

    const withPrice = await postListing(ctx, owner, rentDetails({ pricePaise: 120000 }));
    const withQuantity = await postListing(ctx, owner, rentDetails({ quantity: 1 }));

    expect(withPrice.status).toBe(400);
    expect(withQuantity.status).toBe(400);
  });

  it('rejects an unknown mode', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);

    const res = await postListing(ctx, seller, saleDetails({ mode: 'BOTH' }));

    expect(res.status).toBe(400);
  });

  it('does not let the mode be changed afterwards', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller);

    const res = await request(ctx.app)
      .patch(`${API}/listings/${listing.id}`)
      .set(seller.bearer)
      .send({ mode: 'RENT' });
    const rentField = await request(ctx.app)
      .patch(`${API}/listings/${listing.id}`)
      .set(seller.bearer)
      .send({ depositPaise: 100000 });

    expect(res.status).toBe(400);
    expect(rentField.status).toBe(400);
  });

  describe('in the database itself', () => {
    const base = {
      title: 'Direct insert',
      description: 'Inserted without going through the API',
      category: 'BAGS',
      condition: 'GOOD',
      brand: 'None',
      size: 'One size',
      colour: 'Black',
      offersDelivery: false,
      offersPickup: true,
      headlinePricePaise: 100000,
      createdAt: new Date(),
    };

    async function sellerId() {
      const ctx = createTestContext();
      return (await registerVerifiedUser(ctx)).user.id;
    }

    it('refuses a row with both a sale price and a rental deposit', async () => {
      const insert = db.listing.create({
        data: {
          ...base,
          sellerId: await sellerId(),
          mode: 'SALE',
          pricePaise: 100000,
          quantity: 1,
          depositPaise: 50000,
          lateFeePerDayPaise: 1000,
        },
      });

      await expect(insert).rejects.toThrow(/listings_mode_fields_check/);
    });

    it('refuses a sale row without a price and a rent row without a deposit', async () => {
      const id = await sellerId();
      const saleWithoutPrice = db.listing.create({
        data: { ...base, sellerId: id, mode: 'SALE', quantity: 1 },
      });
      const rentWithoutDeposit = db.listing.create({
        data: { ...base, sellerId: id, mode: 'RENT', lateFeePerDayPaise: 0 },
      });

      await expect(saleWithoutPrice).rejects.toThrow(/listings_mode_fields_check/);
      await expect(rentWithoutDeposit).rejects.toThrow(/listings_mode_fields_check/);
    });

    it('refuses a rental package on a sale listing', async () => {
      const sale = await db.listing.create({
        data: {
          ...base,
          sellerId: await sellerId(),
          mode: 'SALE',
          pricePaise: 100000,
          quantity: 1,
        },
      });

      const asRent = db.$executeRaw`
        INSERT INTO rental_packages (id, listing_id, listing_mode, duration_days, price_paise)
        VALUES (gen_random_uuid(), ${sale.id}::uuid, 'RENT', 3, 50000)`;
      const asSale = db.$executeRaw`
        INSERT INTO rental_packages (id, listing_id, listing_mode, duration_days, price_paise)
        VALUES (gen_random_uuid(), ${sale.id}::uuid, 'SALE', 3, 50000)`;

      // Claiming RENT breaks the foreign key; claiming SALE breaks the rent-only check.
      await expect(asRent).rejects.toThrow(/foreign key/i);
      await expect(asSale).rejects.toThrow(/rental_packages_rent_only_check/);
    });

    it('refuses a listing with neither delivery nor pickup, and negative stock', async () => {
      const id = await sellerId();
      const noFulfilment = db.listing.create({
        data: {
          ...base,
          sellerId: id,
          mode: 'SALE',
          pricePaise: 100000,
          quantity: 1,
          offersPickup: false,
        },
      });
      const negativeStock = db.listing.create({
        data: { ...base, sellerId: id, mode: 'SALE', pricePaise: 100000, quantity: -1 },
      });

      await expect(noFulfilment).rejects.toThrow(/listings_fulfilment_check/);
      await expect(negativeStock).rejects.toThrow(/listings_amounts_check/);
    });
  });
});

describe('viewing a listing', () => {
  it('is public for an active listing and exposes nothing private about the seller', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    await request(ctx.app)
      .patch(`${API}/me/profile`)
      .set(seller.bearer)
      .send({ locality: 'Indiranagar' });
    const listing = await createListing(ctx, seller);

    const res = await request(ctx.app).get(`${API}/listings/${listing.id}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.listing.seller).sort()).toEqual([
      'displayName',
      'id',
      'locality',
      'photoUrl',
    ]);
    expect(res.body.listing.seller.locality).toBe('Indiranagar');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(seller.details.email);
    expect(body).not.toContain(seller.details.phone.slice(3));
    expect(body).not.toMatch(/storageId|password|address|latitude|longitude/i);
  });

  it.each(['PAUSED', 'UNDER_REVIEW', 'REMOVED'])(
    'hides a %s listing from everyone but its seller',
    async (status) => {
      const ctx = createTestContext();
      const seller = await registerVerifiedUser(ctx);
      const other = await registerVerifiedUser(ctx);
      const listing = await createListing(ctx, seller);
      await db.listing.update({ where: { id: listing.id }, data: { status } });
      const url = `${API}/listings/${listing.id}`;

      expect((await request(ctx.app).get(url)).status).toBe(404);
      expect((await request(ctx.app).get(url).set(other.bearer)).status).toBe(404);

      const own = await request(ctx.app).get(url).set(seller.bearer);
      expect(own.status).toBe(200);
      expect(own.body.listing.status).toBe(status);
      expect(own.body.listing.available).toBe(false);
    },
  );

  it('shows a sold-out sale listing as unavailable', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller);
    await db.listing.update({ where: { id: listing.id }, data: { quantity: 0 } });

    const res = await request(ctx.app).get(`${API}/listings/${listing.id}`);

    expect(res.status).toBe(200);
    expect(res.body.listing.available).toBe(false);
    expect(res.body.listing.sale.quantity).toBe(0);
  });

  it('hides the listings of a seller whose account is being deleted', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller);
    await request(ctx.app)
      .post(`${API}/me/deletion`)
      .set(seller.bearer)
      .send({ password: seller.details.password });

    const single = await request(ctx.app).get(`${API}/listings/${listing.id}`);
    const list = await request(ctx.app).get(`${API}/users/${seller.user.id}/listings`);

    expect(single.status).toBe(404);
    expect(list.body.items).toEqual([]);
  });

  it('returns 404 for an unknown listing, 400 for a malformed id, 401 for a bad token', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller);

    const unknown = await request(ctx.app).get(
      `${API}/listings/00000000-0000-4000-8000-000000000000`,
    );
    const malformed = await request(ctx.app).get(`${API}/listings/not-a-uuid`);
    const badToken = await request(ctx.app)
      .get(`${API}/listings/${listing.id}`)
      .set('Authorization', 'Bearer nope');

    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(400);
    expect(badToken.status).toBe(401);
  });
});

describe('editing a listing', () => {
  it('updates details, price and fulfilment of a sale listing', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller);

    const res = await request(ctx.app)
      .patch(`${API}/listings/${listing.id}`)
      .set(seller.bearer)
      .send({ title: 'Indigo block-print kurta', pricePaise: 99900, quantity: 2, delivery: null });

    expect(res.status).toBe(200);
    expect(res.body.listing).toMatchObject({
      title: 'Indigo block-print kurta',
      sale: { pricePaise: 99900, quantity: 2 },
      delivery: null,
      pickup: true,
      description: listing.description,
    });
  });

  it('replaces the packages of a rent listing', async () => {
    const ctx = createTestContext();
    const owner = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, owner, rentDetails());

    const res = await request(ctx.app)
      .patch(`${API}/listings/${listing.id}`)
      .set(owner.bearer)
      .send({ packages: [{ durationDays: 2, pricePaise: 400000 }], depositPaise: 800000 });

    expect(res.status).toBe(200);
    expect(res.body.listing.rent.depositPaise).toBe(800000);
    expect(res.body.listing.rent.packages.map((p) => [p.durationDays, p.pricePaise])).toEqual([
      [2, 400000],
    ]);
  });

  it('refuses an edit that would leave neither delivery nor pickup', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller, saleDetails({ delivery: null, pickup: true }));

    const res = await request(ctx.app)
      .patch(`${API}/listings/${listing.id}`)
      .set(seller.bearer)
      .send({ pickup: false });

    expect(res.status).toBe(400);
  });

  it('rejects empty, invalid and unknown changes', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller);
    const patch = (body) =>
      request(ctx.app).patch(`${API}/listings/${listing.id}`).set(seller.bearer).send(body);

    expect((await patch({})).status).toBe(400);
    expect((await patch({ pricePaise: 0 })).status).toBe(400);
    expect((await patch({ status: 'ACTIVE' })).status).toBe(400);
    expect((await patch({ sellerId: seller.user.id })).status).toBe(400);
  });

  it('cannot be done by another user, or without sign-in', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const other = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller);
    const url = `${API}/listings/${listing.id}`;

    const byOther = await request(ctx.app).patch(url).set(other.bearer).send({ pricePaise: 100 });
    const anonymous = await request(ctx.app).patch(url).send({ pricePaise: 100 });

    expect(byOther.status).toBe(403);
    expect(anonymous.status).toBe(401);
    const row = await db.listing.findUnique({ where: { id: listing.id } });
    expect(row.pricePaise).toBe(120000);
  });

  it('is refused on a removed listing but allowed while under review', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller);
    const patch = () =>
      request(ctx.app)
        .patch(`${API}/listings/${listing.id}`)
        .set(seller.bearer)
        .send({ colour: 'Navy' });

    await db.listing.update({ where: { id: listing.id }, data: { status: 'UNDER_REVIEW' } });
    expect((await patch()).status).toBe(200);

    await db.listing.update({ where: { id: listing.id }, data: { status: 'REMOVED' } });
    const refused = await patch();
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('LISTING_REMOVED');
  });
});

describe('pausing, activating and deleting', () => {
  it('pauses an active listing and reactivates it, logging each change', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller);
    const url = `${API}/listings/${listing.id}`;

    const paused = await request(ctx.app).post(`${url}/pause`).set(seller.bearer);
    expect(paused.status).toBe(200);
    expect(paused.body.listing).toMatchObject({ status: 'PAUSED', available: false });
    expect((await request(ctx.app).get(url)).status).toBe(404);

    const active = await request(ctx.app).post(`${url}/activate`).set(seller.bearer);
    expect(active.status).toBe(200);
    expect(active.body.listing).toMatchObject({ status: 'ACTIVE', available: true });
    expect((await request(ctx.app).get(url)).status).toBe(200);

    const events = await db.listingStatusEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => [e.action, e.fromStatus, e.toStatus]).sort()).toEqual(
      [
        ['CREATED', null, 'ACTIVE'],
        ['PAUSED', 'ACTIVE', 'PAUSED'],
        ['ACTIVATED', 'PAUSED', 'ACTIVE'],
      ].sort(),
    );
  });

  it('refuses a change that does not apply to the current status', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller);
    const url = `${API}/listings/${listing.id}`;

    const activateActive = await request(ctx.app).post(`${url}/activate`).set(seller.bearer);
    expect(activateActive.status).toBe(409);
    expect(activateActive.body.error.code).toBe('INVALID_STATUS_CHANGE');

    await request(ctx.app).post(`${url}/pause`).set(seller.bearer);
    expect((await request(ctx.app).post(`${url}/pause`).set(seller.bearer)).status).toBe(409);
  });

  it.each(['UNDER_REVIEW', 'REMOVED'])(
    'does not let the seller activate or pause a %s listing',
    async (status) => {
      const ctx = createTestContext();
      const seller = await registerVerifiedUser(ctx);
      const listing = await createListing(ctx, seller);
      await db.listing.update({ where: { id: listing.id }, data: { status } });
      const url = `${API}/listings/${listing.id}`;

      expect((await request(ctx.app).post(`${url}/activate`).set(seller.bearer)).status).toBe(409);
      expect((await request(ctx.app).post(`${url}/pause`).set(seller.bearer)).status).toBe(409);
      const row = await db.listing.findUnique({ where: { id: listing.id } });
      expect(row.status).toBe(status);
    },
  );

  it('deletes a listing for good as far as anyone can see, keeping the row', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller);
    const url = `${API}/listings/${listing.id}`;

    const res = await request(ctx.app).delete(url).set(seller.bearer);
    expect(res.status).toBe(204);

    expect((await request(ctx.app).get(url)).status).toBe(404);
    expect((await request(ctx.app).get(url).set(seller.bearer)).status).toBe(404);
    expect((await request(ctx.app).delete(url).set(seller.bearer)).status).toBe(404);
    expect((await request(ctx.app).patch(url).set(seller.bearer).send({ size: 'L' })).status).toBe(
      404,
    );
    const mine = await request(ctx.app).get(`${API}/me/listings`).set(seller.bearer);
    expect(mine.body.items).toEqual([]);

    const row = await db.listing.findUnique({ where: { id: listing.id } });
    expect(row.deletedAt).toEqual(ctx.clock.now());
  });

  it('only the seller can pause, activate or delete', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const other = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller);
    const url = `${API}/listings/${listing.id}`;

    expect((await request(ctx.app).post(`${url}/pause`).set(other.bearer)).status).toBe(403);
    expect((await request(ctx.app).delete(url).set(other.bearer)).status).toBe(403);
    expect((await request(ctx.app).post(`${url}/pause`)).status).toBe(401);
    expect((await request(ctx.app).delete(url)).status).toBe(401);

    const row = await db.listing.findUnique({ where: { id: listing.id } });
    expect(row).toMatchObject({ status: 'ACTIVE', deletedAt: null });
  });
});

describe('listing lists', () => {
  it('shows a seller all their own listings, filterable by status and mode', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const other = await registerVerifiedUser(ctx);
    const sale = await createListing(ctx, seller, saleDetails());
    const rent = await createListing(ctx, seller, rentDetails());
    await createListing(ctx, other, saleDetails());
    await request(ctx.app).post(`${API}/listings/${rent.id}/pause`).set(seller.bearer);
    const mine = (query = '') =>
      request(ctx.app).get(`${API}/me/listings${query}`).set(seller.bearer);

    const all = await mine();
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    expect(all.body.items.map((l) => l.id).sort()).toEqual([sale.id, rent.id].sort());

    expect((await mine('?status=PAUSED')).body.items.map((l) => l.id)).toEqual([rent.id]);
    expect((await mine('?mode=SALE')).body.items.map((l) => l.id)).toEqual([sale.id]);
    expect((await mine('?category=BAGS')).body.items).toEqual([]);
    expect((await mine('?status=NOPE')).status).toBe(400);
    expect((await request(ctx.app).get(`${API}/me/listings`)).status).toBe(401);
  });

  it('shows the public only a seller’s active listings', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const active = await createListing(ctx, seller, saleDetails());
    const paused = await createListing(ctx, seller, saleDetails());
    const removed = await createListing(ctx, seller, saleDetails());
    await request(ctx.app).post(`${API}/listings/${paused.id}/pause`).set(seller.bearer);
    await db.listing.update({ where: { id: removed.id }, data: { status: 'REMOVED' } });

    const res = await request(ctx.app).get(`${API}/users/${seller.user.id}/listings`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((l) => l.id)).toEqual([active.id]);
    expect(res.body.total).toBe(1);
  });

  it('paginates, newest first, and caps the page size', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      ctx.clock.advance({ minutes: 1 });
      ids.push((await createListing(ctx, seller, saleDetails({ title: `Kurta number ${i}` }))).id);
    }
    const newestFirst = [...ids].reverse();
    const page = (query) => request(ctx.app).get(`${API}/users/${seller.user.id}/listings${query}`);

    const first = await page('?pageSize=2');
    expect(first.body).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    expect(first.body.items.map((l) => l.id)).toEqual(newestFirst.slice(0, 2));

    const last = await page('?pageSize=2&page=3');
    expect(last.body.items.map((l) => l.id)).toEqual(newestFirst.slice(4));

    expect((await page('?page=9')).body.items).toEqual([]);
    expect((await page('?pageSize=51')).status).toBe(400);
    expect((await page('?page=0')).status).toBe(400);
  });
});

describe('account erasure', () => {
  it('takes the erased seller’s listings off the marketplace', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller);
    await request(ctx.app)
      .post(`${API}/me/deletion`)
      .set(seller.bearer)
      .send({ password: seller.details.password });
    const { purgeExpiredDeletions } = await import('../users/deletion.service.js');

    ctx.clock.advance({ days: 30 });
    expect(await purgeExpiredDeletions({ db, clock: ctx.clock })).toBe(1);

    const row = await db.listing.findUnique({ where: { id: listing.id } });
    expect(row.deletedAt).toEqual(ctx.clock.now());
  });
});
