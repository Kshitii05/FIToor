import { LISTING_IMAGES_MAX, LISTING_IMAGES_MIN } from '../../config/policy.js';
import { AppError } from '../../lib/errors.js';
import { detectImageType } from '../../lib/imageType.js';
import { publicPoint } from '../../lib/geo.js';
import { paged, pageWindow } from '../../lib/pagination.js';
import { likedListingIds, recordView } from '../discovery/activity.service.js';

const IMAGE_FOLDER = 'listings';

export const listingInclude = {
  images: { orderBy: { position: 'asc' } },
  packages: { orderBy: { durationDays: 'asc' } },
  seller: { select: { id: true, status: true, profile: true } },
};

// What everyone may see: live listings of sellers whose accounts are active.
export const PUBLICLY_VISIBLE = { deletedAt: null, status: 'ACTIVE', seller: { status: 'ACTIVE' } };

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

/**
 * Built field by field so nothing private (seller contact details, storage
 * identifiers, the exact pin) can leak into a response. `liked` is whether the
 * person asking has liked it. `forOwner` adds what only the seller may see.
 */
export function toListing(listing, liked = false, forOwner = false) {
  const forSale = listing.mode === 'SALE';
  return {
    id: listing.id,
    mode: listing.mode,
    status: listing.status,
    // Whether it can be bought or requested right now.
    available: listing.status === 'ACTIVE' && (!forSale || listing.quantity > 0),
    title: listing.title,
    description: listing.description,
    category: listing.category,
    condition: listing.condition,
    brand: listing.brand,
    size: listing.size,
    colour: listing.colour,
    sale: forSale ? { pricePaise: listing.pricePaise, quantity: listing.quantity } : null,
    rent: forSale
      ? null
      : {
          depositPaise: listing.depositPaise,
          lateFeePerDayPaise: listing.lateFeePerDayPaise,
          packages: listing.packages.map((p) => ({
            id: p.id,
            durationDays: p.durationDays,
            pricePaise: p.pricePaise,
          })),
        },
    delivery: listing.offersDelivery
      ? { chargePaise: listing.deliveryChargePaise, radiusKm: listing.deliveryRadiusKm }
      : null,
    pickup: listing.offersPickup,
    // Approximate: the centre of a ~500 m square, never the exact spot.
    location:
      listing.publicLat === null
        ? null
        : { lat: listing.publicLat, lng: listing.publicLng, locality: listing.locality },
    ...(forOwner
      ? { pin: listing.pinLat === null ? null : { lat: listing.pinLat, lng: listing.pinLng } }
      : {}),
    likeCount: listing.likeCount,
    liked,
    images: listing.images.map((image) => ({
      id: image.id,
      url: image.url,
      position: image.position,
    })),
    seller: {
      id: listing.seller.id,
      displayName: listing.seller.profile.displayName,
      photoUrl: listing.seller.profile.photoUrl,
      locality: listing.seller.profile.locality,
    },
    createdAt: listing.createdAt.toISOString(),
    updatedAt: listing.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** Checks uploaded files are real JPEG, PNG or WebP images, by content. */
function readImages(files) {
  return (files ?? []).map((file) => {
    const type = detectImageType(file.buffer);
    if (!type) {
      throw new AppError(400, 'UNSUPPORTED_IMAGE', 'Photos must be JPEG, PNG or WebP images');
    }
    return { buffer: file.buffer, extension: type.extension };
  });
}

async function storeImages({ imageStorage }, images) {
  const stored = [];
  try {
    for (const image of images) {
      stored.push(await imageStorage.upload({ ...image, folder: IMAGE_FOLDER }));
    }
  } catch (error) {
    await discardStored({ imageStorage }, stored);
    throw error;
  }
  return stored;
}

/** Best-effort removal of stored files; a failure is logged and never fails the request. */
async function discardStored({ imageStorage, logger }, stored) {
  for (const { storageId } of stored) {
    try {
      await imageStorage.remove(storageId);
    } catch (error) {
      logger?.error(error);
    }
  }
}

// ---------------------------------------------------------------------------
// Loading and ownership
// ---------------------------------------------------------------------------

async function loadListing(db, id) {
  const listing = await db.listing.findFirst({
    where: { id, deletedAt: null },
    include: listingInclude,
  });
  if (!listing) throw AppError.notFound('Listing not found');
  return listing;
}

/** Loads a listing for a change by its seller. Anyone else is refused. */
async function loadOwnListing(db, id, userId) {
  const listing = await loadListing(db, id);
  if (listing.sellerId !== userId) throw AppError.forbidden('This is not your listing');
  return listing;
}

function assertEditable(listing) {
  if (listing.status === 'REMOVED') {
    throw new AppError(409, 'LISTING_REMOVED', 'This listing was removed and cannot be changed');
  }
}

function recordEvent(tx, clock, { listingId, actorUserId, action, fromStatus, toStatus }) {
  return tx.listingStatusEvent.create({
    data: {
      listingId,
      actorUserId,
      action,
      fromStatus: fromStatus ?? null,
      toStatus: toStatus ?? null,
      createdAt: clock.now(),
    },
  });
}

// ---------------------------------------------------------------------------
// Create, read, update
// ---------------------------------------------------------------------------

/** The price shown for a listing: its sale price, or its cheapest rental package. */
function headlinePrice({ pricePaise, packages }) {
  return pricePaise ?? Math.min(...packages.map((option) => option.pricePaise));
}

/** The stored form of a location: the private pin and its public grid point. */
function locationColumns({ lat, lng, locality }) {
  const shown = publicPoint({ lat, lng });
  return { pinLat: lat, pinLng: lng, publicLat: shown.lat, publicLng: shown.lng, locality };
}

function fulfilmentColumns({ delivery, pickup }) {
  return {
    offersDelivery: delivery !== null,
    deliveryChargePaise: delivery?.chargePaise ?? null,
    deliveryRadiusKm: delivery?.radiusKm ?? null,
    offersPickup: pickup,
  };
}

export async function createListing(deps, sellerId, input, files) {
  const { db, clock } = deps;

  const images = readImages(files);
  if (images.length < LISTING_IMAGES_MIN) {
    throw new AppError(400, 'IMAGE_REQUIRED', 'Add at least one photo');
  }

  const stored = await storeImages(deps, images);
  const now = clock.now();
  const { mode, delivery, pickup, packages, location, ...fields } = input;

  try {
    const listing = await db.$transaction(async (tx) => {
      const created = await tx.listing.create({
        data: {
          ...fields,
          ...fulfilmentColumns({ delivery, pickup }),
          ...locationColumns(location),
          mode,
          sellerId,
          createdAt: now,
          headlinePricePaise: headlinePrice({ pricePaise: fields.pricePaise, packages }),
          packages: packages ? { create: packages } : undefined,
          images: {
            create: stored.map(({ url, storageId }, position) => ({
              url,
              storageId,
              position,
              createdAt: now,
            })),
          },
        },
        include: listingInclude,
      });
      // Listings are published automatically (SPEC Module 2).
      await recordEvent(tx, clock, {
        listingId: created.id,
        actorUserId: sellerId,
        action: 'CREATED',
        toStatus: created.status,
      });
      return created;
    });
    return toListing(listing, false, true);
  } catch (error) {
    await discardStored(deps, stored);
    throw error;
  }
}

/** A listing as seen by `viewerId` (null for a visitor). Owners see their own in any state. */
export async function getListing({ db, clock }, id, viewerId) {
  const listing = await loadListing(db, id);
  const isOwner = viewerId !== null && listing.sellerId === viewerId;
  const isPublic = listing.status === 'ACTIVE' && listing.seller.status === 'ACTIVE';
  if (!isOwner && !isPublic) throw AppError.notFound('Listing not found');

  if (isOwner) return toListing(listing, false, true);
  if (viewerId === null) return toListing(listing);

  // Someone else, signed in, looking at a live listing: that is a view.
  await recordView({ db, clock }, { userId: viewerId, listingId: id });
  const liked = await likedListingIds(db, viewerId, [id]);
  return toListing(listing, liked.has(id));
}

/**
 * Applies a seller's edits. `parseChanges(mode)` validates the request body against
 * the schema for the listing's mode, which is only known once the listing is loaded.
 */
export async function updateListing({ db }, id, userId, parseChanges) {
  const listing = await loadOwnListing(db, id, userId);
  assertEditable(listing);

  const { delivery, pickup, packages, location, ...fields } = parseChanges(listing.mode);
  const data = { ...fields, ...(location ? locationColumns(location) : {}) };
  if (fields.pricePaise !== undefined || packages) {
    data.headlinePricePaise = headlinePrice({ pricePaise: fields.pricePaise, packages });
  }

  if (delivery !== undefined || pickup !== undefined) {
    const next = {
      delivery:
        delivery !== undefined
          ? delivery
          : listing.offersDelivery
            ? { chargePaise: listing.deliveryChargePaise, radiusKm: listing.deliveryRadiusKm }
            : null,
      pickup: pickup ?? listing.offersPickup,
    };
    if (next.delivery === null && !next.pickup) {
      throw AppError.badRequest('Offer delivery, pickup or both');
    }
    Object.assign(data, fulfilmentColumns(next));
  }

  const updated = await db.$transaction(async (tx) => {
    if (packages) {
      await tx.rentalPackage.deleteMany({ where: { listingId: id } });
      await tx.rentalPackage.createMany({
        data: packages.map((p) => ({ ...p, listingId: id })),
      });
    }
    return tx.listing.update({ where: { id }, data, include: listingInclude });
  });

  return toListing(updated, false, true);
}

// ---------------------------------------------------------------------------
// Status changes by the seller
// ---------------------------------------------------------------------------

const SELLER_TRANSITIONS = {
  PAUSE: { from: 'ACTIVE', to: 'PAUSED', action: 'PAUSED' },
  ACTIVATE: { from: 'PAUSED', to: 'ACTIVE', action: 'ACTIVATED' },
};

/**
 * A seller may pause an active listing and reactivate a paused one. Listings that
 * are under review or removed are in moderation's hands and cannot be moved by the seller.
 */
export async function changeListingStatus({ db, clock }, id, userId, transition) {
  const { from, to, action } = SELLER_TRANSITIONS[transition];
  const listing = await loadOwnListing(db, id, userId);

  const updated = await db.$transaction(async (tx) => {
    // Conditional on the current status, so concurrent changes cannot both apply.
    const { count } = await tx.listing.updateMany({
      where: { id, deletedAt: null, status: from },
      data: { status: to },
    });
    if (count !== 1) {
      throw new AppError(
        409,
        'INVALID_STATUS_CHANGE',
        `A listing that is ${listing.status.toLowerCase().replace('_', ' ')} cannot be ${
          transition === 'PAUSE' ? 'paused' : 'activated'
        }`,
      );
    }
    await recordEvent(tx, clock, {
      listingId: id,
      actorUserId: userId,
      action,
      fromStatus: from,
      toStatus: to,
    });
    return tx.listing.findUniqueOrThrow({ where: { id }, include: listingInclude });
  });

  return toListing(updated, false, true);
}

export async function deleteListing({ db, clock }, id, userId) {
  const listing = await loadOwnListing(db, id, userId);

  await db.$transaction(async (tx) => {
    const { count } = await tx.listing.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: clock.now() },
    });
    if (count !== 1) throw AppError.notFound('Listing not found');
    await recordEvent(tx, clock, {
      listingId: id,
      actorUserId: userId,
      action: 'DELETED',
      fromStatus: listing.status,
    });
  });
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/** Turns listing rows into responses, marking the ones `viewerId` has liked. */
export async function toListings(db, rows, viewerId = null, forOwner = false) {
  const liked = await likedListingIds(
    db,
    viewerId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toListing(row, liked.has(row.id), forOwner));
}

