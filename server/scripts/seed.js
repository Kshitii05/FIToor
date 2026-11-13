// Fills the development database with demo sellers and about 200 realistic
// listings, plus some likes and views so search sorting and the home page sections
// have something to work with.
//
//   npm run seed --workspace server
//
// Running it again replaces the earlier demo data; nothing else is touched.
// Demo accounts use emails like seed-seller-01@example.com. Set SEED_USER_PASSWORD
// in .env to be able to sign in as them; without it they get a random password.

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { env } from '../src/config/env.js';
import { db } from '../src/lib/db.js';
import { createImageStorage } from '../src/lib/imageStorage.js';
import { hashPassword } from '../src/lib/password.js';
import { POPULARITY_LIKE_WEIGHT } from '../src/config/policy.js';

if (env.NODE_ENV === 'production') {
  console.error('The seed script is for development only.');
  process.exit(1);
}

const SEED_EMAIL = (kind, n) => `seed-${kind}-${String(n).padStart(2, '0')}@example.com`;
const SELLERS = 12;
const SHOPPERS = 8;
const LISTINGS = 200;
const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Repeatable randomness: the same data every run.
// ---------------------------------------------------------------------------

let state = 20261113;
function random() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (min, max) => min + Math.floor(random() * (max - min + 1));
const chance = (probability) => random() < probability;
/** A rupee amount between min and max, rounded to ₹50, in paise. */
const rupees = (min, max) => Math.round(between(min, max) / 50) * 50 * 100;

// ---------------------------------------------------------------------------
// Photos: plain two-tone PNGs in the item's colour, made without any library.
// ---------------------------------------------------------------------------

const COLOURS = {
  Black: [34, 34, 34],
  White: [240, 238, 232],
  Indigo: [63, 81, 140],
  Navy: [32, 44, 84],
  Maroon: [110, 26, 40],
  Red: [178, 34, 52],
  Pink: [222, 140, 160],
  Mustard: [214, 162, 38],
  Olive: [110, 116, 58],
  Emerald: [24, 120, 88],
  Teal: [26, 120, 128],
  Beige: [214, 196, 168],
  Tan: [176, 128, 82],
  Brown: [102, 66, 40],
  Grey: [128, 128, 128],
  Gold: [196, 160, 72],
  Lavender: [168, 150, 200],
  Peach: [240, 180, 150],
};

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

