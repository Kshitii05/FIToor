import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LISTING_IMAGE_MAX_BYTES, LISTING_IMAGES_MAX } from '../../config/policy.js';
import { createTestContext, db, registerVerifiedUser, resetDb } from '../../../test/helpers.js';
import {
  createListing,
  JPEG,
  PNG,
  postListing,
  saleDetails,
  WEBP,
} from '../../../test/listings.js';

const API = '/api/v1';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const times = (count, value) => Array.from({ length: count }, () => value);

function addImages(ctx, account, listingId, images) {
  const req = request(ctx.app).post(`${API}/listings/${listingId}/images`).set(account.bearer);
  images.forEach((buffer, index) => req.attach('images', buffer, `extra-${index}.png`));
  return req;
}

describe('photos when creating a listing', () => {
  it('needs at least one photo', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);

    const res = await postListing(ctx, seller, saleDetails(), []);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IMAGE_REQUIRED');
    expect(await db.listing.count()).toBe(0);
  });

  it('accepts JPEG, PNG and WebP, keeping the upload order', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);

    const listing = await createListing(ctx, seller, saleDetails(), [JPEG, PNG, WEBP]);

    expect(listing.images.map((image) => image.position)).toEqual([0, 1, 2]);
    expect(listing.images.map((image) => image.url.split('.').pop())).toEqual([
      'jpg',
      'png',
      'webp',
    ]);
    expect(ctx.imageStorage.stored.size).toBe(3);
  });

  it('accepts 8 photos and refuses a 9th', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);

    const eight = await postListing(ctx, seller, saleDetails(), times(LISTING_IMAGES_MAX, PNG));
    expect(eight.status).toBe(201);
    expect(eight.body.listing.images).toHaveLength(LISTING_IMAGES_MAX);

    const nine = await postListing(ctx, seller, saleDetails(), times(LISTING_IMAGES_MAX + 1, PNG));
    expect(nine.status).toBe(400);
    expect(nine.body.error.code).toBe('TOO_MANY_IMAGES');
    expect(await db.listing.count()).toBe(1);
    expect(ctx.imageStorage.stored.size).toBe(LISTING_IMAGES_MAX);
  });

  it('judges the file by its contents, not its name or declared type', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);

    const res = await request(ctx.app)
      .post(`${API}/listings`)
      .set(seller.bearer)
      .field('data', JSON.stringify(saleDetails()))
      .attach('images', Buffer.from('<script>alert(1)</script>'), {
        filename: 'photo.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_IMAGE');
    expect(await db.listing.count()).toBe(0);
    expect(ctx.imageStorage.stored.size).toBe(0);
  });

  it('refuses a photo over 5 MB', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const tooLarge = Buffer.concat([PNG, Buffer.alloc(LISTING_IMAGE_MAX_BYTES)]);

    const res = await postListing(ctx, seller, saleDetails(), [tooLarge]);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IMAGE_TOO_LARGE');
    expect(await db.listing.count()).toBe(0);
  });

  it('stores nothing when the details are invalid', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);

    const res = await postListing(ctx, seller, saleDetails({ title: 'no' }), [PNG, PNG]);

    expect(res.status).toBe(400);
    expect(ctx.imageStorage.stored.size).toBe(0);
  });

  it('removes the stored photos again if saving the listing fails', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    // The seller disappears between the upload and the save.
    const realUpload = ctx.imageStorage.upload;
    ctx.imageStorage.upload = async (file) => {
      const result = await realUpload(file);
      await db.$executeRaw`DELETE FROM users WHERE id = ${seller.user.id}::uuid`;
      return result;
    };

    const res = await postListing(ctx, seller, saleDetails(), [PNG]);

    expect(res.status).toBe(500);
    expect(ctx.imageStorage.stored.size).toBe(0);
    expect(ctx.imageStorage.removed).toHaveLength(1);
  });

  it('rejects a request without the details field', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);

    const missing = await request(ctx.app)
      .post(`${API}/listings`)
      .set(seller.bearer)
      .attach('images', PNG, 'photo.png');
    const notJson = await request(ctx.app)
      .post(`${API}/listings`)
      .set(seller.bearer)
      .field('data', '{not json')
      .attach('images', PNG, 'photo.png');

    expect(missing.status).toBe(400);
    expect(notJson.status).toBe(400);
  });
});

