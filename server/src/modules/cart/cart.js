import { Router } from 'express';
import { z } from 'zod';
import { CART_ITEMS_MAX, LISTING_QUANTITY_MAX } from '../../config/policy.js';
import { AppError } from '../../lib/errors.js';
import { listingInclude, toListing } from '../listings/listings.service.js';
import { acceptedOffers, priceFor } from '../messaging/offers.service.js';

// The cart: sale listings a signed-in person means to buy, grouped by seller. It
// holds no stock; stock is reserved only when checkout starts.

const addSchema = z.strictObject({
  listingId: z.uuid(),
  quantity: z.number().int().min(1).max(LISTING_QUANTITY_MAX).default(1),
});
const quantitySchema = z.strictObject({
  quantity: z.number().int().min(1).max(LISTING_QUANTITY_MAX),
});
const listingParams = z.object({ listingId: z.uuid() });

/** Why an item cannot be bought right now, or null. */
function problemWith(listing, quantity) {
  if (listing.deletedAt || listing.status !== 'ACTIVE' || listing.seller.status !== 'ACTIVE') {
    return 'No longer available';
  }
  if (listing.quantity === 0) return 'Sold out';
  if (quantity > listing.quantity) return `Only ${listing.quantity} left`;
  return null;
}

/** The ways one seller's items can be handed over, and the delivery charge (I7). */
export function fulfilmentOptions(listings) {
  const delivery = listings.every((listing) => listing.offersDelivery)
    ? { chargePaise: Math.max(...listings.map((listing) => listing.deliveryChargePaise)) }
    : null;
  return { delivery, pickup: listings.every((listing) => listing.offersPickup) };
}

export async function loadCart(db, userId) {
  return db.cartItem.findMany({
    where: { userId },
    include: { listing: { include: listingInclude } },
    orderBy: [{ addedAt: 'asc' }, { listingId: 'asc' }],
  });
}

export async function cartView(db, userId, now) {
  const rows = await loadCart(db, userId);
  // An accepted offer sets the price, worked out here from the offer row (I74).
  const offers = await acceptedOffers(
    db,
    userId,
    rows.map((row) => row.listing.id),
    now,
  );
  for (const row of rows) {
    Object.assign(row, priceFor(row.listing, row.quantity, offers.get(row.listing.id)));
  }
  const groups = new Map();
  for (const row of rows) {
    const sellerId = row.listing.sellerId;
    if (!groups.has(sellerId)) groups.set(sellerId, []);
    groups.get(sellerId).push(row);
  }

  const view = [...groups.values()].map((items) => {
    const seller = items[0].listing.seller;
    const itemsSubtotalPaise = items.reduce(
      (sum, row) => sum + row.unitPricePaise * row.quantity,
      0,
    );
    return {
      seller: {
        id: seller.id,
        displayName: seller.profile.displayName,
        locality: seller.profile.locality,
      },
      items: items.map((row) => ({
        quantity: row.quantity,
        unitPricePaise: row.unitPricePaise,
        offerId: row.offerId,
        problem: problemWith(row.listing, row.quantity),
        listing: toListing(row.listing),
      })),
      itemsSubtotalPaise,
      options: fulfilmentOptions(items.map((row) => row.listing)),
    };
  });

  return {
    groups: view,
    itemCount: rows.length,
    itemsSubtotalPaise: view.reduce((sum, group) => sum + group.itemsSubtotalPaise, 0),
  };
}

async function addItem({ db, clock }, userId, { listingId, quantity }) {
  const listing = await db.listing.findFirst({
    where: { id: listingId, deletedAt: null },
    include: { seller: { select: { status: true } } },
  });
  if (!listing || listing.status !== 'ACTIVE' || listing.seller.status !== 'ACTIVE') {
    throw AppError.notFound('Listing not found');
  }
  if (listing.mode !== 'SALE') {
    throw new AppError(409, 'NOT_FOR_SALE', 'This item is for rent, not for sale');
  }
  if (listing.sellerId === userId) throw AppError.forbidden('You cannot buy your own listing');
  if (listing.quantity < quantity) {
    throw new AppError(
      409,
      'OUT_OF_STOCK',
      listing.quantity ? `Only ${listing.quantity} left` : 'Sold out',
    );
  }

  const existing = await db.cartItem.findUnique({
    where: { userId_listingId: { userId, listingId } },
  });
  if (!existing && (await db.cartItem.count({ where: { userId } })) >= CART_ITEMS_MAX) {
    throw new AppError(409, 'CART_FULL', `A cart can hold up to ${CART_ITEMS_MAX} items`);
  }
  await db.cartItem.upsert({
    where: { userId_listingId: { userId, listingId } },
    create: { userId, listingId, quantity, addedAt: clock.now() },
    update: { quantity },
  });
}

/** `/cart`: the signed-in person's cart. */
export function createCartRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth);

  router.get('/', async (req, res) => {
    res.json({ cart: await cartView(deps.db, req.auth.userId, deps.clock.now()) });
  });

  router.post('/items', async (req, res) => {
    await addItem(deps, req.auth.userId, addSchema.parse(req.body));
    res.status(201).json({ cart: await cartView(deps.db, req.auth.userId, deps.clock.now()) });
  });

  router.patch('/items/:listingId', async (req, res) => {
    const { listingId } = listingParams.parse(req.params);
    const { quantity } = quantitySchema.parse(req.body);
    const row = await deps.db.cartItem.findUnique({
      where: { userId_listingId: { userId: req.auth.userId, listingId } },
    });
    if (!row) throw AppError.notFound('Not in your cart');
    await addItem(deps, req.auth.userId, { listingId, quantity });
    res.json({ cart: await cartView(deps.db, req.auth.userId, deps.clock.now()) });
  });

  router.delete('/items/:listingId', async (req, res) => {
    const { listingId } = listingParams.parse(req.params);
    await deps.db.cartItem.deleteMany({ where: { userId: req.auth.userId, listingId } });
    res.json({ cart: await cartView(deps.db, req.auth.userId, deps.clock.now()) });
  });

  return router;
}
