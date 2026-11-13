import { CHECKOUT_RESERVATION_MINUTES } from '../../config/policy.js';
import { addMinutes } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { pointSql } from '../../lib/geo.js';
import { loadOwnAddress, toAddress } from '../addresses/addresses.js';
import { fulfilmentOptions, loadCart } from '../cart/cart.js';

// Checkout: fixes prices from the database, reserves stock for 15 minutes (I4) and
// opens a payment on the gateway. Paying it creates one order per seller (see
// payments.service.js). Nothing here trusts amounts sent by the browser.

export function toCheckout(checkout, gateway) {
  return {
    id: checkout.id,
    status: checkout.status,
    totalPaise: checkout.totalPaise,
    expiresAt: checkout.expiresAt.toISOString(),
    groups: checkout.groups.map((group) => ({
      sellerId: group.sellerId,
      fulfilment: group.fulfilment,
      itemsSubtotalPaise: group.itemsSubtotalPaise,
      deliveryChargePaise: group.deliveryChargePaise,
      items: checkout.items
        .filter((item) => item.groupId === group.id)
        .map((item) => ({
          listingId: item.listingId,
          title: item.title,
          quantity: item.quantity,
          unitPricePaise: item.unitPricePaise,
        })),
    })),
    payment: checkout.gatewayOrderId
      ? {
          gateway: gateway.mode,
          keyId: gateway.keyId,
          gatewayOrderId: checkout.gatewayOrderId,
          amountPaise: checkout.totalPaise,
          currency: 'INR',
        }
      : null,
    orderIds: (checkout.orders ?? []).map((order) => order.id),
  };
}

export const checkoutInclude = { groups: true, items: true, orders: { select: { id: true } } };

/** Puts the stock reserved by a checkout back on sale. Use inside a transaction. */
export async function releaseStock(tx, checkoutId) {
  const items = await tx.checkoutItem.findMany({ where: { checkoutId } });
  for (const item of items) {
    await tx.$executeRaw`
      UPDATE listings SET quantity = quantity + ${item.quantity} WHERE id = ${item.listingId}::uuid`;
  }
}

/**
 * Takes stock for every item of a checkout, all or nothing. Returns false (and takes
 * nothing) when any item no longer has enough. Use inside a transaction.
 */
export async function reserveStock(tx, items) {
  for (const item of items) {
    // Conditional update: two buyers can never both take the last unit.
    const taken = await tx.$executeRaw`
      UPDATE listings SET quantity = quantity - ${item.quantity}
      WHERE id = ${item.listingId}::uuid AND quantity >= ${item.quantity}
        AND status = 'ACTIVE' AND deleted_at IS NULL`;
    if (taken !== 1) return false;
  }
  return true;
}

function groupCart(rows) {
  const bySeller = new Map();
  for (const row of rows) {
    if (!bySeller.has(row.listing.sellerId)) bySeller.set(row.listing.sellerId, []);
    bySeller.get(row.listing.sellerId).push(row);
  }
  return bySeller;
}

async function outsideDeliveryRadius(db, listingIds, address) {
  const rows = await db.$queryRaw`
    SELECT l.id, l.title FROM listings l
    WHERE l.id = ANY(${listingIds}::uuid[])
      AND (l.public_location IS NULL
        OR NOT ST_DWithin(l.public_location, ${pointSql(address)}, l.delivery_radius_km * 1000))`;
  return rows;
}

/**
 * Starts a checkout for everything in the buyer's cart. `choices` says, per seller,
 * delivery (with a saved address) or pickup. Replaces any open checkout of theirs.
 */
