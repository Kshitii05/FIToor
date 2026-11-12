import request from 'supertest';

// Smallest byte sequences the server accepts as each image type: it reads the
// leading bytes, not the file name.
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
export const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
  Buffer.alloc(32),
]);

export function saleDetails(overrides = {}) {
  return {
    mode: 'SALE',
    title: 'Block-print cotton kurta',
    description: 'Worn twice, hand block-printed in Jaipur. No stains or tears.',
    category: 'ETHNIC_WEAR',
    condition: 'GOOD',
    brand: 'Fabindia',
    size: 'M',
    colour: 'Indigo',
    pricePaise: 120000,
    quantity: 1,
    delivery: { chargePaise: 8000, radiusKm: 10 },
    pickup: true,
    ...overrides,
  };
}

export function rentDetails(overrides = {}) {
  return {
    mode: 'RENT',
    title: 'Embroidered wedding lehenga',
    description: 'Heavy zari work, dry-cleaned after every rental. Blouse included.',
    category: 'ETHNIC_WEAR',
    condition: 'NEW',
    brand: 'Sabyasachi',
    size: 'S',
    colour: 'Maroon',
    depositPaise: 1000000,
    lateFeePerDayPaise: 50000,
    packages: [
      { durationDays: 1, pricePaise: 250000 },
      { durationDays: 3, pricePaise: 600000 },
      { durationDays: 7, pricePaise: 1200000 },
    ],
    delivery: null,
    pickup: true,
    ...overrides,
  };
}

/** Sends a create-listing request: details as JSON in `data`, photos as files. */
export function postListing(ctx, account, details, images = [PNG]) {
  const req = request(ctx.app)
    .post('/api/v1/listings')
    .set(account.bearer)
    .field('data', JSON.stringify(details));
  images.forEach((buffer, index) => req.attach('images', buffer, `photo-${index}.png`));
  return req;
}

/** Creates a listing and returns it, failing loudly if the request was refused. */
export async function createListing(ctx, account, details = saleDetails(), images = [PNG]) {
  const res = await postListing(ctx, account, details, images);
  if (res.status !== 201) {
    throw new Error(`Listing creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.listing;
}
