import { BLOCKS_MAX, MESSAGE_PHOTOS_MAX, MESSAGES_PAGE_SIZE_DEFAULT } from '../../config/policy.js';
import { AppError } from '../../lib/errors.js';
import { paged, pageWindow } from '../../lib/pagination.js';
import { discardStored, readImages, storeImages } from '../listings/listings.service.js';

// Messaging (SPEC Module 8). One conversation per pair of people; messages are never
// edited. Live delivery goes through `deps.realtime` (realtime.js), which does
// nothing until a server is attached, so these functions work the same in tests.

// ---------------------------------------------------------------------------
// People, blocks and the pair
// ---------------------------------------------------------------------------

/** The pair in the order the database keeps it (user_a_id < user_b_id). */
const pairOf = (a, b) => (a < b ? [a, b] : [b, a]);

const personSelect = {
  id: true,
  status: true,
  profile: { select: { displayName: true, photoUrl: true } },
};

/** Never the phone or email (SPEC Module 8). */
export function personView(user) {
  const deleted = user.status === 'DELETED';
  return {
    id: user.id,
    displayName: deleted ? 'Deleted user' : user.profile.displayName,
    photoUrl: deleted ? null : (user.profile.photoUrl ?? null),
    deleted,
  };
}

export async function blocksBetween(db, me, other) {
  const rows = await db.blockedUser.findMany({
    where: {
      OR: [
        { blockerId: me, blockedId: other },
        { blockerId: other, blockedId: me },
      ],
    },
  });
  return {
    byMe: rows.some((row) => row.blockerId === me),
    byThem: rows.some((row) => row.blockerId === other),
  };
}

export async function assertNotBlocked(db, me, other) {
  const blocks = await blocksBetween(db, me, other);
  if (blocks.byMe || blocks.byThem) {
    throw new AppError(
      403,
      'BLOCKED',
      blocks.byMe
        ? 'You have blocked this person. Unblock them to send messages.'
        : 'You cannot message this person.',
    );
  }
}

/** Finds or creates the pair's conversation, safely when two requests race. */
export async function conversationFor(db, now, me, other) {
  const [a, b] = pairOf(me, other);
  await db.$executeRaw`
    INSERT INTO conversations (id, user_a_id, user_b_id, last_message_at, created_at)
    VALUES (gen_random_uuid(), ${a}::uuid, ${b}::uuid, ${now}, ${now})
    ON CONFLICT (user_a_id, user_b_id) DO NOTHING`;
  const conversation = await db.conversation.findUniqueOrThrow({
    where: { userAId_userBId: { userAId: a, userBId: b } },
  });
  await db.conversationParticipant.createMany({
    data: [
      { conversationId: conversation.id, userId: a },
      { conversationId: conversation.id, userId: b },
    ],
    skipDuplicates: true,
  });
  return conversation;
}

const otherOf = (conversation, me) =>
  conversation.userAId === me ? conversation.userBId : conversation.userAId;

