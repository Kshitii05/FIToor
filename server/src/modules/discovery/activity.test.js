import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POPULARITY_LIKE_WEIGHT } from '../../config/policy.js';
import {
  createTestContext,
  db,
  registerUser,
  registerVerifiedUser,
  resetDb,
} from '../../../test/helpers.js';
import { insertListing } from '../../../test/listings.js';

const API = '/api/v1';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const like = (ctx, account, id) =>
  request(ctx.app).put(`${API}/listings/${id}/like`).set(account.bearer);
const unlike = (ctx, account, id) =>
  request(ctx.app).delete(`${API}/listings/${id}/like`).set(account.bearer);
const view = (ctx, account, id) => {
  const req = request(ctx.app).get(`${API}/listings/${id}`);
  return account ? req.set(account.bearer) : req;
};
const counts = (id) =>
  db.listing.findUnique({
    where: { id },
    select: { viewCount: true, likeCount: true, popularityScore: true },
  });

describe('likes', () => {
  it('likes and unlikes a listing, keeping the counts in step', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const fan = await registerUser(ctx);
    const listing = await insertListing(seller);

    const liked = await like(ctx, fan, listing.id);
    expect(liked.status).toBe(200);
    expect(liked.body).toEqual({ liked: true, likeCount: 1 });
    expect(await counts(listing.id)).toEqual({
      viewCount: 0,
      likeCount: 1,
      popularityScore: POPULARITY_LIKE_WEIGHT,
    });

    const unliked = await unlike(ctx, fan, listing.id);
    expect(unliked.body).toEqual({ liked: false, likeCount: 0 });
    expect(await counts(listing.id)).toEqual({ viewCount: 0, likeCount: 0, popularityScore: 0 });
  });

  it('counts each person once, however often they like or unlike', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const first = await registerUser(ctx);
    const second = await registerUser(ctx);
    const listing = await insertListing(seller);

    await like(ctx, first, listing.id);
    await like(ctx, first, listing.id);
    await Promise.all([like(ctx, second, listing.id), like(ctx, second, listing.id)]);
    expect((await counts(listing.id)).likeCount).toBe(2);

    await unlike(ctx, first, listing.id);
    await unlike(ctx, first, listing.id);
    expect(await counts(listing.id)).toMatchObject({
      likeCount: 1,
      popularityScore: POPULARITY_LIKE_WEIGHT,
    });
  });

  it('shows whether the person looking has liked it', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const fan = await registerUser(ctx);
    const other = await registerUser(ctx);
    const listing = await insertListing(seller);
    await like(ctx, fan, listing.id);
    const flag = async (account) => {
      const single = (await view(ctx, account, listing.id)).body.listing;
      const req = request(ctx.app).get(`${API}/listings`);
      const inSearch = (await (account ? req.set(account.bearer) : req)).body.items[0];
      return [single.liked, inSearch.liked, single.likeCount];
    };

    expect(await flag(fan)).toEqual([true, true, 1]);
    expect(await flag(other)).toEqual([false, false, 1]);
    expect(await flag(null)).toEqual([false, false, 1]);
  });

  it('needs sign-in, and cannot be done to your own or a hidden listing', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const fan = await registerUser(ctx);
    const listing = await insertListing(seller);
    const paused = await insertListing(seller, { status: 'PAUSED' });

    expect((await request(ctx.app).put(`${API}/listings/${listing.id}/like`)).status).toBe(401);
    expect((await like(ctx, seller, listing.id)).status).toBe(403);
    expect((await like(ctx, fan, paused.id)).status).toBe(404);
    expect((await like(ctx, fan, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await like(ctx, fan, 'not-a-uuid')).status).toBe(400);
    expect(await db.listingLike.count()).toBe(0);
  });

  it('lets a like be removed after the listing was hidden', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const fan = await registerUser(ctx);
    const listing = await insertListing(seller);
    await like(ctx, fan, listing.id);
    await db.listing.update({ where: { id: listing.id }, data: { status: 'REMOVED' } });

    const res = await unlike(ctx, fan, listing.id);

    expect(res.status).toBe(200);
    expect(await db.listingLike.count()).toBe(0);
  });

  it('lists my liked listings, newest like first, without hidden ones', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const fan = await registerUser(ctx);
    const other = await registerUser(ctx);
    const first = await insertListing(seller, { title: 'Liked first' });
    const second = await insertListing(seller, { title: 'Liked second' });
    const hidden = await insertListing(seller, { title: 'Liked then paused' });
    await like(ctx, fan, first.id);
    ctx.clock.advance({ minutes: 1 });
    await like(ctx, fan, second.id);
    ctx.clock.advance({ minutes: 1 });
    await like(ctx, fan, hidden.id);
    await like(ctx, other, first.id);
    await db.listing.update({ where: { id: hidden.id }, data: { status: 'PAUSED' } });

    const res = await request(ctx.app).get(`${API}/me/likes`).set(fan.bearer);

    expect(res.status).toBe(200);
    expect(res.body.items.map((l) => l.title)).toEqual(['Liked second', 'Liked first']);
    expect(res.body.items.every((l) => l.liked)).toBe(true);
    expect(res.body.total).toBe(2);
    expect((await request(ctx.app).get(`${API}/me/likes`)).status).toBe(401);
  });
});

