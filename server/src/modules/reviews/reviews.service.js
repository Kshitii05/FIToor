import { REVIEW_PHOTOS_MAX, REVIEW_WINDOW_DAYS } from '../../config/policy.js';
import { addDays } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { paged, pageWindow } from '../../lib/pagination.js';
import { discardStored, readImages, storeImages } from '../listings/listings.service.js';

// Reviews (SPEC Module 7; I86 to I88). Only the two sides of a completed order or
// rental can review each other, within 30 days, once each (a unique index on the
// author and the transaction). Reviews publish at once; admins can hide them.

const person = { select: { id: true, status: true, profile: { select: { displayName: true } } } };
const displayName = (user) =>
  user.status === 'DELETED' ? 'Deleted user' : user.profile.displayName;

export function toReview(review, { admin = false } = {}) {
  return {
    id: review.id,
    overall: review.overall,
    communication: review.communication,
    handover: review.handover,
    condition: review.condition,
    text: review.text,
    photos: (review.photos ?? []).map(({ url }) => ({ url })),
    authorRole: review.authorRole,
    // Every review comes from a completed transaction (SPEC Module 7).
    verified: true,
    transaction: review.orderId ? 'PURCHASE' : 'RENTAL',
    author: review.author
      ? { id: review.author.id, displayName: displayName(review.author) }
      : undefined,
    createdAt: review.createdAt.toISOString(),
    ...(admin
      ? { status: review.status, hiddenReason: review.hiddenReason, subjectId: review.subjectId }
      : {}),
  };
}

const notReviewable = (message) => new AppError(409, 'NOT_REVIEWABLE', message);

/** The transaction being reviewed, the author's side, and who they review. */
async function transactionFor(db, me, { orderId, bookingId }) {
  if (orderId) {
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order || (order.buyerId !== me && order.sellerId !== me)) {
      throw AppError.notFound('Order not found');
    }
    const buyer = order.buyerId === me;
    return {
      status: order.status,
      completedAt: order.completedAt,
      authorRole: buyer ? 'BUYER' : 'SELLER',
      subjectId: buyer ? order.sellerId : order.buyerId,
    };
  }
  const booking = await db.rentalBooking.findUnique({ where: { id: bookingId } });
  if (!booking || (booking.renterId !== me && booking.ownerId !== me)) {
    throw AppError.notFound('Booking not found');
  }
  const renter = booking.renterId === me;
  return {
    status: booking.status,
    completedAt: booking.completedAt,
    authorRole: renter ? 'RENTER' : 'OWNER',
    subjectId: renter ? booking.ownerId : booking.renterId,
  };
}

export async function createReview(deps, me, input, files) {
  const { db, clock } = deps;
  const now = clock.now();
  const deal = await transactionFor(db, me, input);
  if (deal.status !== 'COMPLETED' || !deal.completedAt) {
    throw notReviewable('You can review once the order or rental is complete');
  }
  if (addDays(deal.completedAt, REVIEW_WINDOW_DAYS) <= now) {
    throw notReviewable(`Reviews can be written up to ${REVIEW_WINDOW_DAYS} days after completion`);
  }
  // A seller reviewing a buyer is not asked about the item's condition (I87).
  const asksCondition = deal.authorRole !== 'SELLER';
  if (asksCondition && input.condition === undefined) {
    throw AppError.badRequest('Rate the condition of the item', { field: 'condition' });
  }
  if (!asksCondition && input.condition !== undefined) {
    throw AppError.badRequest('Condition is not rated when reviewing a buyer', {
      field: 'condition',
    });
  }
  const images = readImages(files);
  if (images.length > REVIEW_PHOTOS_MAX) {
    throw new AppError(400, 'TOO_MANY_IMAGES', `Add at most ${REVIEW_PHOTOS_MAX} photos`);
  }

  const stored = await storeImages(deps, images, 'reviews');
  try {
    const review = await db.review.create({
      data: {
        authorId: me,
        subjectId: deal.subjectId,
        orderId: input.orderId ?? null,
        bookingId: input.bookingId ?? null,
        authorRole: deal.authorRole,
        overall: input.overall,
        communication: input.communication,
        handover: input.handover,
        condition: input.condition ?? null,
        text: input.text?.trim() || null,
        photos: stored.map(({ url, storageId }) => ({ url, storageId })),
        createdAt: now,
      },
      include: { author: person },
    });
    return toReview(review);
  } catch (error) {
    await discardStored(deps, stored);
    // One review per person per transaction: the unique index decided (I86).
    if (error?.code === 'P2002') {
      throw new AppError(409, 'ALREADY_REVIEWED', 'You have already reviewed this');
    }
    throw error;
  }
}