function photo([r, g, b], shade) {
  const width = 400;
  const height = 500;
  const row = Buffer.alloc(width * 3 + 1);
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    // A darker band across the lower part, so each photo is not one flat colour.
    const factor = y > height * 0.72 ? 0.8 - shade : 1 - shade / 2;
    for (let x = 0; x < width; x += 1) {
      row[1 + x * 3] = Math.round(r * factor);
      row[2 + x * 3] = Math.round(g * factor);
      row[3 + x * 3] = Math.round(b * factor);
    }
    rows.push(Buffer.from(row));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // true colour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const SHOE_SIZES = ['UK 4', 'UK 5', 'UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10'];
const SUIT_SIZES = ['36', '38', '40', '42', '44'];

const SALE_ITEMS = {
  ETHNIC_WEAR: {
    items: [
      ['Block-print cotton kurta', 'hand block-printed, breathable cotton'],
      ['Chikankari kurti', 'delicate Lucknowi thread work'],
      ['Banarasi silk saree', 'zari border with a rich pallu, blouse piece included'],
      ['Handloom cotton saree', 'soft drape, perfect for office wear'],
      ['Anarkali suit set', 'flared kurta with churidar and dupatta'],
      ['Palazzo kurta set', 'relaxed fit with printed palazzos'],
      ['Nehru jacket', 'textured fabric, goes over any kurta'],
      ['Kurta pyjama set', 'classic cut for festivals and pujas'],
      ['Mirror-work kurti', 'Gujarati mirror embroidery on the yoke'],
    ],
    brands: [
      'Fabindia',
      'Biba',
      'W',
      'Global Desi',
      'Manyavar',
      'Anokhi',
      'Aurelia',
      'Libas',
      'Unbranded',
    ],
    sizes: CLOTHING_SIZES,
    price: [500, 6000],
  },
  WESTERN_WEAR: {
    items: [
      ['Denim jacket', 'classic blue wash, slightly oversized'],
      ['Floral midi dress', 'flowy fabric with a tie waist'],
      ['Linen shirt', 'cool and crisp for summer'],
      ['High-waist jeans', 'straight leg, stretchy denim'],
      ['Ribbed crop top', 'soft knit, fitted'],
      ['Wrap dress', 'flattering V-neck, knee length'],
      ['Oversized hoodie', 'fleece lined, very warm'],
      ['Pleated skirt', 'midi length, satin finish'],
      ['Slim chinos', 'everyday trousers in cotton twill'],
      ['Polo t-shirt', 'pique cotton, holds its shape'],
    ],
    brands: [
      "Levi's",
      'Zara',
      'H&M',
      'Mango',
      'Uniqlo',
      'Only',
      'Vero Moda',
      'Marks & Spencer',
      'Forever 21',
    ],
    sizes: CLOTHING_SIZES,
    price: [300, 3500],
  },
  FOOTWEAR: {
    items: [
      ['Kolhapuri chappals', 'handmade leather, soft sole'],
      ['Leather loafers', 'slip-on, polished finish'],
      ['White sneakers', 'clean minimal design, easy to style'],
      ['Block heels', 'comfortable 2-inch heel'],
      ['Embroidered juttis', 'Punjabi juttis with thread work'],
      ['Ankle boots', 'suede with a side zip'],
      ['Running shoes', 'cushioned and light'],
      ['Strappy sandals', 'adjustable buckle'],
    ],
    brands: ['Bata', 'Metro', 'Woodland', 'Nike', 'Adidas', 'Puma', 'Mochi', 'Clarks'],
    sizes: SHOE_SIZES,
    price: [400, 5000],
  },
  ACCESSORIES: {
    items: [
      ['Oxidised silver jhumkas', 'lightweight, statement earrings'],
      ['Silk stole', 'soft and shiny, many ways to drape'],
      ['Leather belt', 'genuine leather with a metal buckle'],
      ['Aviator sunglasses', 'UV protection, comes with case'],
      ['Analog wrist watch', 'leather strap, keeps good time'],
      ['Pashmina shawl', 'warm and very soft'],
      ['Printed scarf', 'light cotton, bright print'],
    ],
    brands: ['Accessorize', 'Titan', 'Fastrack', 'Ray-Ban', 'Zaveri Pearls', 'Unbranded'],
    sizes: ['One size'],
    price: [200, 4000],
  },
  BAGS: {
    items: [
      ['Leather tote bag', 'roomy, fits a laptop'],
      ['Sling bag', 'compact with an adjustable strap'],
      ['Potli bag', 'embroidered, for weddings and parties'],
      ['Canvas backpack', 'two pockets, sturdy straps'],
      ['Evening clutch', 'beaded, with a chain strap'],
      ['Laptop bag', 'padded sleeve, fits 15-inch laptops'],
    ],
    brands: ['Hidesign', 'Baggit', 'Caprese', 'Lavie', 'Da Milano', 'Unbranded'],
    sizes: ['One size'],
    price: [400, 5000],
  },
  FORMAL_WEAR: {
    items: [
      ['Single-breasted blazer', 'sharp shoulders, half-lined'],
      ['Two-piece suit', 'wool blend, ready for interviews'],
      ['Formal trousers', 'flat front, easy care'],
      ['Formal shirt', 'wrinkle-resistant cotton'],
      ['Cocktail dress', 'fitted, knee length'],
    ],
    brands: [
      'Raymond',
      'Van Heusen',
      'Allen Solly',
      'Louis Philippe',
      'Blackberrys',
      'Peter England',
      'Mango',
    ],
    sizes: SUIT_SIZES,
    price: [800, 9000],
  },
};

const RENT_ITEMS = {
  ETHNIC_WEAR: {
    items: [
      ['Embroidered bridal lehenga', 'heavy zari and sequin work, can-can included'],
      ['Designer lehenga choli', 'lightweight, perfect for sangeet'],
      ['Silk sherwani', 'with stole and safa, fully lined'],
      ['Velvet sherwani', 'rich velvet for winter weddings'],
      ['Kanjeevaram silk saree', 'pure silk with temple border'],
      ['Mirror-work ghagra', 'twirls beautifully for garba'],
      ['Indo-western gown', 'drape style with a cape'],
    ],
    brands: ['Manyavar', 'Mohey', 'Kalki', 'Frontier Raas', 'Unbranded'],
    sizes: CLOTHING_SIZES,
    price: [1500, 8000],
  },
  FORMAL_WEAR: {
    items: [
      ['Black tuxedo', 'satin lapels, with bow tie'],
      ['Three-piece suit', 'with waistcoat, tailored fit'],
      ['Evening gown', 'floor length, flowing'],
      ['Sequin party dress', 'sparkly, for receptions'],
    ],
    brands: ['Raymond', 'Blackberrys', 'Van Heusen', 'Unbranded'],
    sizes: SUIT_SIZES,
    price: [1200, 5000],
  },
  ACCESSORIES: {
    items: [
      ['Kundan bridal jewellery set', 'necklace, earrings and maang tikka'],
      ['Polki choker set', 'with matching earrings'],
    ],
    brands: ['Zaveri Pearls', 'Unbranded'],
    sizes: ['One size'],
    price: [800, 3000],
  },
  BAGS: {
    items: [['Embellished bridal clutch', 'crystal work, matches most outfits']],
    brands: ['Unbranded', 'Da Milano'],
    sizes: ['One size'],
    price: [400, 1200],
  },
};

const CONDITION_NOTES = {
  NEW: ['Never worn, tags still on.', 'Bought for an event and never used.'],
  GOOD: ['Worn a few times, well looked after.', 'Gently used, no stains or tears.'],
  FAIR: ['Visible wear but plenty of life left.', 'Some fading from washing, priced to match.'],
};
const FIT_NOTES = [
  'Fits true to size.',
  'Runs slightly small; please check measurements.',
  'Relaxed fit.',
  'Dry clean recommended.',
  'Smoke-free, pet-free home.',
  'Happy to share more photos on request.',
];

const SELLER_PROFILES = [
  ['Ananya Rao', 'Indiranagar'],
  ['Rohan Mehta', 'Koramangala'],
  ['Priya Nair', 'HSR Layout'],
  ['Arjun Iyer', 'Jayanagar'],
  ['Sneha Kulkarni', 'Whitefield'],
  ['Kabir Singh', 'Malleshwaram'],
  ['Meera Pillai', 'JP Nagar'],
  ['Aditya Sharma', 'Banashankari'],
  ['Ishita Das', 'Frazer Town'],
  ['Vikram Reddy', 'Marathahalli'],
  ['Tanvi Joshi', 'Basavanagudi'],
  ['Farhan Khan', 'Richmond Town'],
];

function makeListing(index, now) {
  const rent = chance(0.3);
  const catalogue = rent ? RENT_ITEMS : SALE_ITEMS;
  const category = pick(Object.keys(catalogue));
  const { items, brands, sizes, price } = catalogue[category];
  const [title, detail] = pick(items);
  const colour = pick(Object.keys(COLOURS));
  const condition = rent ? pick(['NEW', 'GOOD', 'GOOD']) : pick(['NEW', 'GOOD', 'GOOD', 'FAIR']);
  const brand = pick(brands);
  const size = title.includes('saree') || title.includes('stole') ? 'Free size' : pick(sizes);

  const description = [
    `${colour} ${title.toLowerCase()} by ${brand === 'Unbranded' ? 'a local maker' : brand}, ${detail}.`,
    pick(CONDITION_NOTES[condition]),
    pick(FIT_NOTES),
  ].join(' ');

  const createdAt = new Date(now - between(0, 60) * DAY - between(0, 23) * 60 * 60 * 1000);
  const delivery = chance(0.6)
    ? {
        offersDelivery: true,
        deliveryChargePaise: rupees(0, 150),
        deliveryRadiusKm: between(3, 15),
      }
    : { offersDelivery: false, deliveryChargePaise: null, deliveryRadiusKm: null };
  const pickup = !delivery.offersDelivery || chance(0.8);

  const base = {
    title: `${colour} ${title.charAt(0).toLowerCase()}${title.slice(1)}`.replace(/^./, (c) =>
      c.toUpperCase(),
    ),
    description,
    category,
    condition,
    brand,
    size,
    colour,
    ...delivery,
    offersPickup: pickup,
    status: chance(0.03) ? 'PAUSED' : 'ACTIVE',
    createdAt,
  };

  if (!rent) {
    const pricePaise = rupees(...price);
    const quantity = chance(0.04) ? 0 : chance(0.08) ? between(2, 3) : 1;
    return { ...base, mode: 'SALE', pricePaise, quantity, headlinePricePaise: pricePaise };
  }

  const oneDay = rupees(...price);
  const lengths = pick([
    [1, 3],
    [1, 3, 7],
    [3, 7],
    [2, 5],
  ]);
  const factor = { 1: 1, 2: 1.7, 3: 2.2, 5: 3.2, 7: 4 };
  const packages = lengths.map((days) => ({
    durationDays: days,
    pricePaise: Math.round((oneDay * factor[days]) / 5000) * 5000,
  }));
  return {
    ...base,
    mode: 'RENT',
    depositPaise: Math.round((oneDay * between(2, 5)) / 10000) * 10000,
    lateFeePerDayPaise: Math.round(oneDay / 2 / 5000) * 5000,
    packages,
    headlinePricePaise: Math.min(...packages.map((p) => p.pricePaise)),
    imageCount: index % 3 === 0 ? 3 : 2,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function removeOldSeed(imageStorage) {
  const users = await db.user.findMany({
    where: { email: { startsWith: 'seed-', endsWith: '@example.com' } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return 0;

  const images = await db.listingImage.findMany({
    where: { listing: { sellerId: { in: userIds } } },
    select: { storageId: true },
  });
  for (const { storageId } of images) {
    await imageStorage.remove(storageId).catch(() => {});
  }
  await db.listingStatusEvent.deleteMany({ where: { listing: { sellerId: { in: userIds } } } });
  await db.listing.deleteMany({ where: { sellerId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  return userIds.length;
}

async function createUsers(kind, count, passwordHash, now) {
  const users = [];
  for (let n = 1; n <= count; n += 1) {
    const [displayName, locality] =
      kind === 'seller' ? SELLER_PROFILES[n - 1] : [`Demo shopper ${n}`, null];
    users.push(
      await db.user.create({
        data: {
          email: SEED_EMAIL(kind, n),
          phone: `+91${kind === 'seller' ? '70000' : '70001'}${String(n).padStart(5, '0')}`,
          passwordHash,
          emailVerifiedAt: now,
          phoneVerifiedAt: now,
          createdAt: new Date(now.getTime() - 90 * DAY),
          profile: {
            create: {
              displayName,
              locality,
              bio:
                kind === 'seller' ? 'Clearing out my wardrobe. Happy to answer questions.' : null,
            },
          },
          preferences: { create: {} },
        },
      }),
    );
  }
  return users;
}

async function main() {
  const imageStorage = createImageStorage();
  const now = new Date();

  const removed = await removeOldSeed(imageStorage);
  if (removed) console.log(`Removed ${removed} earlier demo accounts and their listings.`);

  const password = env.SEED_USER_PASSWORD || crypto.randomBytes(24).toString('base64url');
  const passwordHash = await hashPassword(password);
  const sellers = await createUsers('seller', SELLERS, passwordHash, now);
  const shoppers = await createUsers('shopper', SHOPPERS, passwordHash, now);

  const photoCache = new Map();
  const listings = [];
  for (let i = 0; i < LISTINGS; i += 1) {
    const seller = sellers[i % SELLERS];
    const { packages, imageCount = between(1, 3), ...fields } = makeListing(i, now.getTime());

    const files = [];
    for (let position = 0; position < imageCount; position += 1) {
      const key = `${fields.colour}-${position}`;
      if (!photoCache.has(key)) photoCache.set(key, photo(COLOURS[fields.colour], position * 0.12));
      files.push(
        await imageStorage.upload({
          buffer: photoCache.get(key),
          extension: 'png',
          folder: 'listings',
        }),
      );
    }

    const listing = await db.listing.create({
      data: {
        ...fields,
        sellerId: seller.id,
        packages: packages ? { create: packages } : undefined,
        images: {
          create: files.map(({ url, storageId }, position) => ({
            url,
            storageId,
            position,
            createdAt: fields.createdAt,
          })),
        },
        statusEvents: {
          create: {
            actorUserId: seller.id,
            action: 'CREATED',
            toStatus: 'ACTIVE',
            createdAt: fields.createdAt,
          },
        },
      },
    });
    listings.push(listing);
  }

  // Activity, so popularity, trending and recommendations have something to show.
  const people = [...sellers, ...shoppers];
  const likes = [];
  const views = [];
  for (const listing of listings) {
    const fans = people.filter((p) => p.id !== listing.sellerId && chance(0.12));
    for (const fan of fans) likes.push({ userId: fan.id, listingId: listing.id, createdAt: now });
    const lookers = people.filter((p) => p.id !== listing.sellerId && chance(0.3));
    for (const looker of lookers) {
      const daysAgo = between(0, 29);
      const day = new Date(now.getTime() - daysAgo * DAY);
      views.push({ userId: looker.id, listingId: listing.id, viewedOn: day });
    }
  }
  await db.listingLike.createMany({ data: likes, skipDuplicates: true });
  await db.listingView.createMany({ data: views, skipDuplicates: true });

  const ids = listings.map((l) => l.id);
  await db.$executeRaw`
    UPDATE listings l SET
      view_count = (SELECT count(*) FROM listing_views v WHERE v.listing_id = l.id),
      like_count = (SELECT count(*) FROM listing_likes k WHERE k.listing_id = l.id),
      popularity_score =
        (SELECT count(*) FROM listing_views v WHERE v.listing_id = l.id)
        + ${POPULARITY_LIKE_WEIGHT} * (SELECT count(*) FROM listing_likes k WHERE k.listing_id = l.id)
    WHERE l.id = ANY(${ids}::uuid[])`;

  const rentals = listings.filter((l) => l.mode === 'RENT').length;
  console.log(
    `Created ${SELLERS} demo sellers, ${SHOPPERS} demo shoppers and ${listings.length} listings ` +
      `(${listings.length - rentals} for sale, ${rentals} for rent), ` +
      `with ${likes.length} likes and ${views.length} views.`,
  );
  console.log(
    env.SEED_USER_PASSWORD
      ? `Sign in as ${SEED_EMAIL('seller', 1)} (or any seed-seller/seed-shopper) with SEED_USER_PASSWORD.`
      : 'Demo accounts have a random password. Set SEED_USER_PASSWORD in .env and run again to sign in as them.',
  );
}

try {
  await main();
} finally {
  await db.$disconnect();
}