describe('views', () => {
  it('counts one view per person per day', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const first = await registerUser(ctx);
    const second = await registerUser(ctx);
    const listing = await insertListing(seller);

    await view(ctx, first, listing.id);
    await view(ctx, first, listing.id);
    await view(ctx, second, listing.id);

    expect(await counts(listing.id)).toEqual({ viewCount: 2, likeCount: 0, popularityScore: 2 });
  });

  it('counts the same person again on a later day, by the Indian calendar', async () => {
    // 06:30 UTC is noon in India.
    const ctx = createTestContext({ start: '2026-11-13T06:30:00.000Z' });
    const seller = await registerVerifiedUser(ctx);
    const listing = await insertListing(seller);
    const viewer = async () => {
      // A fresh sign-in each time: the test spans more than one access token lifetime.
      const res = await request(ctx.app)
        .post(`${API}/auth/login`)
        .send({ email: visitor.details.email, password: visitor.details.password });
      return { bearer: { Authorization: `Bearer ${res.body.accessToken}` } };
    };
    const visitor = await registerUser(ctx);

    await view(ctx, await viewer(), listing.id);
    ctx.clock.advance({ hours: 11, minutes: 59 }); // 23:59 the same day in India
    await view(ctx, await viewer(), listing.id);
    expect((await counts(listing.id)).viewCount).toBe(1);

    ctx.clock.advance({ minutes: 1 }); // midnight in India
    await view(ctx, await viewer(), listing.id);
    expect((await counts(listing.id)).viewCount).toBe(2);
  });

  it('does not count the seller, visitors, or looks at a hidden listing', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const visitor = await registerUser(ctx);
    const listing = await insertListing(seller);
    const paused = await insertListing(seller, { status: 'PAUSED' });

    await view(ctx, seller, listing.id);
    await view(ctx, null, listing.id);
    await view(ctx, visitor, paused.id);
    await view(ctx, seller, paused.id);

    expect((await counts(listing.id)).viewCount).toBe(0);
    expect((await counts(paused.id)).viewCount).toBe(0);
    expect(await db.listingView.count()).toBe(0);
  });

  it('does not change when the listing was last edited', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const visitor = await registerUser(ctx);
    const listing = await insertListing(seller);
    const before = (await db.listing.findUnique({ where: { id: listing.id } })).updatedAt;

    await view(ctx, visitor, listing.id);
    await like(ctx, visitor, listing.id);

    const after = (await db.listing.findUnique({ where: { id: listing.id } })).updatedAt;
    expect(after).toEqual(before);
  });
});