const round1 = (value) => (value === null ? null : Math.round(value * 10) / 10);

/** Average ratings of someone's published reviews. */
export async function ratingSummary(db, userId) {
  const result = await db.review.aggregate({
    where: { subjectId: userId, status: 'PUBLISHED' },
    _count: { _all: true },
    _avg: { overall: true, communication: true, handover: true, condition: true },
  });
  return {
    count: result._count._all,
    overall: round1(result._avg.overall),
    communication: round1(result._avg.communication),
    handover: round1(result._avg.handover),
    condition: round1(result._avg.condition),
  };
}

export async function reviewsOf({ db }, userId, query) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw AppError.notFound('User not found');
  const where = { subjectId: userId, status: 'PUBLISHED' };
  const [rows, total, summary] = await Promise.all([
    db.review.findMany({
      where,
      include: { author: person },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageWindow(query),
    }),
    db.review.count({ where }),
    ratingSummary(db, userId),
  ]);
  return {
    ...paged(
      rows.map((row) => toReview(row)),
      total,
      query,
    ),
    summary,
  };
}

/** Completed orders and rentals of the last 30 days the person has not reviewed yet. */
export async function pendingReviews({ db, clock }, me) {
  const since = addDays(clock.now(), -REVIEW_WINDOW_DAYS);
  const [orders, bookings, mine] = await Promise.all([
    db.order.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { gt: since },
        OR: [{ buyerId: me }, { sellerId: me }],
      },
      include: { items: { take: 1 }, buyer: person, seller: person },
      orderBy: { completedAt: 'desc' },
    }),
    db.rentalBooking.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { gt: since },
        OR: [{ renterId: me }, { ownerId: me }],
      },
      include: { renter: person, owner: person },
      orderBy: { completedAt: 'desc' },
    }),
    db.review.findMany({ where: { authorId: me }, select: { orderId: true, bookingId: true } }),
  ]);
  const done = new Set(mine.flatMap((r) => [r.orderId, r.bookingId]).filter(Boolean));
  const until = (date) => addDays(date, REVIEW_WINDOW_DAYS).toISOString();
  return [
    ...orders
      .filter((o) => !done.has(o.id))
      .map((o) => {
        const other = o.buyerId === me ? o.seller : o.buyer;
        return {
          orderId: o.id,
          ref: o.ref,
          title: o.items[0]?.title ?? o.ref,
          role: o.buyerId === me ? 'BUYER' : 'SELLER',
          subject: { id: other.id, displayName: displayName(other) },
          reviewBy: until(o.completedAt),
        };
      }),
    ...bookings
      .filter((b) => !done.has(b.id))
      .map((b) => {
        const other = b.renterId === me ? b.owner : b.renter;
        return {
          bookingId: b.id,
          ref: b.ref,
          title: b.title,
          role: b.renterId === me ? 'RENTER' : 'OWNER',
          subject: { id: other.id, displayName: displayName(other) },
          reviewBy: until(b.completedAt),
        };
      }),
  ];
}

/** Admin: hide or show a review, with a reason, audited (I88). In a transaction. */
export async function setReviewVisibility(tx, now, { reviewId, adminId, hidden, reason }) {
  const review = await tx.review.findUnique({ where: { id: reviewId } });
  if (!review) throw AppError.notFound('Review not found');
  await tx.review.update({
    where: { id: reviewId },
    data: hidden
      ? { status: 'HIDDEN', hiddenReason: reason, hiddenById: adminId, hiddenAt: now }
      : { status: 'PUBLISHED', hiddenReason: null, hiddenById: null, hiddenAt: null },
  });
  return review;
}

export async function adminSetReview(deps, adminId, reviewId, { hidden, reason }) {
  const now = deps.clock.now();
  await deps.db.$transaction(async (tx) => {
    await setReviewVisibility(tx, now, { reviewId, adminId, hidden, reason });
    await tx.adminAuditLog.create({
      data: {
        adminId,
        action: hidden ? 'HIDE_REVIEW' : 'SHOW_REVIEW',
        targetType: 'review',
        targetId: reviewId,
        reason,
        createdAt: now,
      },
    });
  });
  const review = await deps.db.review.findUniqueOrThrow({
    where: { id: reviewId },
    include: { author: person },
  });
  return toReview(review, { admin: true });
}