describe('managing photos afterwards', () => {
  it('adds photos after the existing ones, up to 8 in total', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller, saleDetails(), times(6, PNG));

    const added = await addImages(ctx, seller, listing.id, [JPEG, JPEG]);
    expect(added.status).toBe(201);
    expect(added.body.listing.images.map((image) => image.position)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);

    const overLimit = await addImages(ctx, seller, listing.id, [PNG]);
    expect(overLimit.status).toBe(400);
    expect(overLimit.body.error.code).toBe('TOO_MANY_IMAGES');
    expect(await db.listingImage.count()).toBe(LISTING_IMAGES_MAX);
    expect(ctx.imageStorage.stored.size).toBe(LISTING_IMAGES_MAX);
  });

  it('never ends up with more than 8 when uploads race', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller, saleDetails(), times(6, PNG));

    const results = await Promise.all([
      addImages(ctx, seller, listing.id, [PNG, PNG]),
      addImages(ctx, seller, listing.id, [PNG, PNG]),
      addImages(ctx, seller, listing.id, [PNG, PNG]),
    ]);

    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    expect(await db.listingImage.count()).toBe(LISTING_IMAGES_MAX);
    // Files from the refused uploads are not left behind.
    expect(ctx.imageStorage.stored.size).toBe(LISTING_IMAGES_MAX);
  });

  it('the database itself refuses a 9th image', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller, saleDetails(), times(8, PNG));
    const row = { listingId: listing.id, url: 'x', storageId: 'x', createdAt: new Date() };

    await expect(db.listingImage.create({ data: { ...row, position: 8 } })).rejects.toThrow(
      /listing_images_position_check/,
    );
    await expect(db.listingImage.create({ data: { ...row, position: 3 } })).rejects.toThrow(
      /unique/i,
    );
  });

  it('removes a photo, deletes its file and closes the gap', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller, saleDetails(), [PNG, JPEG, WEBP]);
    const [first, second, third] = listing.images;

    const res = await request(ctx.app)
      .delete(`${API}/listings/${listing.id}/images/${second.id}`)
      .set(seller.bearer);

    expect(res.status).toBe(200);
    expect(res.body.listing.images).toEqual([
      { id: first.id, url: first.url, position: 0 },
      { id: third.id, url: third.url, position: 1 },
    ]);
    expect(ctx.imageStorage.stored.size).toBe(2);
    expect(ctx.imageStorage.removed).toHaveLength(1);
  });

  it('keeps the last photo', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller, saleDetails(), [PNG]);

    const res = await request(ctx.app)
      .delete(`${API}/listings/${listing.id}/images/${listing.images[0].id}`)
      .set(seller.bearer);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_IMAGE');
    expect(ctx.imageStorage.stored.size).toBe(1);
  });

  it('reorders photos', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller, saleDetails(), [PNG, JPEG, WEBP]);
    const [a, b, c] = listing.images.map((image) => image.id);
    const reorder = (imageIds) =>
      request(ctx.app)
        .put(`${API}/listings/${listing.id}/images/order`)
        .set(seller.bearer)
        .send({ imageIds });

    const res = await reorder([c, a, b]);
    expect(res.status).toBe(200);
    expect(res.body.listing.images.map((image) => image.id)).toEqual([c, a, b]);
    expect(res.body.listing.images.map((image) => image.position)).toEqual([0, 1, 2]);

    expect((await reorder([a, b])).status).toBe(400);
    expect((await reorder([a, a, b])).status).toBe(400);
    expect((await reorder([a, b, '00000000-0000-4000-8000-000000000000'])).status).toBe(400);
  });

  it('only the seller can add, remove or reorder photos', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const other = await registerVerifiedUser(ctx);
    const listing = await createListing(ctx, seller, saleDetails(), [PNG, JPEG]);
    const [a, b] = listing.images.map((image) => image.id);
    const base = `${API}/listings/${listing.id}/images`;

    expect((await addImages(ctx, other, listing.id, [PNG])).status).toBe(403);
    expect((await request(ctx.app).delete(`${base}/${a}`).set(other.bearer)).status).toBe(403);
    expect(
      (
        await request(ctx.app)
          .put(`${base}/order`)
          .set(other.bearer)
          .send({ imageIds: [b, a] })
      ).status,
    ).toBe(403);
    expect((await request(ctx.app).post(base).attach('images', PNG, 'p.png')).status).toBe(401);

    expect(ctx.imageStorage.stored.size).toBe(2);
    const rows = await db.listingImage.findMany({ orderBy: { position: 'asc' } });
    expect(rows.map((row) => row.id)).toEqual([a, b]);
  });
});
