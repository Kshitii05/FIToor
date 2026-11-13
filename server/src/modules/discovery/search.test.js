import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SEARCH_HISTORY_MAX } from '../../config/policy.js';
import { createTestContext, db, registerVerifiedUser, resetDb } from '../../../test/helpers.js';
import { insertListing } from '../../../test/listings.js';
import { toTsQuery } from './search.service.js';

const API = '/api/v1';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const search = (ctx, query = '') => request(ctx.app).get(`${API}/listings${query}`);
const titles = (res) => res.body.items.map((listing) => listing.title);

async function catalogue(ctx) {
  const seller = await registerVerifiedUser(ctx);
  const day = (n) => new Date(`2026-11-${String(n).padStart(2, '0')}T00:00:00.000Z`);
  await insertListing(seller, {
    title: 'Block-print cotton kurta',
    description: 'Hand printed in Jaipur.',
    category: 'ETHNIC_WEAR',
    brand: 'Fabindia',
    colour: 'Indigo',
    size: 'M',
    condition: 'GOOD',
    pricePaise: 120000,
    createdAt: day(1),
  });
  await insertListing(seller, {
    title: 'Silk kurta set',
    description: 'Festive wear with dupatta.',
    category: 'ETHNIC_WEAR',
    brand: 'Biba',
    colour: 'Red',
    size: 'L',
    condition: 'NEW',
    pricePaise: 350000,
    createdAt: day(2),
  });
  await insertListing(seller, {
    title: 'Leather tote bag',
    description: 'Roomy everyday bag in tan leather.',
    category: 'BAGS',
    brand: 'Hidesign',
    colour: 'Tan',
    size: 'One size',
    condition: 'FAIR',
    pricePaise: 80000,
    createdAt: day(3),
  });
  await insertListing(seller, {
    mode: 'RENT',
    title: 'Embroidered wedding lehenga',
    description: 'Heavy zari work for the big day.',
    category: 'ETHNIC_WEAR',
    brand: 'Biba',
    colour: 'Maroon',
    size: 'S',
    condition: 'NEW',
    packages: [
      { durationDays: 1, pricePaise: 250000 },
      { durationDays: 3, pricePaise: 600000 },
    ],
    createdAt: day(4),
  });
  return seller;
}

describe('turning typed text into a search query', () => {
  it('requires every word and matches the last one by prefix', () => {
    expect(toTsQuery('Cotton KUR')).toBe('cotton & kur:*');
    expect(toTsQuery('  kurta ')).toBe('kurta:*');
  });

  it('drops punctuation and query operators, so they cannot break the search', () => {
    expect(toTsQuery("kurta's & (silk) | !red:*")).toBe('kurta & s & silk & red:*');
    expect(toTsQuery('   ')).toBeNull();
    expect(toTsQuery('&&& ||| !!!')).toBeNull();
    expect(toTsQuery(undefined)).toBeNull();
  });

  it('uses at most 8 words', () => {
    expect(toTsQuery('a b c d e f g h i j').split(' & ')).toHaveLength(8);
  });
});