/** The conversation, only for one of its two people. */
export async function loadOwnConversation(db, id, me) {
  const conversation = await db.conversation.findUnique({ where: { id } });
  if (!conversation || (conversation.userAId !== me && conversation.userBId !== me)) {
    throw AppError.notFound('Conversation not found');
  }
  return conversation;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const listingCardInclude = {
  images: { orderBy: { position: 'asc' }, take: 1 },
};

function listingCard(listing) {
  if (!listing) return null;
  return {
    id: listing.id,
    title: listing.title,
    mode: listing.mode,
    status: listing.deletedAt ? 'DELETED' : listing.status,
    pricePaise: listing.mode === 'SALE' ? listing.pricePaise : listing.headlinePricePaise,
    imageUrl: listing.images?.[0]?.url ?? null,
  };
}

export function offerView(offer) {
  return {
    id: offer.id,
    listingId: offer.listingId,
    listing: offer.listing ? listingCard(offer.listing) : undefined,
    conversationId: offer.conversationId,
    buyerId: offer.buyerId,
    sellerId: offer.sellerId,
    madeById: offer.madeById,
    previousOfferId: offer.previousOfferId,
    quantity: offer.quantity,
    unitPricePaise: offer.unitPricePaise,
    listPricePaise: offer.listPricePaise,
    status: offer.status,
    expiresAt: offer.expiresAt.toISOString(),
    acceptedAt: offer.acceptedAt?.toISOString() ?? null,
    useBy: offer.useBy?.toISOString() ?? null,
    createdAt: offer.createdAt.toISOString(),
  };
}

export const offerInclude = { listing: { include: listingCardInclude } };

const messageInclude = {
  attachments: { orderBy: { position: 'asc' } },
  offer: { include: offerInclude },
};

async function listingCards(db, messages) {
  const ids = [...new Set(messages.map((m) => m.listingId).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await db.listing.findMany({
    where: { id: { in: ids } },
    include: listingCardInclude,
  });
  return new Map(rows.map((row) => [row.id, listingCard(row)]));
}

function messageView(message, cards) {
  return {
    id: message.id,
    seq: message.seq,
    conversationId: message.conversationId,
    senderId: message.senderId,
    kind: message.kind,
    body: message.body,
    listing: message.listingId ? (cards.get(message.listingId) ?? null) : null,
    orderId: message.orderId,
    bookingId: message.bookingId,
    offer: message.offer ? offerView(message.offer) : null,
    attachments: message.attachments.map((a) => ({ url: a.url })),
    createdAt: message.createdAt.toISOString(),
  };
}

export async function messageViews(db, messages) {
  const cards = await listingCards(db, messages);
  return messages.map((message) => messageView(message, cards));
}

export async function conversationView(db, conversation, me) {
  const otherId = otherOf(conversation, me);
  const [other, seats, last, blocks] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: otherId }, select: personSelect }),
    db.conversationParticipant.findMany({ where: { conversationId: conversation.id } }),
    db.message.findFirst({
      where: { conversationId: conversation.id },
      orderBy: { seq: 'desc' },
      include: messageInclude,
    }),
    blocksBetween(db, me, otherId),
  ]);
  const mine = seats.find((seat) => seat.userId === me);
  const theirs = seats.find((seat) => seat.userId === otherId);
  const unreadCount = await db.message.count({
    where: {
      conversationId: conversation.id,
      seq: { gt: mine?.readUpTo ?? 0 },
      OR: [{ senderId: null }, { senderId: { not: me } }],
    },
  });
  return {
    id: conversation.id,
    other: personView(other),
    lastMessage: last ? (await messageViews(db, [last]))[0] : null,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    unreadCount,
    myReadUpTo: mine?.readUpTo ?? 0,
    otherDeliveredUpTo: theirs?.deliveredUpTo ?? 0,
    otherReadUpTo: theirs?.readUpTo ?? 0,
    blocked: blocks,
  };
}

// ---------------------------------------------------------------------------
// Starting and listing conversations
// ---------------------------------------------------------------------------

/** The other person for a chat about a listing, order or rental booking (I68). */
async function otherPersonFor(db, me, { listingId, orderId, bookingId }) {
  if (listingId) {
    const listing = await db.listing.findFirst({ where: { id: listingId, deletedAt: null } });
    if (!listing) throw AppError.notFound('Listing not found');
    return { other: listing.sellerId, about: { listingId } };
  }
  if (orderId) {
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order || (order.buyerId !== me && order.sellerId !== me)) {
      throw AppError.notFound('Order not found');
    }
    return { other: order.buyerId === me ? order.sellerId : order.buyerId, about: { orderId } };
  }
  const booking = await db.rentalBooking.findUnique({ where: { id: bookingId } });
  if (!booking || (booking.renterId !== me && booking.ownerId !== me)) {
    throw AppError.notFound('Booking not found');
  }
  return {
    other: booking.renterId === me ? booking.ownerId : booking.renterId,
    about: { bookingId },
  };
}

export async function startConversation(deps, me, about) {
  const { db, clock } = deps;
  const { other } = await otherPersonFor(db, me, about);
  if (other === me) {
    throw new AppError(400, 'CANNOT_MESSAGE_SELF', 'You cannot message yourself');
  }
  const conversation = await conversationFor(db, clock.now(), me, other);
  return conversationView(db, conversation, me);
}