async function listListings(db, where, query, viewerId = null, forOwner = false) {
  const [rows, total] = await Promise.all([
    db.listing.findMany({
      where,
      include: listingInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageWindow(query),
    }),
    db.listing.count({ where }),
  ]);
  return paged(await toListings(db, rows, viewerId, forOwner), total, query);
}

export function listOwnListings({ db }, userId, query) {
  const { status, mode, category } = query;
  return listListings(
    db,
    { sellerId: userId, deletedAt: null, status, mode, category },
    query,
    userId,
    true,
  );
}

export function listSellerListings({ db }, sellerId, query, viewerId = null) {
  const { mode, category } = query;
  return listListings(db, { ...PUBLICLY_VISIBLE, sellerId, mode, category }, query, viewerId);
}

// ---------------------------------------------------------------------------
// Image management
// ---------------------------------------------------------------------------

/** Rewrites a listing's image rows in the given order, as positions 0, 1, 2, ... */
async function writeImageOrder(tx, listingId, images) {
  await tx.listingImage.deleteMany({ where: { listingId } });
  await tx.listingImage.createMany({
    data: images.map(({ id, url, storageId, createdAt }, position) => ({
      id,
      listingId,
      url,
      storageId,
      createdAt,
      position,
    })),
  });
}

export async function addListingImages(deps, id, userId, files) {
  const { db, clock } = deps;
  const listing = await loadOwnListing(db, id, userId);
  assertEditable(listing);

  const images = readImages(files);
  if (images.length === 0) throw new AppError(400, 'IMAGE_REQUIRED', 'Choose a photo to add');
  if (listing.images.length + images.length > LISTING_IMAGES_MAX) {
    throw tooManyImages();
  }

  const stored = await storeImages(deps, images);
  const now = clock.now();

  try {
    await db.$transaction(async (tx) => {
      // Counted again inside the transaction; the unique (listing, position) index
      // and the 0-7 position check make the limit hold even under concurrent uploads.
      const count = await tx.listingImage.count({ where: { listingId: id } });
      if (count + stored.length > LISTING_IMAGES_MAX) throw tooManyImages();
      await tx.listingImage.createMany({
        data: stored.map(({ url, storageId }, index) => ({
          listingId: id,
          url,
          storageId,
          position: count + index,
          createdAt: now,
        })),
      });
    });
  } catch (error) {
    await discardStored(deps, stored);
    if (error?.code === 'P2002') throw tooManyImages();
    throw error;
  }

  return toListing(await loadListing(db, id), false, true);
}

