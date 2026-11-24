import { OFFER_OPEN_HOURS, OFFER_USE_HOURS } from '../../config/policy.js';
import { addHours } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { deliver } from '../notifications/notifications.service.js';
import { formatPaise } from '../orders/order.format.js';
import {
  announceMessage,
  assertNotBlocked,
  conversationFor,
  offerInclude,
  offerView,
  postMessage,
} from './messaging.service.js';

// Price offers on sale listings (SPEC Module 8; I71 to I74). The buyer offers; the
// side an offer waits on accepts, rejects or counters; the maker may withdraw it.
// A counter is a new offer pointing at the one it replaces, so history is kept.
// An accepted offer gives that buyer that price at checkout until it is used or
// runs out. It never reserves stock.

const LIVE = ['OPEN', 'ACCEPTED'];

/** Offers past their time become EXPIRED. `where` narrows it (one buyer and listing). */
async function expireStale(tx, now, where = {}) {
  const stale = await tx.priceOffer.findMany({
    where: {
      ...where,
      OR: [
        { status: 'OPEN', expiresAt: { lte: now } },
        { status: 'ACCEPTED', useBy: { lte: now } },
      ],
    },
    select: { id: true },
  });
  if (stale.length === 0) return [];
  await tx.priceOffer.updateMany({
    where: {
      id: { in: stale.map((o) => o.id) },
      OR: [
        { status: 'OPEN', expiresAt: { lte: now } },
        { status: 'ACCEPTED', useBy: { lte: now } },
      ],
    },
    data: { status: 'EXPIRED' },
  });
  return stale.map((o) => o.id);
}

async function loadOffer(db, id, me) {
  const offer = await db.priceOffer.findUnique({ where: { id }, include: offerInclude });
  if (!offer || (offer.buyerId !== me && offer.sellerId !== me)) {
    throw AppError.notFound('Offer not found');
  }
  return offer;
}

const OFFER_NOTES = {
  offerReceived: (o) => ['New offer', `${offerLine('Offered', o)} for ${o.listing.title}.`],
  offerCountered: (o) => [
    'Counter-offer',
    `${offerLine('Countered with', o)} for ${o.listing.title}.`,
  ],
  offerAccepted: (o) => [
    'Offer accepted',
    `${offerLine('Accepted', o)} for ${o.listing.title}. Check out within 48 hours.`,
  ],
  offerDeclined: (o) => ['Offer declined', `${offerLine('Declined', o)} for ${o.listing.title}.`],
};

/** Tells one person about an offer event (optional category; I95). Keyed per offer and event. */
async function notifyOffer(deps, offerId, type, userId) {
  const offer = await deps.db.priceOffer.findUniqueOrThrow({
    where: { id: offerId },
    include: offerInclude,
  });
  const [title, body] = OFFER_NOTES[type](offer);
  await deliver(deps, {
    userId,
    key: `offer:${offerId}:${type}`,
    category: 'OFFERS',
    type,
    title,
    body,
    link: `/messages/${offer.conversationId}`,
  });
}

async function announceOffer(deps, offerId) {
  const offer = await deps.db.priceOffer.findUniqueOrThrow({
    where: { id: offerId },
    include: offerInclude,
  });
  const view = offerView(offer);
  deps.realtime.toUsers([offer.buyerId, offer.sellerId], 'offer:updated', {
    conversationId: offer.conversationId,
    offer: view,
  });
  return view;
}

/** Checks a proposed price and quantity against the listing as it is now. */
function checkTerms(listing, { unitPricePaise, quantity }) {
  if (unitPricePaise >= listing.pricePaise) {
    throw AppError.badRequest(
      `Offer less than the listed price of ${formatPaise(listing.pricePaise)}`,
    );
  }
  if (quantity > listing.quantity) {
    throw new AppError(
      409,
      'OUT_OF_STOCK',
      listing.quantity ? `Only ${listing.quantity} left` : 'Sold out',
    );
  }
}

async function saleListing(db, listingId) {
  const listing = await db.listing.findFirst({
    where: { id: listingId, deletedAt: null },
    include: { seller: { select: { status: true } } },
  });
  if (!listing) throw AppError.notFound('Listing not found');
  if (listing.mode !== 'SALE') {
    throw new AppError(400, 'OFFERS_SALE_ONLY', 'Offers can be made on items for sale only');
  }
  if (listing.status !== 'ACTIVE' || listing.seller.status !== 'ACTIVE') {
    throw new AppError(409, 'NOT_AVAILABLE', 'This listing is not available right now');
  }
  return listing;
}

