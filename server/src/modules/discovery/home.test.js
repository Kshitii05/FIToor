import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { BUDGET_MAX_PAISE, HOME_SECTION_SIZE, TRENDING_WINDOW_DAYS } from '../../config/policy.js';
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

async function home(ctx, account) {
  const req = request(ctx.app).get(`${API}/home`);
  const res = await (account ? req.set(account.bearer) : req);
  expect(res.status).toBe(200);
  const sections = Object.fromEntries(
    res.body.sections.map((section) => [section.key, section.items.map((l) => l.title)]),
  );
  return { res, sections };
}

const like = (ctx, account, id) =>
  request(ctx.app).put(`${API}/listings/${id}/like`).set(account.bearer);
const view = (ctx, account, id) =>
  request(ctx.app).get(`${API}/listings/${id}`).set(account.bearer);

async function signInAgain(ctx, account) {
  const res = await request(ctx.app)
    .post(`${API}/auth/login`)
    .send({ email: account.details.email, password: account.details.password });
  return { ...account, bearer: { Authorization: `Bearer ${res.body.accessToken}` } };
}

describe('home sections', () => {
  it('gives visitors four named sections and signed-in users a fifth', async () => {
    const ctx = createTestContext();
    const user = await registerUser(ctx);

    const visitor = await home(ctx);
    expect(visitor.res.body.sections.map((s) => [s.key, s.title])).toEqual([
      ['trending', 'Trending Near You'],
      ['recent', 'Recently Listed'],
      ['budget', 'Budget-Friendly Finds'],
      ['rent', 'Rent for an Occasion'],
    ]);

    const signedIn = await home(ctx, user);
    expect(signedIn.res.body.sections.map((s) => s.key)).toEqual([
      'trending',
      'recent',
      'budget',
      'rent',
      'forYou',
    ]);
  });

  it('Recently Listed is newest first and holds at most 12', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    for (let i = 1; i <= HOME_SECTION_SIZE + 2; i += 1) {
      await insertListing(seller, {
        title: `Item ${String(i).padStart(2, '0')}`,
        createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)),
      });
    }

    const { sections } = await home(ctx);

    expect(sections.recent).toHaveLength(HOME_SECTION_SIZE);
    expect(sections.recent[0]).toBe('Item 14');
    expect(sections.recent.at(-1)).toBe('Item 03');
  });

  it('Budget-Friendly Finds holds listings at ₹1,000 or less, most popular first', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const fan = await registerUser(ctx);
    await insertListing(seller, { title: 'Exactly a thousand', pricePaise: BUDGET_MAX_PAISE });
    await insertListing(seller, { title: 'Just over', pricePaise: BUDGET_MAX_PAISE + 1 });
    const cheap = await insertListing(seller, { title: 'Cheap and loved', pricePaise: 30000 });
    await insertListing(seller, {
      title: 'Cheap rental',
      mode: 'RENT',
      packages: [
        { durationDays: 1, pricePaise: 50000 },
        { durationDays: 7, pricePaise: 300000 },
      ],
    });
    await like(ctx, fan, cheap.id);

    const { sections } = await home(ctx);

    expect(sections.budget[0]).toBe('Cheap and loved');
    expect(sections.budget.slice().sort()).toEqual(
      ['Cheap and loved', 'Cheap rental', 'Exactly a thousand'].sort(),
    );
  });

  it('Rent for an Occasion holds rentals only', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    await insertListing(seller, { title: 'For sale dress' });
    await insertListing(seller, { title: 'Rental lehenga', mode: 'RENT' });
    await insertListing(seller, { title: 'Rental sherwani', mode: 'RENT' });

    const { sections } = await home(ctx);

    expect(sections.rent.slice().sort()).toEqual(['Rental lehenga', 'Rental sherwani']);
  });

  it('Trending counts activity from the last 14 days only', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    let fan = await registerUser(ctx);
    const second = await registerUser(ctx);
    const old = await insertListing(seller, { title: 'Was popular' });
    const fresh = await insertListing(seller, { title: 'Popular now' });
    await insertListing(seller, { title: 'Quiet one' });

    // Two likes on the old favourite, then time passes.
    await like(ctx, fan, old.id);
    await like(ctx, second, old.id);
    ctx.clock.advance({ days: TRENDING_WINDOW_DAYS + 1 });
    fan = await signInAgain(ctx, fan);
    await view(ctx, fan, fresh.id);

    const { sections } = await home(ctx);

    expect(sections.trending[0]).toBe('Popular now');
    // All-time popularity still ranks the old favourite first.
    const popular = await request(ctx.app).get(`${API}/listings?sort=popular`);
    expect(popular.body.items[0].title).toBe('Was popular');
  });

  it('never shows hidden, deleted or sold-out listings in any section', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const leaving = await registerVerifiedUser(ctx);
    const user = await registerUser(ctx);
    await insertListing(seller, { title: 'Good one', pricePaise: 50000 });
    await insertListing(seller, { title: 'Good rental', mode: 'RENT' });
    await insertListing(seller, { title: 'Paused', pricePaise: 50000, status: 'PAUSED' });
    await insertListing(seller, { title: 'Removed', pricePaise: 50000, status: 'REMOVED' });
    await insertListing(seller, { title: 'In review', mode: 'RENT', status: 'UNDER_REVIEW' });
    await insertListing(seller, { title: 'Deleted', pricePaise: 50000, deletedAt: new Date() });
    await insertListing(seller, { title: 'Sold out', pricePaise: 50000, quantity: 0 });
    await insertListing(leaving, { title: 'Seller leaving', pricePaise: 50000 });
    await request(ctx.app)
      .post(`${API}/me/deletion`)
      .set(leaving.bearer)
      .send({ password: leaving.details.password });

    const { sections } = await home(ctx, user);

    const shown = new Set(Object.values(sections).flat());
    expect([...shown].sort()).toEqual(['Good one', 'Good rental']);
  });
});