describe('keyword search', () => {
  it('finds listings by words in the title, best match first', async () => {
    const ctx = createTestContext();
    await catalogue(ctx);

    const res = await search(ctx, '?q=kurta');

    expect(res.status).toBe(200);
    expect(titles(res).sort()).toEqual(['Block-print cotton kurta', 'Silk kurta set']);
    expect(res.body.total).toBe(2);
    expect(res.body.sort).toBe('relevance');
  });

  it('matches while typing, plural forms, and words in any order', async () => {
    const ctx = createTestContext();
    await catalogue(ctx);

    expect(titles(await search(ctx, '?q=kur')).sort()).toEqual([
      'Block-print cotton kurta',
      'Silk kurta set',
    ]);
    expect(titles(await search(ctx, '?q=bags'))).toEqual(['Leather tote bag']);
    expect(titles(await search(ctx, '?q=kurta%20cotton'))).toEqual(['Block-print cotton kurta']);
  });

  it('requires every word to match', async () => {
    const ctx = createTestContext();
    await catalogue(ctx);

    expect(titles(await search(ctx, '?q=silk%20kurta'))).toEqual(['Silk kurta set']);
    expect(titles(await search(ctx, '?q=silk%20tote'))).toEqual([]);
  });

  it('also searches brand, colour, category and description', async () => {
    const ctx = createTestContext();
    await catalogue(ctx);

    expect(titles(await search(ctx, '?q=hidesign'))).toEqual(['Leather tote bag']);
    expect(titles(await search(ctx, '?q=maroon'))).toEqual(['Embroidered wedding lehenga']);
    expect(titles(await search(ctx, '?q=jaipur'))).toEqual(['Block-print cotton kurta']);
    expect(titles(await search(ctx, '?q=ethnic'))).toHaveLength(3);
  });

  it('ranks a title match above a description match', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    await insertListing(seller, {
      title: 'Plain shirt',
      description: 'Goes well with a denim jacket.',
    });
    await insertListing(seller, { title: 'Denim jacket', description: 'Classic cut.' });

    expect(titles(await search(ctx, '?q=denim'))).toEqual(['Denim jacket', 'Plain shirt']);
  });

  it('follows edits to a listing', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const listing = await insertListing(seller, { title: 'Woollen shawl' });

    await request(ctx.app)
      .patch(`${API}/listings/${listing.id}`)
      .set(seller.bearer)
      .send({ title: 'Pashmina stole' });

    expect(titles(await search(ctx, '?q=shawl'))).toEqual([]);
    expect(titles(await search(ctx, '?q=pashmina'))).toEqual(['Pashmina stole']);
  });

  it('treats special characters as plain text', async () => {
    const ctx = createTestContext();
    await catalogue(ctx);

    for (const text of ["'; DROP TABLE listings; --", '%', '_', '(((', 'kurta:*|!', '\\']) {
      const res = await search(ctx, `?q=${encodeURIComponent(text)}`);
      expect(res.status).toBe(200);
    }
    expect(await db.listing.count()).toBe(4);
  });

  it('returns everything, newest first, when nothing is typed', async () => {
    const ctx = createTestContext();
    await catalogue(ctx);

    const res = await search(ctx, '?q=');

    expect(res.body.sort).toBe('newest');
    expect(titles(res)).toEqual([
      'Embroidered wedding lehenga',
      'Leather tote bag',
      'Silk kurta set',
      'Block-print cotton kurta',
    ]);
  });
});