const offerLine = (verb, offer) =>
  `${verb} ${formatPaise(offer.unitPricePaise)}${offer.quantity > 1 ? ` each for ${offer.quantity}` : ''}`;

/** The buyer offers a price on a sale listing. */
export async function makeOffer(deps, me, { listingId, quantity, unitPricePaise }) {
  const { db, clock } = deps;
  const listing = await saleListing(db, listingId);
  if (listing.sellerId === me) {
    throw new AppError(400, 'CANNOT_MESSAGE_SELF', 'You cannot make an offer on your own listing');
  }
  await assertNotBlocked(db, me, listing.sellerId);
  checkTerms(listing, { unitPricePaise, quantity });

  const now = clock.now();
  const conversation = await conversationFor(db, now, me, listing.sellerId);
  let created;
  try {
    created = await db.$transaction(async (tx) => {
      await expireStale(tx, now, { listingId, buyerId: me });
      const live = await tx.priceOffer.findFirst({
        where: { listingId, buyerId: me, status: { in: LIVE } },
      });
      if (live) throw offerExists(live);
      const offer = await tx.priceOffer.create({
        data: {
          listingId,
          buyerId: me,
          sellerId: listing.sellerId,
          conversationId: conversation.id,
          madeById: me,
          quantity,
          unitPricePaise,
          listPricePaise: listing.pricePaise,
          expiresAt: addHours(now, OFFER_OPEN_HOURS),
          createdAt: now,
        },
      });
      const message = await postMessage(tx, now, conversation, {
        senderId: me,
        kind: 'OFFER',
        body: offerLine('Offered', offer),
        listingId,
        offerId: offer.id,
      });
      return { offer, message };
    });
  } catch (error) {
    // Two offers at the same moment: the one-live-offer index decided.
    if (error?.code === 'P2002') throw offerExists(null);
    throw error;
  }
  await announceMessage(deps, conversation, created.message.id);
  await notifyOffer(deps, created.offer.id, 'offerReceived', listing.sellerId);
  return { offer: await announceOffer(deps, created.offer.id), conversationId: conversation.id };
}

function offerExists(live) {
  return new AppError(
    409,
    'OFFER_EXISTS',
    'You already have an offer on this item. Wait for an answer or withdraw it first.',
    live ? { offerId: live.id } : undefined,
  );
}

/** Only the side the offer waits on may answer, while it is open and in time. */
function assertCanAnswer(offer, me, now) {
  if (offer.madeById === me) {
    throw AppError.forbidden('The other person answers this offer');
  }
  if (offer.status !== 'OPEN' || offer.expiresAt <= now) {
    throw new AppError(409, 'OFFER_CLOSED', 'This offer is no longer open');
  }
}

/** Changes an open offer and posts a line about it in the chat, in one transaction. */
async function closeOffer(deps, offer, me, { status, data = {}, line, extra }) {
  const { db, clock } = deps;
  const now = clock.now();
  const conversation = await db.conversation.findUniqueOrThrow({
    where: { id: offer.conversationId },
  });
  const result = await db.$transaction(async (tx) => {
    const { count } = await tx.priceOffer.updateMany({
      where: { id: offer.id, status: 'OPEN', expiresAt: { gt: now } },
      data: { status, respondedAt: now, ...data },
    });
    if (count !== 1) throw new AppError(409, 'OFFER_CLOSED', 'This offer is no longer open');
    const follow = extra ? await extra(tx, now, conversation) : null;
    // A counter-offer is the counterer's own offer card; other answers are system lines.
    const message = await postMessage(tx, now, conversation, {
      senderId: follow ? me : null,
      kind: follow ? 'OFFER' : 'SYSTEM',
      body: line,
      listingId: offer.listingId,
      offerId: follow?.id ?? offer.id,
    });
    return { follow, message };
  });
  await announceMessage(deps, conversation, result.message.id);
  // The person who made the offer hears the answer.
  const note = { ACCEPTED: 'offerAccepted', REJECTED: 'offerDeclined' }[status];
  if (note) await notifyOffer(deps, offer.id, note, offer.madeById);
  if (result.follow) {
    const other = offer.madeById === offer.buyerId ? offer.buyerId : offer.sellerId;
    await notifyOffer(deps, result.follow.id, 'offerCountered', other);
  }
  const view = await announceOffer(deps, offer.id);
  return result.follow ? announceOffer(deps, result.follow.id) : view;
}