export async function listConversations({ db }, me, query) {
  const where = { OR: [{ userAId: me }, { userBId: me }] };
  const [rows, total] = await Promise.all([
    db.conversation.findMany({
      where,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      ...pageWindow(query),
    }),
    db.conversation.count({ where }),
  ]);
  const items = [];
  for (const row of rows) items.push(await conversationView(db, row, me));
  return paged(items, total, query);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const HIDDEN = '[hidden]';
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Ten or more digits, allowing spaces, dots, dashes and brackets between them.
const PHONE = /\+?\d(?:[\s().-]*\d){9,}/g;

/** Phone numbers and email addresses typed into a message become "[hidden]" (I76). */
export const hideContacts = (text) => text.replace(EMAIL, HIDDEN).replace(PHONE, HIDDEN);

/** Whether the two have a paid order or rental between them. */
async function haveDealt(db, a, b) {
  const [orders, bookings] = await Promise.all([
    db.order.count({
      where: {
        OR: [
          { buyerId: a, sellerId: b },
          { buyerId: b, sellerId: a },
        ],
      },
    }),
    db.rentalBooking.count({
      where: {
        paidAt: { not: null },
        OR: [
          { renterId: a, ownerId: b },
          { renterId: b, ownerId: a },
        ],
      },
    }),
  ]);
  return orders + bookings > 0;
}

/**
 * Adds a message inside `tx` and moves the conversation's last-message time. The
 * sender has, of course, received and read their own message.
 */
export async function postMessage(tx, now, conversation, data) {
  const message = await tx.message.create({
    data: { conversationId: conversation.id, createdAt: now, ...data },
  });
  await tx.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: now },
  });
  if (data.senderId) {
    await tx.$executeRaw`
      UPDATE conversation_participants
         SET read_up_to = GREATEST(read_up_to, ${message.seq}),
             delivered_up_to = GREATEST(delivered_up_to, ${message.seq})
       WHERE conversation_id = ${conversation.id}::uuid AND user_id = ${data.senderId}::uuid`;
  }
  return message;
}

/** Sends a stored message to both people's live connections. */
export async function announceMessage(deps, conversation, messageId) {
  const message = await deps.db.message.findUniqueOrThrow({
    where: { id: messageId },
    include: messageInclude,
  });
  const [view] = await messageViews(deps.db, [message]);
  deps.realtime.toUsers([conversation.userAId, conversation.userBId], 'message:new', {
    conversationId: conversation.id,
    message: view,
  });
  return view;
}

export async function sendMessage(deps, me, conversation, { body, listingId }, files) {
  const { db, clock } = deps;
  const other = otherOf(conversation, me);
  await assertNotBlocked(db, me, other);

  const images = readImages(files);
  if (images.length > MESSAGE_PHOTOS_MAX) {
    throw new AppError(400, 'TOO_MANY_IMAGES', `You can send at most ${MESSAGE_PHOTOS_MAX} photos`);
  }
  const text = body?.trim() ? body.trim() : null;
  if (!text && images.length === 0 && !listingId) {
    throw AppError.badRequest('Write a message or add a photo');
  }
  if (listingId && !(await db.listing.findFirst({ where: { id: listingId, deletedAt: null } }))) {
    throw AppError.notFound('Listing not found');
  }
  const shown = text && !(await haveDealt(db, me, other)) ? hideContacts(text) : text;

  const now = clock.now();
  const stored = await storeImages(deps, images, 'messages');
  let message;
  try {
    message = await db.$transaction(async (tx) => {
      const created = await postMessage(tx, now, conversation, {
        senderId: me,
        kind: images.length ? 'PHOTO' : 'TEXT',
        body: shown,
        listingId: listingId ?? null,
      });
      if (stored.length) {
        await tx.messageAttachment.createMany({
          data: stored.map((photo, position) => ({
            messageId: created.id,
            url: photo.url,
            storageId: photo.storageId,
            position,
            createdAt: now,
          })),
        });
      }
      return created;
    });
  } catch (error) {
    await discardStored(deps, stored);
    throw error;
  }
  return announceMessage(deps, conversation, message.id);
}