describe('filters', () => {
  it.each([
    ['?category=BAGS', ['Leather tote bag']],
    [
      '?category=BAGS,ETHNIC_WEAR&mode=SALE',
      ['Leather tote bag', 'Silk kurta set', 'Block-print cotton kurta'],
    ],
    ['?mode=RENT', ['Embroidered wedding lehenga']],
    ['?condition=NEW', ['Embroidered wedding lehenga', 'Silk kurta set']],
    ['?condition=GOOD,FAIR', ['Leather tote bag', 'Block-print cotton kurta']],
    ['?brand=biba', ['Embroidered wedding lehenga', 'Silk kurta set']],
    ['?size=m', ['Block-print cotton kurta']],
    ['?size=One%20size', ['Leather tote bag']],
    ['?colour=RED', ['Silk kurta set']],
    ['?minPricePaise=250000', ['Embroidered wedding lehenga', 'Silk kurta set']],
    ['?maxPricePaise=120000', ['Leather tote bag', 'Block-print cotton kurta']],
    [
      '?minPricePaise=100000&maxPricePaise=300000',
      ['Embroidered wedding lehenga', 'Block-print cotton kurta'],
    ],
    ['?q=kurta&brand=Biba', ['Silk kurta set']],
    ['?category=FOOTWEAR', []],
  ])('%s', async (query, expected) => {
    const ctx = createTestContext();
    await catalogue(ctx);

    const res = await search(ctx, query);

    expect(res.status).toBe(200);
    expect(titles(res).sort()).toEqual([...expected].sort());
    expect(res.body.total).toBe(expected.length);
  });

  it('uses the cheapest package as the price of a rental', async () => {
    const ctx = createTestContext();
    await catalogue(ctx);

    // The lehenga's packages are ₹2,500 and ₹6,000.
    expect(titles(await search(ctx, '?mode=RENT&maxPricePaise=250000'))).toHaveLength(1);
    expect(titles(await search(ctx, '?mode=RENT&maxPricePaise=249999'))).toHaveLength(0);
  });

  it('can leave out sold-out listings', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    await insertListing(seller, { title: 'In stock shirt' });
    await insertListing(seller, { title: 'Sold out shirt', quantity: 0 });
    await insertListing(seller, { title: 'Rental shirt', mode: 'RENT' });

    expect(titles(await search(ctx, '?available=true')).sort()).toEqual([
      'In stock shirt',
      'Rental shirt',
    ]);
    expect(titles(await search(ctx, '?available=false'))).toHaveLength(3);
    expect(titles(await search(ctx))).toHaveLength(3);
  });

  it.each([
    '?category=ELECTRONICS',
    '?mode=BOTH',
    '?condition=USED',
    '?sort=cheapest',
    '?minPricePaise=-1',
    '?minPricePaise=12.5',
    '?minPricePaise=500&maxPricePaise=100',
    '?available=yes',
    '?pageSize=51',
    `?q=${'x'.repeat(101)}`,
  ])('rejects %s', async (query) => {
    const ctx = createTestContext();
    const res = await search(ctx, query);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('sorting', () => {
  it.each([
    [
      'newest',
      [
        'Embroidered wedding lehenga',
        'Leather tote bag',
        'Silk kurta set',
        'Block-print cotton kurta',
      ],
    ],
    [
      'price_asc',
      [
        'Leather tote bag',
        'Block-print cotton kurta',
        'Embroidered wedding lehenga',
        'Silk kurta set',
      ],
    ],
    [
      'price_desc',
      [
        'Silk kurta set',
        'Embroidered wedding lehenga',
        'Block-print cotton kurta',
        'Leather tote bag',
      ],
    ],
  ])('%s', async (sort, expected) => {
    const ctx = createTestContext();
    await catalogue(ctx);

    const res = await search(ctx, `?sort=${sort}`);

    expect(titles(res)).toEqual(expected);
    expect(res.body.sort).toBe(sort);
  });

  it('most popular puts liked and viewed listings first', async () => {
    const ctx = createTestContext();
    await catalogue(ctx);
    const fan = await registerVerifiedUser(ctx);
    const all = (await search(ctx)).body.items;
    const tote = all.find((listing) => listing.title === 'Leather tote bag');
    const kurta = all.find((listing) => listing.title === 'Silk kurta set');
    await request(ctx.app).put(`${API}/listings/${tote.id}/like`).set(fan.bearer);
    await request(ctx.app).get(`${API}/listings/${kurta.id}`).set(fan.bearer);

    const res = await search(ctx, '?sort=popular');

    // A like (3) outweighs a view (1); the rest follow newest first.
    expect(titles(res)).toEqual([
      'Leather tote bag',
      'Silk kurta set',
      'Embroidered wedding lehenga',
      'Block-print cotton kurta',
    ]);
  });

  it('paginates in a stable order', async () => {
    const ctx = createTestContext();
    await catalogue(ctx);

    const first = await search(ctx, '?sort=price_asc&pageSize=3');
    const second = await search(ctx, '?sort=price_asc&pageSize=3&page=2');

    expect(first.body).toMatchObject({ page: 1, pageSize: 3, total: 4, totalPages: 2 });
    expect(titles(first)).toHaveLength(3);
    expect(titles(second)).toEqual(['Silk kurta set']);
    expect((await search(ctx, '?page=5')).body.items).toEqual([]);
  });
});

describe('what search never shows', () => {
  it.each(['PAUSED', 'UNDER_REVIEW', 'REMOVED'])('a %s listing', async (status) => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    await insertListing(seller, { title: 'Visible scarf' });
    await insertListing(seller, { title: 'Hidden scarf', status });

    expect(titles(await search(ctx, '?q=scarf'))).toEqual(['Visible scarf']);
    expect((await search(ctx)).body.total).toBe(1);
  });

  it('a deleted listing, or one whose seller is leaving', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    const leaving = await registerVerifiedUser(ctx);
    await insertListing(seller, { title: 'Visible scarf' });
    await insertListing(seller, { title: 'Deleted scarf', deletedAt: new Date() });
    await insertListing(leaving, { title: 'Leaving scarf' });
    await request(ctx.app)
      .post(`${API}/me/deletion`)
      .set(leaving.bearer)
      .send({ password: leaving.details.password });

    const res = await search(ctx, '?q=scarf');

    expect(titles(res)).toEqual(['Visible scarf']);
    expect(res.body.facets.brands).toEqual([{ value: 'Generic', count: 1 }]);
  });

  it('private details of the seller', async () => {
    const ctx = createTestContext();
    const seller = await catalogue(ctx);

    const body = JSON.stringify((await search(ctx)).body);

    expect(body).not.toContain(seller.details.email);
    expect(body).not.toContain(seller.details.phone.slice(3));
    expect(body).not.toMatch(/storageId|password|searchVector|search_vector/i);
  });
});

describe('filter lists', () => {
  it('returns the brands, sizes and colours among the matches, most common first', async () => {
    const ctx = createTestContext();
    await catalogue(ctx);

    const res = await search(ctx, '?category=ETHNIC_WEAR');

    expect(res.body.facets.brands).toEqual([
      { value: 'Biba', count: 2 },
      { value: 'Fabindia', count: 1 },
    ]);
    expect(res.body.facets.sizes.map((f) => f.value).sort()).toEqual(['L', 'M', 'S']);
    expect(res.body.facets.colours).toHaveLength(3);
  });

  it('groups values that differ only in capital letters', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    await insertListing(seller, { brand: 'Zara' });
    await insertListing(seller, { brand: 'ZARA' });
    await insertListing(seller, { brand: 'zara' });

    const res = await search(ctx);

    expect(res.body.facets.brands).toHaveLength(1);
    expect(res.body.facets.brands[0].count).toBe(3);
    expect((await search(ctx, '?brand=Zara')).body.total).toBe(3);
  });
});