export async function acceptOffer(deps, me, offerId) {
  const offer = await loadOffer(deps.db, offerId, me);
  const now = deps.clock.now();
  assertCanAnswer(offer, me, now);
  await assertNotBlocked(deps.db, offer.buyerId, offer.sellerId);
  return closeOffer(deps, offer, me, {
    status: 'ACCEPTED',
    data: { acceptedAt: now, useBy: addHours(now, OFFER_USE_HOURS) },
    line: `${offerLine('Accepted', offer)}. The buyer can check out at this price for ${OFFER_USE_HOURS} hours.`,
  });
}

export async function rejectOffer(deps, me, offerId) {
  const offer = await loadOffer(deps.db, offerId, me);
  assertCanAnswer(offer, me, deps.clock.now());
  return closeOffer(deps, offer, me, {
    status: 'REJECTED',
    line: offerLine('Declined the offer of', offer),
  });
}

/** Answers an offer with a new price; the new offer waits on the other side. */
export async function counterOffer(deps, me, offerId, { unitPricePaise, quantity }) {
  const { db } = deps;
  const offer = await loadOffer(db, offerId, me);
  assertCanAnswer(offer, me, deps.clock.now());
  await assertNotBlocked(db, offer.buyerId, offer.sellerId);
  const listing = await saleListing(db, offer.listingId);
  const terms = { unitPricePaise, quantity: quantity ?? offer.quantity };
  checkTerms(listing, terms);
  return closeOffer(deps, offer, me, {
    status: 'COUNTERED',
    line: `Counter-offer: ${formatPaise(unitPricePaise)}${terms.quantity > 1 ? ` each for ${terms.quantity}` : ''}`,
    extra: (tx, now) =>
      tx.priceOffer.create({
        data: {
          listingId: offer.listingId,
          buyerId: offer.buyerId,
          sellerId: offer.sellerId,
          conversationId: offer.conversationId,
          madeById: me,
          previousOfferId: offer.id,
          quantity: terms.quantity,
          unitPricePaise,
          listPricePaise: listing.pricePaise,
          expiresAt: addHours(now, OFFER_OPEN_HOURS),
          createdAt: now,
        },
      }),
  });
}

export async function withdrawOffer(deps, me, offerId) {
  const offer = await loadOffer(deps.db, offerId, me);
  if (offer.madeById !== me)
    throw AppError.forbidden('Only the person who made it can withdraw it');
  return closeOffer(deps, offer, me, {
    status: 'WITHDRAWN',
    line: offerLine('Withdrew the offer of', offer),
  });
}

/** My offers on one listing (as buyer or seller), newest first, and the live one. */
export async function offersOnListing({ db, clock }, me, listingId) {
  const rows = await db.priceOffer.findMany({
    where: { listingId, OR: [{ buyerId: me }, { sellerId: me }] },
    include: offerInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const now = clock.now();
  const live = rows.find(
    (o) =>
      o.buyerId === me &&
      ((o.status === 'OPEN' && o.expiresAt > now) || (o.status === 'ACCEPTED' && o.useBy > now)),
  );
  return { items: rows.map(offerView), live: live ? offerView(live) : null };
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/** The buyer's usable accepted offers for these listings, by listing id. */
export async function acceptedOffers(db, buyerId, listingIds, now) {
  if (listingIds.length === 0) return new Map();
  const rows = await db.priceOffer.findMany({
    where: { buyerId, listingId: { in: listingIds }, status: 'ACCEPTED', useBy: { gt: now } },
  });
  return new Map(rows.map((row) => [row.listingId, row]));
}

/** The price per item for a cart line: the offer's when its quantity covers it (I74). */
export function priceFor(listing, quantity, offer) {
  return offer && quantity <= offer.quantity
    ? { unitPricePaise: offer.unitPricePaise, offerId: offer.id }
    : { unitPricePaise: listing.pricePaise, offerId: null };
}

/** A paid checkout uses up the offers its items were priced with. In `tx`. */
export async function useOffers(tx, now, checkoutId) {
  const items = await tx.checkoutItem.findMany({
    where: { checkoutId, offerId: { not: null } },
    select: { offerId: true },
  });
  if (items.length === 0) return;
  await tx.priceOffer.updateMany({
    where: { id: { in: items.map((i) => i.offerId) }, status: { in: ['ACCEPTED', 'EXPIRED'] } },
    data: { status: 'USED', usedAt: now },
  });
}

/** Expires offers past their time. Run on a schedule. */
export async function runOfferJobs(deps) {
  const now = deps.clock.now();
  const expired = await deps.db.$transaction((tx) => expireStale(tx, now));
  for (const id of expired) await announceOffer(deps, id);
  return { expiredOffers: expired.length };
}