/** A page of messages, oldest first, before `before` (a sequence number). */
export async function listMessages(deps, me, conversation, { before, limit }) {
  const { db } = deps;
  const take = limit ?? MESSAGES_PAGE_SIZE_DEFAULT;
  const rows = await db.message.findMany({
    where: { conversationId: conversation.id, ...(before ? { seq: { lt: before } } : {}) },
    orderBy: { seq: 'desc' },
    take: take + 1,
    include: messageInclude,
  });
  const hasMore = rows.length > take;
  const page = rows.slice(0, take).reverse();
  // Opening the messages means they reached this person.
  if (page.length && !before)
    await markReceipt(deps, me, conversation, 'delivered', page.at(-1).seq);
  return { items: await messageViews(db, page), hasMore };
}

/**
 * Moves this person's delivered (or read, which implies delivered) mark forward,
 * never back and never past the last message. Tells both people when it moved.
 */
export async function markReceipt(deps, me, conversation, kind, upTo) {
  const { db } = deps;
  const last = await db.message.findFirst({
    where: { conversationId: conversation.id },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  });
  const mark = Math.min(upTo, last?.seq ?? 0);
  const before = await db.conversationParticipant.findUniqueOrThrow({
    where: { conversationId_userId: { conversationId: conversation.id, userId: me } },
  });
  if (kind === 'read') {
    await db.$executeRaw`
      UPDATE conversation_participants
         SET read_up_to = GREATEST(read_up_to, ${mark}),
             delivered_up_to = GREATEST(delivered_up_to, ${mark})
       WHERE conversation_id = ${conversation.id}::uuid AND user_id = ${me}::uuid`;
  } else {
    await db.$executeRaw`
      UPDATE conversation_participants SET delivered_up_to = GREATEST(delivered_up_to, ${mark})
       WHERE conversation_id = ${conversation.id}::uuid AND user_id = ${me}::uuid`;
  }
  const after = await db.conversationParticipant.findUniqueOrThrow({
    where: { conversationId_userId: { conversationId: conversation.id, userId: me } },
  });
  if (after.deliveredUpTo !== before.deliveredUpTo || after.readUpTo !== before.readUpTo) {
    deps.realtime.toUsers([conversation.userAId, conversation.userBId], 'receipt', {
      conversationId: conversation.id,
      userId: me,
      deliveredUpTo: after.deliveredUpTo,
      readUpTo: after.readUpTo,
    });
  }
  return after;
}

// ---------------------------------------------------------------------------
// Blocking (I75)
// ---------------------------------------------------------------------------

export async function blockUser(deps, me, userId) {
  const { db, clock } = deps;
  if (userId === me) throw AppError.badRequest('You cannot block yourself');
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw AppError.notFound('User not found');
  if ((await db.blockedUser.count({ where: { blockerId: me } })) >= BLOCKS_MAX) {
    throw new AppError(409, 'TOO_MANY_BLOCKS', `You can block at most ${BLOCKS_MAX} people`);
  }
  const now = clock.now();
  const withdrawn = await db.$transaction(async (tx) => {
    await tx.blockedUser.createMany({
      data: [{ blockerId: me, blockedId: userId, createdAt: now }],
      skipDuplicates: true,
    });
    // Open offers between the two are withdrawn; nothing more can be agreed.
    const open = await tx.priceOffer.findMany({
      where: {
        status: 'OPEN',
        OR: [
          { buyerId: me, sellerId: userId },
          { buyerId: userId, sellerId: me },
        ],
      },
    });
    await tx.priceOffer.updateMany({
      where: { id: { in: open.map((o) => o.id) }, status: 'OPEN' },
      data: { status: 'WITHDRAWN', respondedAt: now },
    });
    return open;
  });
  for (const offer of withdrawn) {
    const fresh = await db.priceOffer.findUniqueOrThrow({
      where: { id: offer.id },
      include: offerInclude,
    });
    deps.realtime.toUsers([offer.buyerId, offer.sellerId], 'offer:updated', {
      conversationId: offer.conversationId,
      offer: offerView(fresh),
    });
  }
}

export async function unblockUser({ db }, me, userId) {
  await db.blockedUser.deleteMany({ where: { blockerId: me, blockedId: userId } });
}

export async function listBlocks({ db }, me) {
  const rows = await db.blockedUser.findMany({
    where: { blockerId: me },
    include: { blocked: { select: personSelect } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => ({
    user: personView(row.blocked),
    blockedAt: row.createdAt.toISOString(),
  }));
}