describe('suggestions', () => {
  const suggest = (ctx, q, account) => {
    const req = request(ctx.app).get(`${API}/search/suggestions?q=${encodeURIComponent(q)}`);
    return account ? req.set(account.bearer) : req;
  };

  it('offers matching titles and brands', async () => {
    const ctx = createTestContext();
    await catalogue(ctx);

    const res = await suggest(ctx, 'ku');
    expect(res.status).toBe(200);
    expect(res.body.titles.sort()).toEqual(['Block-print cotton kurta', 'Silk kurta set']);
    expect(res.body.recent).toEqual([]);

    expect((await suggest(ctx, 'bi')).body.brands).toEqual(['Biba']);
    expect((await suggest(ctx, 'SILK')).body.titles).toEqual(['Silk kurta set']);
  });

  it('puts titles that start with the text before ones that only contain it', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    await insertListing(seller, { title: 'Vintage red dress' });
    await insertListing(seller, { title: 'Red dress shoes' });

    expect((await suggest(ctx, 'red')).body.titles).toEqual([
      'Red dress shoes',
      'Vintage red dress',
    ]);
  });

  it('needs at least 2 characters and never suggests hidden listings', async () => {
    const ctx = createTestContext();
    const seller = await registerVerifiedUser(ctx);
    await insertListing(seller, { title: 'Kurta visible', brand: 'Kalki' });
    await insertListing(seller, { title: 'Kurta hidden', brand: 'Khadi', status: 'REMOVED' });

    expect((await suggest(ctx, 'k')).body).toEqual({ titles: [], brands: [], recent: [] });
    const res = await suggest(ctx, 'ku');
    expect(res.body.titles).toEqual(['Kurta visible']);
    expect((await suggest(ctx, 'kh')).body.brands).toEqual([]);
  });

  it('treats % and _ as plain characters', async () => {
    const ctx = createTestContext();
    await catalogue(ctx);

    expect((await suggest(ctx, '%%')).body.titles).toEqual([]);
    expect((await suggest(ctx, '__')).body.titles).toEqual([]);
  });
});