export async function createCheckout(deps, buyerId, choices) {
  const { db, clock, paymentGateway } = deps;
  const cart = await loadCart(db, buyerId);
  if (cart.length === 0) throw new AppError(400, 'CART_EMPTY', 'Your cart is empty');

  const bySeller = groupCart(cart);
  const chosen = new Map(choices.map((choice) => [choice.sellerId, choice]));
  if (
    chosen.size !== choices.length ||
    chosen.size !== bySeller.size ||
    [...bySeller.keys()].some((id) => !chosen.has(id))
  ) {
    throw AppError.badRequest('Choose delivery or pickup for each seller in your cart, once');
  }

  const groups = [];
  for (const [sellerId, rows] of bySeller) {
    const listings = rows.map((row) => row.listing);
    for (const listing of listings) {
      if (listing.sellerId === buyerId) throw AppError.forbidden('You cannot buy your own listing');
      if (
        listing.deletedAt ||
        listing.status !== 'ACTIVE' ||
        listing.seller.status !== 'ACTIVE' ||
        listing.mode !== 'SALE'
      ) {
        throw new AppError(409, 'ITEM_UNAVAILABLE', `“${listing.title}” is no longer available`);
      }
    }

    const choice = chosen.get(sellerId);
    const options = fulfilmentOptions(listings);
    let deliveryAddress = null;
    let deliveryChargePaise = 0;
    if (choice.fulfilment === 'DELIVERY') {
      if (!options.delivery) {
        throw new AppError(
          409,
          'DELIVERY_NOT_OFFERED',
          'This seller does not deliver all of these items',
        );
      }
      if (!choice.addressId) throw AppError.badRequest('Choose a delivery address');
      const address = await loadOwnAddress(db, buyerId, choice.addressId);
      const tooFar = await outsideDeliveryRadius(
        db,
        listings.map((l) => l.id),
        address,
      );
      if (tooFar.length > 0) {
        throw new AppError(409, 'OUTSIDE_DELIVERY_RADIUS', 'The seller does not deliver that far', {
          listingIds: tooFar.map((row) => row.id),
        });
      }
      deliveryAddress = toAddress(address);
      deliveryChargePaise = options.delivery.chargePaise;
    } else if (!options.pickup) {
      throw new AppError(
        409,
        'PICKUP_NOT_OFFERED',
        'This seller does not offer pickup for all of these items',
      );
    }

    groups.push({
      sellerId,
      fulfilment: choice.fulfilment,
      deliveryAddress,
      deliveryChargePaise,
      items: rows.map((row) => ({
        listingId: row.listing.id,
        quantity: row.quantity,
        unitPricePaise: row.listing.pricePaise,
        title: row.listing.title,
      })),
    });
  }

  const now = clock.now();
  for (const group of groups) {
    group.itemsSubtotalPaise = group.items.reduce(
      (sum, item) => sum + item.unitPricePaise * item.quantity,
      0,
    );
  }
  const totalPaise = groups.reduce(
    (sum, g) => sum + g.itemsSubtotalPaise + g.deliveryChargePaise,
    0,
  );

  const checkout = await db.$transaction(async (tx) => {
    // A new checkout replaces the buyer's open one, giving its stock back.
    const open = await tx.checkout.findMany({ where: { buyerId, status: 'OPEN' } });
    for (const previous of open) {
      const { count } = await tx.checkout.updateMany({
        where: { id: previous.id, status: 'OPEN' },
        data: { status: 'EXPIRED', releasedAt: now },
      });
      if (count === 1) await releaseStock(tx, previous.id);
    }

    if (
      !(await reserveStock(
        tx,
        groups.flatMap((group) => group.items),
      ))
    ) {
      throw new AppError(
        409,
        'OUT_OF_STOCK',
        'Someone else got there first: an item in your cart is sold out',
      );
    }

    const created = await tx.checkout.create({
      data: {
        buyerId,
        totalPaise,
        expiresAt: addMinutes(now, CHECKOUT_RESERVATION_MINUTES),
        createdAt: now,
      },
    });
    for (const group of groups) {
      const row = await tx.checkoutGroup.create({
        data: {
          checkoutId: created.id,
          sellerId: group.sellerId,
          fulfilment: group.fulfilment,
          itemsSubtotalPaise: group.itemsSubtotalPaise,
          deliveryChargePaise: group.deliveryChargePaise,
          deliveryAddress: group.deliveryAddress ?? undefined,
        },
      });
      await tx.checkoutItem.createMany({
        data: group.items.map((item) => ({ ...item, checkoutId: created.id, groupId: row.id })),
      });
    }
    return created;
  });

  // The gateway is called outside the transaction, so no lock is held during the call.
  try {
    const order = await paymentGateway.createOrder({
      amountPaise: totalPaise,
      receipt: checkout.id,
      notes: { checkoutId: checkout.id },
    });
    await db.checkout.update({ where: { id: checkout.id }, data: { gatewayOrderId: order.id } });
  } catch (error) {
    await db.$transaction(async (tx) => {
      const { count } = await tx.checkout.updateMany({
        where: { id: checkout.id, status: 'OPEN' },
        data: { status: 'EXPIRED', releasedAt: clock.now() },
      });
      if (count === 1) await releaseStock(tx, checkout.id);
    });
    deps.logger.error(error);
    throw new AppError(
      503,
      'PAYMENTS_UNAVAILABLE',
      'Payments are not available right now. Please try again.',
    );
  }

  return toCheckout(
    await db.checkout.findUniqueOrThrow({ where: { id: checkout.id }, include: checkoutInclude }),
    paymentGateway,
  );
}

/** Ends checkouts left unpaid past their 15 minutes and releases their stock. */
export async function expireCheckouts({ db, clock }) {
  const now = clock.now();
  const due = await db.checkout.findMany({
    where: { status: 'OPEN', expiresAt: { lte: now } },
    select: { id: true },
  });
  let expired = 0;
  for (const { id } of due) {
    await db.$transaction(async (tx) => {
      const { count } = await tx.checkout.updateMany({
        where: { id, status: 'OPEN', expiresAt: { lte: now } },
        data: { status: 'EXPIRED', releasedAt: now },
      });
      if (count !== 1) return;
      await releaseStock(tx, id);
      expired += 1;
    });
  }
  return expired;
}