describe('For You', () => {
  async function wardrobe(ctx) {
    const seller = await registerVerifiedUser(ctx);
    const make = (title, fields) => insertListing(seller, { title, ...fields });
    return {
      seller,
      bibaKurtaM: await make('Biba kurta M', { category: 'ETHNIC_WEAR', brand: 'Biba', size: 'M' }),
      bibaKurtaL: await make('Biba kurta L', { category: 'ETHNIC_WEAR', brand: 'Biba', size: 'L' }),
      otherEthnic: await make('Other ethnic S', {
        category: 'ETHNIC_WEAR',
        brand: 'Anokhi',
        size: 'S',
      }),
      bibaBag: await make('Biba bag', { category: 'BAGS', brand: 'Biba', size: 'One size' }),
      shoesM: await make('Shoes M', { category: 'FOOTWEAR', brand: 'Bata', size: 'M' }),
      shoes8: await make('Shoes 8', { category: 'FOOTWEAR', brand: 'Bata', size: '8' }),
    };
  }

  it('ranks listings by how well they match what the person liked', async () => {
    const ctx = createTestContext();
    const items = await wardrobe(ctx);
    const user = await registerUser(ctx);
    await like(ctx, user, items.bibaKurtaM.id);

    const { sections } = await home(ctx, user);

    // Liked: ethnic wear, Biba, size M. Category counts 3, brand 2, size 1.
    expect(sections.forYou.slice(0, 4)).toEqual([
      'Biba kurta L', // category + brand
      'Other ethnic S', // category
      'Biba bag', // brand
      'Shoes M', // size
    ]);
    // The liked listing itself is not recommended back.
    expect(sections.forYou).not.toContain('Biba kurta M');
  });

  it('weighs a like more than a view', async () => {
    const ctx = createTestContext();
    const items = await wardrobe(ctx);
    const user = await registerUser(ctx);
    await view(ctx, user, items.shoes8.id); // footwear, viewed: weight 1
    await like(ctx, user, items.bibaBag.id); // bags and Biba, liked: weight 3

    const { sections } = await home(ctx, user);

    // Biba items (brand 2 x 3 = 6) outrank other footwear (category 3 x 1 = 3).
    const firstBiba = sections.forYou.findIndex((title) => title.startsWith('Biba kurta'));
    const footwear = sections.forYou.indexOf('Shoes M');
    expect(firstBiba).toBeGreaterThanOrEqual(0);
    expect(firstBiba).toBeLessThan(footwear);
  });

  it('falls back to popular listings for someone with no activity', async () => {
    const ctx = createTestContext();
    const items = await wardrobe(ctx);
    const fan = await registerUser(ctx);
    const newcomer = await registerUser(ctx);
    await like(ctx, fan, items.shoes8.id);

    const { sections } = await home(ctx, newcomer);

    expect(sections.forYou).toHaveLength(6);
    expect(sections.forYou[0]).toBe('Shoes 8');
  });

  it('leaves out the person’s own listings', async () => {
    const ctx = createTestContext();
    const items = await wardrobe(ctx);

    const { sections } = await home(ctx, items.seller);

    expect(sections.forYou).toEqual([]);
    expect(sections.recent).toHaveLength(6);
  });

  it('is built from the person’s own activity, not anyone else’s', async () => {
    const ctx = createTestContext();
    const items = await wardrobe(ctx);
    const bagLover = await registerUser(ctx);
    const shoeLover = await registerUser(ctx);
    await like(ctx, bagLover, items.bibaBag.id);
    await like(ctx, shoeLover, items.shoes8.id);

    const forBags = (await home(ctx, bagLover)).sections.forYou;
    const forShoes = (await home(ctx, shoeLover)).sections.forYou;

    expect(forBags[0]).toMatch(/^Biba kurta/);
    expect(forShoes[0]).toBe('Shoes M');
  });
});