function tooManyImages() {
  return new AppError(
    400,
    'TOO_MANY_IMAGES',
    `A listing can have at most ${LISTING_IMAGES_MAX} photos`,
  );
}

export async function removeListingImage(deps, id, userId, imageId) {
  const { db } = deps;
  const listing = await loadOwnListing(db, id, userId);
  assertEditable(listing);

  const image = listing.images.find((candidate) => candidate.id === imageId);
  if (!image) throw AppError.notFound('Photo not found');
  if (listing.images.length <= LISTING_IMAGES_MIN) {
    throw new AppError(409, 'LAST_IMAGE', 'A listing needs at least one photo');
  }

  await db.$transaction((tx) =>
    writeImageOrder(
      tx,
      id,
      listing.images.filter((candidate) => candidate.id !== imageId),
    ),
  );
  await discardStored(deps, [image]);

  return toListing(await loadListing(db, id), false, true);
}

export async function reorderListingImages({ db }, id, userId, imageIds) {
  const listing = await loadOwnListing(db, id, userId);
  assertEditable(listing);

  const byId = new Map(listing.images.map((image) => [image.id, image]));
  const isSameSet =
    imageIds.length === byId.size &&
    new Set(imageIds).size === imageIds.length &&
    imageIds.every((imageId) => byId.has(imageId));
  if (!isSameSet) {
    throw AppError.badRequest('List every photo of this listing exactly once');
  }

  await db.$transaction((tx) =>
    writeImageOrder(
      tx,
      id,
      imageIds.map((imageId) => byId.get(imageId)),
    ),
  );

  return toListing(await loadListing(db, id), false, true);
}