describe('search history', () => {
  const run = (ctx, account, q) =>
    request(ctx.app)
      .get(`${API}/listings?q=${encodeURIComponent(q)}`)
      .set(account.bearer);
  const recent = async (ctx, account, q = '') =>
    (
      await request(ctx.app)
        .get(`${API}/search/suggestions?q=${encodeURIComponent(q)}`)
        .set(account.bearer)
    ).body.recent;

  it('remembers a signed-in user’s searches, newest first, without repeats', async () => {
    const ctx = createTestContext();
    const user = await registerVerifiedUser(ctx);

    await run(ctx, user, 'Kurta');
    ctx.clock.advance({ minutes: 1 });
    await run(ctx, user, 'tote bag');
    ctx.clock.advance({ minutes: 1 });
    await run(ctx, user, '  KURTA ');

    expect(await recent(ctx, user)).toEqual(['kurta', 'tote bag']);
    expect(await recent(ctx, user, 'to')).toEqual(['tote bag']);
  });

  it('keeps only the 10 most recent', async () => {
    const ctx = createTestContext();
    const user = await registerVerifiedUser(ctx);

    for (let i = 1; i <= SEARCH_HISTORY_MAX + 3; i += 1) {
      ctx.clock.advance({ minutes: 1 });
      await run(ctx, user, `search ${i}`);
    }

    const rows = await db.searchHistory.findMany({ orderBy: { createdAt: 'desc' } });
    expect(rows).toHaveLength(SEARCH_HISTORY_MAX);
    expect(rows[0].query).toBe('search 13');
    expect(rows.at(-1).query).toBe('search 4');
  });

  it('is private, is not kept for visitors, and ignores browsing without a keyword', async () => {
    const ctx = createTestContext();
    const user = await registerVerifiedUser(ctx);
    const other = await registerVerifiedUser(ctx);

    await run(ctx, user, 'kurta');
    await search(ctx, '?q=lehenga');
    await request(ctx.app).get(`${API}/listings?category=BAGS`).set(user.bearer);
    await request(ctx.app).get(`${API}/listings?q=kurta&page=2`).set(user.bearer);

    expect(await recent(ctx, user)).toEqual(['kurta']);
    expect(await recent(ctx, other)).toEqual([]);
    expect(await db.searchHistory.count()).toBe(1);
  });

  it('can be cleared', async () => {
    const ctx = createTestContext();
    const user = await registerVerifiedUser(ctx);
    const other = await registerVerifiedUser(ctx);
    await run(ctx, user, 'kurta');
    await run(ctx, other, 'saree');

    const res = await request(ctx.app).delete(`${API}/me/search-history`).set(user.bearer);

    expect(res.status).toBe(204);
    expect(await recent(ctx, user)).toEqual([]);
    expect(await recent(ctx, other)).toEqual(['saree']);
    expect((await request(ctx.app).delete(`${API}/me/search-history`)).status).toBe(401);
  });
});
