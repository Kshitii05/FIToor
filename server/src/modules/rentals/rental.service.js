import {
  BLOCKED_RANGES_MAX,
  CLAIM_PHOTOS_MIN,
  DEPOSIT_AUTO_REFUND_AFTER_RETURN_HOURS,
  HANDOVER_MAX_ATTEMPTS,
  LATE_FEE_GRACE_HOURS,
  RENTAL_BOOKING_WINDOW_DAYS,
  RENTAL_CONDITION_PHOTOS_MAX,
  RENTAL_CONDITION_PHOTOS_MIN,
  RENTAL_NON_RETURN_REPORT_DAYS,
  RENTAL_OPEN_REQUESTS_MAX,
  RENTAL_PAYMENT_WINDOW_HOURS,
  RENTAL_PENDING_HOLD_HOURS,
} from '../../config/policy.js';
import { addCalendarDays, addDays, addHours, businessDate } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { pointSql } from '../../lib/geo.js';
import { recordLedger } from '../../lib/ledger.js';
import { commissionOn } from '../../lib/money.js';
import { paged, pageWindow } from '../../lib/pagination.js';
import { loadOwnAddress, toAddress } from '../addresses/addresses.js';
import {
  discardStored,
  PUBLICLY_VISIBLE,
  readImages,
  storeImages,
} from '../listings/listings.service.js';
import { createRefund, processRefund } from '../payments/refunds.service.js';
import { registerDeletionBlocker } from '../users/deletion.service.js';
import {
  announceOpened,
  evidencePhotos,
  openDispute,
  recordEvidence,
  UNFINISHED,
} from '../disputes/dispute.records.js';
import { notifyBooking } from './rental.emails.js';
import {
  bookingRef,
  codeMatches,
  depositSettlement,
  endDateFor,
  fromDateColumn,
  lateFeeFor,
  renterCancelRefund,
  returnDueAtFor,
  toDateColumn,
} from './rental.rules.js';

// Rental bookings as an explicit state machine (DECISIONS I59 onwards):
//
//   REQUESTED -> APPROVED -> CONFIRMED -> ACTIVE -> RETURNED -> SETTLING -> COMPLETED
//                                                       \-> CLAIM_OPEN -/
//                                     ADMIN_REVIEW (contested, unanswered, not returned)
//   side exits: DECLINED, EXPIRED, CANCELLED
//
// Every change goes through `transition`, which applies it only from an allowed
// state and records it in the append-only booking history.

/** Statuses whose dates are booked. Must match the exclusion constraint in the migration. */
export const PAID_STATUSES = [
  'CONFIRMED',
  'ACTIVE',
  'RETURNED',
  'CLAIM_OPEN',
  'ADMIN_REVIEW',
  'SETTLING',
  'COMPLETED',
];
const IN_PROGRESS = ['CONFIRMED', 'ACTIVE', 'RETURNED', 'CLAIM_OPEN', 'ADMIN_REVIEW', 'SETTLING'];
const UNPAID_OPEN = ['REQUESTED', 'APPROVED'];
const WITH_ITEM = ['CONFIRMED', 'ACTIVE'];

const person = { select: { id: true, phone: true, profile: { select: { displayName: true } } } };
export const bookingInclude = {
  disputes: {
    include: { evidence: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  },
  listing: { select: { locality: true } },
  renter: person,
  owner: person,
};

const iso = (date) => (date ? date.toISOString() : null);

// An account cannot be deleted while it has rentals that are not finished (I16).
registerDeletionBlocker(async ({ db, userId }) => {
  const open = await db.rentalBooking.count({
    where: {
      OR: [{ renterId: userId }, { ownerId: userId }],
      status: { in: [...UNPAID_OPEN, ...IN_PROGRESS] },
    },
  });
  return open > 0 ? 'You have rentals that are not finished yet' : null;
});

// ---------------------------------------------------------------------------
// What each side may do, and see
// ---------------------------------------------------------------------------

function renterActions(b, now) {
  const actions = [];
  if (b.status === 'APPROVED' && b.paymentDueAt > now) actions.push('pay');
  if ([...UNPAID_OPEN, 'CONFIRMED'].includes(b.status)) actions.push('cancel');
  if (b.status === 'ACTIVE') actions.push('return');
  const claim = depositClaim(b);
  if (
    b.status === 'CLAIM_OPEN' &&
    claim?.claimantIsOwner &&
    claim.status === 'OPEN' &&
    claim.respondDueAt > now
  )
    actions.push('claim-response');
  if (['RETURNED', 'CLAIM_OPEN'].includes(b.status) && b.lateFeePaise > 0 && !b.lateFeeDisputedAt)
    actions.push('dispute-late-fee');
  return actions;
}

function ownerActions(b, now) {
  const actions = [];
  if (b.status === 'REQUESTED' && b.holdExpiresAt > now) actions.push('approve', 'decline');
  if (['APPROVED', 'CONFIRMED'].includes(b.status)) actions.push('cancel');
  if (b.status === 'CONFIRMED') actions.push('handover');
  if (b.status === 'RETURNED' && b.inspectionEndsAt > now) actions.push('inspection-ok', 'claim');
  if (
    b.status === 'ACTIVE' &&
    addDays(b.returnDueAt, RENTAL_NON_RETURN_REPORT_DAYS) <= now &&
    !b.nonReturnReportedAt
  )
    actions.push('report-non-return');
  return actions;
}

const CLAIM_STATUS = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'DISPUTED',
  DECIDED: 'DISPUTED',
  APPEALED: 'DISPUTED',
  RESOLVED: 'ACCEPTED',
  CLOSED: 'DECIDED',
  WITHDRAWN: 'WITHDRAWN',
};

/** The owner's damage claim, as the rental pages have shown it, read from the dispute. */
function depositClaim(b) {
  const dispute = (b.disputes ?? []).findLast(
    (d) => d.kind === 'RENTAL_DEPOSIT' && d.claimedDamagePaise !== null,
  );
  if (!dispute) return null;
  const ownerEntry = dispute.evidence?.find((e) => e.authorId === b.ownerId && e.photos?.length);
  const renterEntry = dispute.evidence?.find((e) => e.authorId === b.renterId && e.text);
  const decision = dispute.finalDecision ?? dispute.decision;
  return {
    disputeId: dispute.id,
    claimantIsOwner: dispute.claimantId === b.ownerId,
    description: dispute.description,
    items: dispute.claimItems,
    totalPaise: dispute.claimedDamagePaise,
    photos: (ownerEntry?.photos ?? []).map(({ url, takenAt }) => ({ url, takenAt })),
    status: CLAIM_STATUS[dispute.status],
    respondDueAt: dispute.respondDueAt,
    renterResponse: renterEntry?.text ?? null,
    decidedPaise: decision?.damagePaise ?? null,
    decisionReason: dispute.finalReason ?? dispute.decisionReason,
  };
}

function claimView(claim) {
  if (!claim) return null;
  const rest = { ...claim };
  delete rest.claimantIsOwner;
  return { ...rest, respondDueAt: iso(claim.respondDueAt) };
}

const hasUnfinishedDispute = (b) => (b.disputes ?? []).some((d) => UNFINISHED.includes(d.status));

/** What the owner keeps: the fee left after refunds, less its commission, plus deductions. */
function ownerEarnings(b) {
  const feeKept = b.feePaise - b.feeRefundedPaise;
  const deliveryKept = b.deliveryChargePaise - (b.refundedPaise - b.feeRefundedPaise);
  const commission = commissionOn(feeKept);
  return {
    commissionKeptPaise: commission,
    ownerEarningsPaise: feeKept - commission + deliveryKept + b.depositDeductedPaise,
  };
}

function commonView(b) {
  return {
    id: b.id,
    ref: b.ref,
    status: b.status,
    listingId: b.listingId,
    title: b.title,
    locality: b.listing?.locality ?? null,
    durationDays: b.durationDays,
    startDate: fromDateColumn(b.startDate),
    endDate: fromDateColumn(b.endDate),
    fulfilment: b.fulfilment,
    feePaise: b.feePaise,
    depositPaise: b.depositPaise,
    deliveryChargePaise: b.deliveryChargePaise,
    totalPaise: b.totalPaise,
    lateFeePerDayPaise: b.lateFeePerDayPaise,
    lateFeeGraceHours: LATE_FEE_GRACE_HOURS,
    refundedPaise: b.refundedPaise,
    depositRefundedPaise: b.depositRefundedPaise,
    lateFeePaise: b.lateFeePaise,
    damagePaise: b.damagePaise,
    depositDeductedPaise: b.depositDeductedPaise,
    owedPaise: b.owedPaise,
    lateFeeDisputed: b.lateFeeDisputedAt !== null,
    nonReturnReported: b.nonReturnReportedAt !== null,
    holdExpiresAt: iso(b.holdExpiresAt),
    paymentDueAt: iso(b.paymentDueAt),
    returnDueAt: iso(b.returnDueAt),
    paidAt: iso(b.paidAt),
    handedOverAt: iso(b.handedOverAt),
    returnedAt: iso(b.returnedAt),
    inspectionEndsAt: iso(b.inspectionEndsAt),
    settledAt: iso(b.settledAt),
    completedAt: iso(b.completedAt),
    cancelledAt: iso(b.cancelledAt),
    createdAt: iso(b.createdAt),
    handoverPhotos: b.handoverPhotos ?? [],
    returnPhotos: b.returnPhotos ?? [],
    claim: claimView(depositClaim(b)),
    disputes: (b.disputes ?? []).map((d) => ({
      id: d.id,
      ref: d.ref,
      kind: d.kind,
      status: d.status,
    })),
  };
}

// Phone numbers are shared only while a paid booking is in progress, as for orders (I48).
const contact = (user, share) => ({
  id: user.id,
  displayName: user.profile.displayName,
  phone: share ? user.phone : null,
});

export function toRenterBooking(b, now, gateway) {
  const share = IN_PROGRESS.includes(b.status);
  return {
    ...commonView(b),
    deliveryAddress: b.deliveryAddress ?? null,
    // The exact pickup spot, from payment until the item is back (I41, I48).
    pickup:
      b.fulfilment === 'PICKUP' && WITH_ITEM.includes(b.status) && b.pickupLat !== null
        ? { lat: b.pickupLat, lng: b.pickupLng, locality: b.pickupLocality }
        : null,
    handoverCode: b.status === 'CONFIRMED' ? b.handoverCode : null,
    cancelRefundPaise: b.status === 'CONFIRMED' ? renterCancelRefund(b, now).totalPaise : null,
    payment:
      b.status === 'APPROVED' && b.gatewayOrderId
        ? {
            gateway: gateway.mode,
            keyId: gateway.keyId,
            gatewayOrderId: b.gatewayOrderId,
            amountPaise: b.totalPaise,
            currency: 'INR',
          }
        : null,
    owner: contact(b.owner, share),
    actions: renterActions(b, now),
  };
}

export function toOwnerBooking(b, now) {
  const share = IN_PROGRESS.includes(b.status);
  return {
    ...commonView(b),
    commissionPaise: b.commissionPaise,
    ownerPayablePaise: b.ownerPayablePaise,
    ...ownerEarnings(b),
    // Payout-eligible once the deposit is settled with nothing open (I10).
    payoutEligible: b.status === 'COMPLETED' && !hasUnfinishedDispute(b),
    deliveryAddress: WITH_ITEM.includes(b.status) ? (b.deliveryAddress ?? null) : null,
    returnCode: b.status === 'ACTIVE' ? b.returnCode : null,
    handoverAttemptsLeft:
      b.status === 'CONFIRMED' ? Math.max(0, HANDOVER_MAX_ATTEMPTS - b.handoverAttempts) : null,
    renter: contact(b.renter, share),
    actions: ownerActions(b, now),
  };
}

export function toAdminBooking(b, now, gateway) {
  return {
    ...toOwnerBooking(b, now),
    renterView: toRenterBooking(b, now, gateway),
    renterId: b.renterId,
    ownerId: b.ownerId,
    handoverAttempts: b.handoverAttempts,
    returnAttempts: b.returnAttempts,
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadBooking(db, id) {
  const booking = await db.rentalBooking.findUnique({ where: { id }, include: bookingInclude });
  if (!booking) throw AppError.notFound('Booking not found');
  return booking;
}

export async function loadAs(db, id, { userId, side }) {
  const booking = await loadBooking(db, id);
  const mine = side === 'renter' ? booking.renterId : booking.ownerId;
  if (mine !== userId) throw AppError.notFound('Booking not found');
  return booking;
}

export async function listBookings({ db }, where, query, view) {
  const [rows, total] = await Promise.all([
    db.rentalBooking.findMany({
      where,
      include: bookingInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageWindow(query),
    }),
    db.rentalBooking.count({ where }),
  ]);
  return paged(rows.map(view), total, query);
}

// ---------------------------------------------------------------------------
// The one way a booking changes
// ---------------------------------------------------------------------------

function wrongState(booking, verb) {
  return new AppError(
    409,
    'INVALID_BOOKING_STATE',
    `This booking is ${booking.status.toLowerCase().replaceAll('_', ' ')} and cannot be ${verb}`,
  );
}

async function transition(tx, now, booking, { from, to, data = {}, actor, action, reason, verb }) {
  const { count } = await tx.rentalBooking.updateMany({
    where: { id: booking.id, status: { in: from } },
    data: { ...data, ...(to ? { status: to } : {}) },
  });
  if (count !== 1) throw wrongState(booking, verb);
  await tx.bookingEvent.create({
    data: {
      bookingId: booking.id,
      actorUserId: actor.userId ?? null,
      actorRole: actor.role,
      action,
      fromStatus: booking.status,
      toStatus: to ?? booking.status,
      reason: reason ?? null,
      createdAt: now,
    },
  });
}

async function adminAudit(tx, now, { adminId, action, bookingId, reason, details }) {
  await tx.adminAuditLog.create({
    data: {
      adminId,
      action,
      targetType: 'rental_booking',
      targetId: bookingId,
      reason,
      details: details ?? undefined,
      createdAt: now,
    },
  });
}

const renterActor = (b) => ({ userId: b.renterId, role: 'RENTER' });
const ownerActor = (b) => ({ userId: b.ownerId, role: 'OWNER' });
const adminActor = (adminId) => ({ userId: adminId, role: 'ADMIN' });
const SYSTEM = { role: 'SYSTEM' };

// ---------------------------------------------------------------------------
// Dates: holds, bookings and the owner's closed days
// ---------------------------------------------------------------------------

const datesUnavailable = () =>
  new AppError(409, 'DATES_UNAVAILABLE', 'Some of these dates are already taken');

/** True for the database refusing overlapping dates (exclusion constraint, 23P01). */
const isOverlap = (error) =>
  error?.meta?.code === '23P01' || /no_overlap|23P01/.test(String(error?.message ?? ''));

/**
 * Whether any day from `startDate` to `endDate` is booked, held by a live request
 * or closed by the owner. Call with the listing row locked.
 */
async function datesTaken(tx, now, listingId, startDate, endDate) {
  const rows = await tx.$queryRaw`
    SELECT 1 FROM rental_bookings
     WHERE listing_id = ${listingId}::uuid AND status::text = ANY(${PAID_STATUSES})
       AND daterange(start_date, end_date, '[]') && daterange(${startDate}::date, ${endDate}::date, '[]')
    UNION ALL
    SELECT 1 FROM rental_date_holds
     WHERE listing_id = ${listingId}::uuid AND released_at IS NULL AND expires_at > ${now}
       AND daterange(start_date, end_date, '[]') && daterange(${startDate}::date, ${endDate}::date, '[]')
    UNION ALL
    SELECT 1 FROM rental_blocked_dates
     WHERE listing_id = ${listingId}::uuid
       AND daterange(start_date, end_date, '[]') && daterange(${startDate}::date, ${endDate}::date, '[]')
    LIMIT 1`;
  return rows.length > 0;
}

const lockListing = (tx, listingId) =>
  tx.$queryRaw`SELECT id FROM listings WHERE id = ${listingId}::uuid FOR UPDATE`;

const releaseHold = (tx, now, bookingId) =>
  tx.rentalDateHold.updateMany({
    where: { bookingId, releasedAt: null },
    data: { releasedAt: now },
  });

/** Requests the owner did not answer in 24 hours, or approvals not paid in 12 hours. */
export const dueToExpire = (now) => ({
  OR: [
    { status: 'REQUESTED', holdExpiresAt: { lte: now } },
    { status: 'APPROVED', paymentDueAt: { lte: now } },
  ],
});

/** Expires one booking if its deadline has passed, releasing its dates. In `tx`. */
export async function expireBooking(tx, now, booking) {
  const { count } = await tx.rentalBooking.updateMany({
    where: { id: booking.id, ...dueToExpire(now) },
    data: { status: 'EXPIRED' },
  });
  if (count !== 1) return false;
  await releaseHold(tx, now, booking.id);
  await tx.bookingEvent.create({
    data: {
      bookingId: booking.id,
      actorRole: 'SYSTEM',
      action: booking.status === 'REQUESTED' ? 'OWNER_DID_NOT_ANSWER' : 'NOT_PAID_IN_TIME',
      fromStatus: booking.status,
      toStatus: 'EXPIRED',
      createdAt: now,
    },
  });
  return true;
}

/** The days a renter can pick from: tomorrow up to 90 days ahead. */
function bookableWindow(now) {
  const today = businessDate(now);
  return {
    first: addCalendarDays(today, 1),
    last: addCalendarDays(today, RENTAL_BOOKING_WINDOW_DAYS),
  };
}

/** Public: which days are taken, without saying by whom or why. */
export async function availability({ db, clock }, listingId) {
  const now = clock.now();
  const listing = await db.listing.findFirst({
    where: { id: listingId, ...PUBLICLY_VISIBLE },
    include: { packages: { orderBy: { durationDays: 'asc' } } },
  });
  if (!listing || listing.mode !== 'RENT') throw AppError.notFound('Rental listing not found');
  const { first, last } = bookableWindow(now);
  const rows = await db.$queryRaw`
    SELECT start_date, end_date FROM rental_bookings
     WHERE listing_id = ${listingId}::uuid AND status::text = ANY(${PAID_STATUSES})
       AND end_date >= ${first}::date
    UNION ALL
    SELECT start_date, end_date FROM rental_date_holds
     WHERE listing_id = ${listingId}::uuid AND released_at IS NULL AND expires_at > ${now}
       AND end_date >= ${first}::date
    UNION ALL
    SELECT start_date, end_date FROM rental_blocked_dates
     WHERE listing_id = ${listingId}::uuid AND end_date >= ${first}::date
    ORDER BY 1, 2`;

  // Overlapping or touching ranges are shown as one.
  const blocked = [];
  for (const row of rows) {
    const start = fromDateColumn(row.start_date);
    const end = fromDateColumn(row.end_date);
    const previous = blocked.at(-1);
    if (previous && start <= addCalendarDays(previous.endDate, 1)) {
      if (end > previous.endDate) previous.endDate = end;
    } else {
      blocked.push({ startDate: start, endDate: end });
    }
  }
  return {
    listingId,
    firstStartDate: first,
    lastStartDate: last,
    durations: listing.packages.map((p) => ({
      durationDays: p.durationDays,
      pricePaise: p.pricePaise,
    })),
    blocked,
  };
}

// ---------------------------------------------------------------------------
// Requesting, approving, declining
// ---------------------------------------------------------------------------

export async function requestBooking(deps, renterId, input) {
  const { db, clock } = deps;
  const now = clock.now();
  const listing = await db.listing.findFirst({
    where: { id: input.listingId, deletedAt: null },
    include: { packages: true, seller: { select: { status: true } } },
  });
  if (!listing) throw AppError.notFound('Listing not found');
  if (listing.mode !== 'RENT') {
    throw new AppError(400, 'NOT_FOR_RENT', 'This listing is for sale, not for rent');
  }
  if (listing.status !== 'ACTIVE' || listing.seller.status !== 'ACTIVE') {
    throw new AppError(409, 'NOT_AVAILABLE', 'This listing is not available right now');
  }
  if (listing.sellerId === renterId) {
    throw new AppError(400, 'OWN_LISTING', 'You cannot rent your own listing');
  }
  const pkg = listing.packages.find((p) => p.durationDays === input.durationDays);
  if (!pkg) {
    throw AppError.badRequest('Choose one of the rental periods the owner offers', {
      durations: listing.packages.map((p) => p.durationDays).sort((a, b) => a - b),
    });
  }
  const { first, last } = bookableWindow(now);
  if (input.startDate < first || input.startDate > last) {
    throw new AppError(
      400,
      'START_DATE',
      `Pick a start date from tomorrow up to ${RENTAL_BOOKING_WINDOW_DAYS} days ahead`,
      { first, last },
    );
  }
  const endDate = endDateFor(input.startDate, pkg.durationDays);

  let deliveryAddress = null;
  let deliveryChargePaise = 0;
  if (input.fulfilment === 'DELIVERY') {
    if (!listing.offersDelivery) throw AppError.badRequest('The owner does not deliver this item');
    if (!input.addressId) throw AppError.badRequest('Choose a delivery address');
    const address = await loadOwnAddress(db, renterId, input.addressId);
    const [inside] = await db.$queryRaw`
      SELECT coalesce(ST_DWithin(public_location, ${pointSql(address)}, delivery_radius_km * 1000), false) AS ok
      FROM listings WHERE id = ${listing.id}::uuid`;
    if (!inside?.ok) {
      throw new AppError(
        400,
        'OUTSIDE_DELIVERY_AREA',
        'This address is outside the area the owner delivers to',
      );
    }
    deliveryAddress = toAddress(address);
    deliveryChargePaise = listing.deliveryChargePaise ?? 0;
  } else if (!listing.offersPickup) {
    throw AppError.badRequest('The owner only delivers this item');
  }

  const open = await db.rentalBooking.count({ where: { renterId, status: { in: UNPAID_OPEN } } });
  if (open >= RENTAL_OPEN_REQUESTS_MAX) {
    throw new AppError(
      409,
      'TOO_MANY_OPEN_REQUESTS',
      `You can have at most ${RENTAL_OPEN_REQUESTS_MAX} unpaid requests at a time`,
    );
  }

  const feePaise = pkg.pricePaise;
  const commissionPaise = commissionOn(feePaise);
  const holdExpiresAt = addHours(now, RENTAL_PENDING_HOLD_HOURS);
  const expired = [];
  let booking;
  try {
    booking = await db.$transaction(async (tx) => {
      // One writer per listing at a time; the exclusion constraints back this up.
      await lockListing(tx, listing.id);
      const stale = await tx.rentalBooking.findMany({
        where: { listingId: listing.id, ...dueToExpire(now) },
      });
      for (const old of stale) if (await expireBooking(tx, now, old)) expired.push(old.id);
      if (await datesTaken(tx, now, listing.id, input.startDate, endDate)) throw datesUnavailable();

      const created = await tx.rentalBooking.create({
        data: {
          ref: bookingRef(),
          listingId: listing.id,
          renterId,
          ownerId: listing.sellerId,
          title: listing.title,
          durationDays: pkg.durationDays,
          startDate: toDateColumn(input.startDate),
          endDate: toDateColumn(endDate),
          fulfilment: input.fulfilment,
          deliveryAddress: deliveryAddress ?? undefined,
          feePaise,
          depositPaise: listing.depositPaise,
          deliveryChargePaise,
          totalPaise: feePaise + listing.depositPaise + deliveryChargePaise,
          commissionPaise,
          // The owner arranges delivery, so the delivery charge is theirs, as for sales.
          ownerPayablePaise: feePaise - commissionPaise + deliveryChargePaise,
          lateFeePerDayPaise: listing.lateFeePerDayPaise ?? 0,
          holdExpiresAt,
          returnDueAt: returnDueAtFor(endDate),
          createdAt: now,
        },
      });
      await tx.rentalDateHold.create({
        data: {
          listingId: listing.id,
          bookingId: created.id,
          startDate: toDateColumn(input.startDate),
          endDate: toDateColumn(endDate),
          expiresAt: holdExpiresAt,
          createdAt: now,
        },
      });
      await tx.bookingEvent.create({
        data: {
          bookingId: created.id,
          actorUserId: renterId,
          actorRole: 'RENTER',
          action: 'REQUESTED',
          toStatus: 'REQUESTED',
          createdAt: now,
        },
      });
      return created;
    });
  } catch (error) {
    if (isOverlap(error)) throw datesUnavailable();
    throw error;
  }

  for (const id of expired) await notifyExpired(deps, id);
  const loaded = await loadBooking(db, booking.id);
  await notifyBooking(deps, loaded, 'owner', 'requestedOwner');
  await notifyBooking(deps, loaded, 'renter', 'requestedRenter');
  return loaded;
}

export async function notifyExpired(deps, bookingId) {
  const booking = await loadBooking(deps.db, bookingId);
  await notifyBooking(deps, booking, 'renter', 'expiredRenter');
  await notifyBooking(deps, booking, 'owner', 'expiredOwner');
}

export async function approveBooking(deps, booking) {
  const now = deps.clock.now();
  if (booking.status === 'REQUESTED' && booking.holdExpiresAt <= now) {
    throw new AppError(409, 'REQUEST_EXPIRED', 'This request has expired');
  }
  const paymentDueAt = addHours(now, RENTAL_PAYMENT_WINDOW_HOURS);
  await deps.db.$transaction(async (tx) => {
    await transition(tx, now, booking, {
      from: ['REQUESTED'],
      to: 'APPROVED',
      data: { approvedAt: now, paymentDueAt },
      actor: ownerActor(booking),
      action: 'APPROVED',
      verb: 'approved',
    });
    // The dates stay held until the payment deadline (I5).
    await tx.rentalDateHold.updateMany({
      where: { bookingId: booking.id, releasedAt: null },
      data: { expiresAt: paymentDueAt },
    });
  });
  const updated = await loadBooking(deps.db, booking.id);
  await notifyBooking(deps, updated, 'renter', 'approvedRenter');
  return updated;
}

export async function declineBooking(deps, booking, reason) {
  const now = deps.clock.now();
  await deps.db.$transaction(async (tx) => {
    await transition(tx, now, booking, {
      from: ['REQUESTED'],
      to: 'DECLINED',
      actor: ownerActor(booking),
      action: 'DECLINED',
      reason,
      verb: 'declined',
    });
    await releaseHold(tx, now, booking.id);
  });
  const updated = await loadBooking(deps.db, booking.id);
  await notifyBooking(deps, updated, 'renter', 'declinedRenter');
  return updated;
}

// ---------------------------------------------------------------------------
// Paying
// ---------------------------------------------------------------------------

/** Opens the payment for an approved booking on the gateway, once. */
export async function startPayment(deps, booking) {
  const { db, clock, paymentGateway } = deps;
  if (booking.status !== 'APPROVED' || booking.paymentDueAt <= clock.now()) {
    throw new AppError(409, 'NOT_PAYABLE', 'This booking cannot be paid now');
  }
  if (!booking.gatewayOrderId) {
    // Outside any transaction, so no lock is held during the call.
    const order = await paymentGateway.createOrder({
      amountPaise: booking.totalPaise,
      receipt: booking.id,
      notes: { bookingId: booking.id },
    });
    await db.rentalBooking.updateMany({
      where: { id: booking.id, gatewayOrderId: null },
      data: { gatewayOrderId: order.id },
    });
  }
  return loadBooking(db, booking.id);
}

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

async function bookingPaymentId(tx, bookingId) {
  const payment = await tx.payment.findFirst({
    where: { bookingId, status: 'CAPTURED' },
    orderBy: { capturedAt: 'asc' },
  });
  if (!payment) throw new AppError(409, 'NO_PAYMENT', 'This booking has no captured payment');
  return payment.id;
}

/** A refund of parts of a booking payment: fee, delivery and deposit. In `tx`. */
async function bookingRefund(
  tx,
  now,
  booking,
  { key, feePaise, deliveryPaise, depositPaise, reason },
) {
  const amountPaise = feePaise + deliveryPaise + depositPaise;
  if (amountPaise <= 0) return null;
  return createRefund(tx, now, {
    key,
    bookingId: booking.id,
    paymentId: await bookingPaymentId(tx, booking.id),
    amountPaise,
    itemsAmountPaise: feePaise,
    depositAmountPaise: depositPaise,
    reason,
  });
}

const fullRefund = (booking) => ({
  feePaise: booking.feePaise,
  deliveryPaise: booking.deliveryChargePaise,
  depositPaise: booking.depositPaise,
});

async function cancel(deps, booking, { from, actor, reason, refundParts, refundReason, admin }) {
  const now = deps.clock.now();
  const paid = booking.status === 'CONFIRMED';
  const refund = await deps.db.$transaction(async (tx) => {
    await transition(tx, now, booking, {
      from,
      to: 'CANCELLED',
      data: { cancelledAt: now },
      actor,
      action: 'CANCELLED',
      reason,
      verb: 'cancelled',
    });
    await releaseHold(tx, now, booking.id);
    if (admin) {
      await adminAudit(tx, now, {
        adminId: admin,
        action: 'CANCEL_BOOKING',
        bookingId: booking.id,
        reason,
      });
    }
    if (!paid) return null;
    return bookingRefund(tx, now, booking, {
      key: `booking:${booking.id}:cancel`,
      ...refundParts(booking, now),
      reason: refundReason,
    });
  });
  if (refund) await processRefund(deps, refund.id);
  return loadBooking(deps.db, booking.id);
}

/** Free before paying; after paying, the fee refund depends on the start day (SPEC Module 4). */
export async function cancelByRenter(deps, booking, reason) {
  const updated = await cancel(deps, booking, {
    from: [...UNPAID_OPEN, 'CONFIRMED'],
    actor: renterActor(booking),
    reason,
    refundParts: (b, now) => {
      const due = renterCancelRefund(b, now);
      return {
        feePaise: due.feePaise,
        deliveryPaise: due.deliveryPaise,
        depositPaise: due.depositPaise,
      };
    },
    refundReason: 'RENTER_CANCELLED',
  });
  await notifyBooking(deps, updated, 'owner', 'cancelled');
  return updated;
}

/** The owner may cancel before handover; a paid booking is refunded in full. */
export async function cancelByOwner(deps, booking, reason) {
  const updated = await cancel(deps, booking, {
    from: ['APPROVED', 'CONFIRMED'],
    actor: ownerActor(booking),
    reason,
    refundParts: fullRefund,
    refundReason: 'OWNER_CANCELLED',
  });
  await notifyBooking(deps, updated, 'renter', 'cancelled');
  return updated;
}

export async function adminCancel(deps, booking, adminId, reason) {
  const updated = await cancel(deps, booking, {
    from: [...UNPAID_OPEN, 'CONFIRMED'],
    actor: adminActor(adminId),
    reason,
    refundParts: fullRefund,
    refundReason: 'ADMIN_CANCELLED',
    admin: adminId,
  });
  await notifyBooking(deps, updated, 'renter', 'cancelled');
  await notifyBooking(deps, updated, 'owner', 'cancelled');
  return updated;
}

// ---------------------------------------------------------------------------
// Handover and return: one-time code plus timestamped condition photos (I17)
// ---------------------------------------------------------------------------

function conditionPhotos(files, min = RENTAL_CONDITION_PHOTOS_MIN) {
  const images = readImages(files);
  if (images.length < min || images.length > RENTAL_CONDITION_PHOTOS_MAX) {
    throw new AppError(
      400,
      'CONDITION_PHOTOS',
      `Add between ${min} and ${RENTAL_CONDITION_PHOTOS_MAX} photos of the item's condition`,
    );
  }
  return images;
}

const photoRecords = (stored, now) =>
  stored.map((photo) => ({ url: photo.url, takenAt: now.toISOString() }));

const codesLocked = () =>
  new AppError(
    429,
    'CODE_LOCKED',
    'Too many wrong codes. Contact support: our team can confirm it for you.',
  );

/** Checks a one-time code; wrong tries are counted so they can never exceed the limit. */
async function checkCode(db, booking, { typed, stored, field, status }) {
  if (booking[field] >= HANDOVER_MAX_ATTEMPTS) throw codesLocked();
  if (codeMatches(typed, stored)) return;
  const { count } = await db.rentalBooking.updateMany({
    where: { id: booking.id, status, [field]: { lt: HANDOVER_MAX_ATTEMPTS } },
    data: { [field]: { increment: 1 } },
  });
  if (count !== 1) throw codesLocked();
  throw new AppError(400, 'WRONG_CODE', 'That code is not right', {
    attemptsLeft: HANDOVER_MAX_ATTEMPTS - booking[field] - 1,
  });
}

/** Stores photos, runs `change` in a transaction, and removes the photos if it fails. */
async function withStoredPhotos(deps, images, change) {
  const stored = await storeImages(deps, images, 'rentals');
  try {
    await deps.db.$transaction((tx) => change(tx, stored));
  } catch (error) {
    await discardStored(deps, stored);
    throw error;
  }
}

/** The owner enters the renter's handover code and photographs the item's condition. */
export async function completeHandover(deps, booking, code, files) {
  if (booking.status !== 'CONFIRMED') throw wrongState(booking, 'handed over');
  const images = conditionPhotos(files);
  await checkCode(deps.db, booking, {
    typed: code,
    stored: booking.handoverCode,
    field: 'handoverAttempts',
    status: 'CONFIRMED',
  });
  const now = deps.clock.now();
  await withStoredPhotos(deps, images, (tx, stored) =>
    transition(tx, now, booking, {
      from: ['CONFIRMED'],
      to: 'ACTIVE',
      data: { handedOverAt: now, handoverPhotos: photoRecords(stored, now) },
      actor: ownerActor(booking),
      action: 'HANDED_OVER',
      verb: 'handed over',
    }),
  );
  const updated = await loadBooking(deps.db, booking.id);
  await notifyBooking(deps, updated, 'renter', 'handedOverRenter');
  return updated;
}

const returnedData = (booking, now) => ({
  returnedAt: now,
  inspectionEndsAt: addHours(now, DEPOSIT_AUTO_REFUND_AFTER_RETURN_HOURS),
  lateFeePaise: lateFeeFor({
    returnDueAt: booking.returnDueAt,
    returnedAt: now,
    lateFeePerDayPaise: booking.lateFeePerDayPaise,
  }),
});

/** The renter enters the owner's return code and photographs the item's condition. */
export async function completeReturn(deps, booking, code, files) {
  if (booking.status !== 'ACTIVE') throw wrongState(booking, 'returned');
  const images = conditionPhotos(files);
  await checkCode(deps.db, booking, {
    typed: code,
    stored: booking.returnCode,
    field: 'returnAttempts',
    status: 'ACTIVE',
  });
  const now = deps.clock.now();
  await withStoredPhotos(deps, images, (tx, stored) =>
    transition(tx, now, booking, {
      from: ['ACTIVE'],
      to: 'RETURNED',
      data: { ...returnedData(booking, now), returnPhotos: photoRecords(stored, now) },
      actor: renterActor(booking),
      action: 'RETURNED',
      verb: 'returned',
    }),
  );
  const updated = await loadBooking(deps.db, booking.id);
  await notifyBooking(deps, updated, 'owner', 'returnedOwner');
  await notifyBooking(deps, updated, 'renter', 'returnedRenter');
  return updated;
}

/** Three days after the due time, the owner can tell us the item has not come back. */
export async function reportNonReturn(deps, booking, reason) {
  const now = deps.clock.now();
  if (booking.status !== 'ACTIVE') throw wrongState(booking, 'reported');
  if (addDays(booking.returnDueAt, RENTAL_NON_RETURN_REPORT_DAYS) > now) {
    throw new AppError(
      409,
      'TOO_EARLY',
      `You can report it ${RENTAL_NON_RETURN_REPORT_DAYS} days after it was due back`,
    );
  }
  await deps.db.$transaction(async (tx) => {
    await transition(tx, now, booking, {
      from: ['ACTIVE'],
      to: 'ADMIN_REVIEW',
      data: { nonReturnReportedAt: now },
      actor: ownerActor(booking),
      action: 'NOT_RETURNED',
      reason,
      verb: 'reported',
    });
    await openDispute(tx, now, {
      kind: 'NOT_RETURNED',
      bookingId: booking.id,
      claimantId: booking.ownerId,
      respondentId: booking.renterId,
      description: reason || 'The owner says the item has not been returned.',
      evidence: { authorId: booking.ownerId, text: reason || null },
    });
  });
  await announceOpened(deps, { bookingId: booking.id, kind: 'NOT_RETURNED' });
  const updated = await loadBooking(deps.db, booking.id);
  await notifyBooking(deps, updated, 'renter', 'sentToReview');
  return updated;
}

// ---------------------------------------------------------------------------
// Settling the deposit
// ---------------------------------------------------------------------------

/**
 * Fixes what comes out of the deposit, records it, and starts the refund of the
 * rest. With nothing left to refund the booking completes at once. In `tx`.
 */
async function settle(
  tx,
  now,
  booking,
  { from, lateFeePaise, damagePaise, actor, action, reason },
) {
  const due = depositSettlement({ depositPaise: booking.depositPaise, lateFeePaise, damagePaise });
  const done = due.refundPaise === 0;
  await transition(tx, now, booking, {
    from,
    to: done ? 'COMPLETED' : 'SETTLING',
    data: {
      lateFeePaise,
      damagePaise,
      depositDeductedPaise: due.deductedPaise,
      owedPaise: due.owedPaise,
      settledAt: now,
      ...(done ? { completedAt: now } : {}),
    },
    actor,
    action,
    reason,
    verb: 'settled',
  });
  await recordLedger(tx, now, [
    {
      key: `booking:${booking.id}:deposit-deduction`,
      type: 'DEPOSIT_DEDUCTION',
      amountPaise: due.deductedPaise,
      bookingId: booking.id,
      sellerId: booking.ownerId,
    },
    // Late fees and damage go to the owner. Commission is on the rental fee only.
    {
      key: `booking:${booking.id}:deduction-payable`,
      type: 'SELLER_PAYABLE',
      amountPaise: due.deductedPaise,
      bookingId: booking.id,
      sellerId: booking.ownerId,
    },
  ]);
  if (done) return null;
  return createRefund(tx, now, {
    key: `booking:${booking.id}:deposit`,
    bookingId: booking.id,
    paymentId: await bookingPaymentId(tx, booking.id),
    amountPaise: due.refundPaise,
    itemsAmountPaise: 0,
    depositAmountPaise: due.refundPaise,
    reason: 'DEPOSIT_RETURN',
  });
}

/**
 * After inspection: settle, unless a deposit dispute is still open (a disputed late
 * fee), in which case the booking waits for it in ADMIN_REVIEW. In `tx`.
 */
async function settleUnlessDisputed(tx, now, booking, { from, damagePaise, actor, action }) {
  const open = await tx.dispute.findFirst({
    where: { bookingId: booking.id, status: { in: UNFINISHED } },
  });
  if (open) {
    await transition(tx, now, booking, {
      from,
      to: 'ADMIN_REVIEW',
      data: { damagePaise },
      actor,
      action: `${action}_DISPUTE_OPEN`,
      verb: 'settled',
    });
    return null;
  }
  return settle(tx, now, booking, {
    from,
    lateFeePaise: booking.lateFeePaise ?? 0,
    damagePaise,
    actor,
    action,
  });
}

/** After a settlement: send the refund and tell both sides. */
async function afterSettlement(deps, bookingId, refund) {
  if (refund) await processRefund(deps, refund.id);
  const updated = await loadBooking(deps.db, bookingId);
  if (updated.status === 'ADMIN_REVIEW') {
    await notifyBooking(deps, updated, 'renter', 'sentToReview');
    await notifyBooking(deps, updated, 'owner', 'sentToReview');
  } else if (updated.settledAt) {
    await notifyBooking(deps, updated, 'renter', 'settledRenter');
    if (updated.status === 'COMPLETED' && !refund) {
      await notifyBooking(deps, updated, 'owner', 'completedOwner');
    }
  }
  return updated;
}

function inspectionOpen(booking, now) {
  if (booking.status !== 'RETURNED') return wrongState(booking, 'inspected');
  if (booking.inspectionEndsAt <= now) {
    return new AppError(
      409,
      'INSPECTION_WINDOW_CLOSED',
      'The 48-hour inspection window after the return has ended',
    );
  }
  return null;
}

/** The owner checked the item and it is fine: only a late fee, if any, is kept. */
export async function inspectionOk(deps, booking) {
  const now = deps.clock.now();
  const problem = inspectionOpen(booking, now);
  if (problem) throw problem;
  const refund = await deps.db.$transaction((tx) =>
    settleUnlessDisputed(tx, now, booking, {
      from: ['RETURNED'],
      damagePaise: 0,
      actor: ownerActor(booking),
      action: 'INSPECTED_OK',
    }),
  );
  return afterSettlement(deps, booking.id, refund);
}

/** 48 hours after the return with no claim: the deposit goes back automatically (SPEC 13). */
export async function settleAfterInspectionWindow(deps, bookingId) {
  const now = deps.clock.now();
  const booking = await loadBooking(deps.db, bookingId);
  if (booking.status !== 'RETURNED' || booking.inspectionEndsAt > now) return false;
  let refund;
  try {
    refund = await deps.db.$transaction((tx) =>
      settleUnlessDisputed(tx, now, booking, {
        from: ['RETURNED'],
        damagePaise: 0,
        actor: SYSTEM,
        action: 'INSPECTION_WINDOW_ENDED',
      }),
    );
  } catch (error) {
    if (error?.code === 'INVALID_BOOKING_STATE') return false; // a claim got there first
    throw error;
  }
  await afterSettlement(deps, booking.id, refund);
  return true;
}

/**
 * Within 48 hours of the return: photos, a description and itemised costs. Opens a
 * deposit dispute, or joins the renter's open late-fee dispute (one per booking).
 */
export async function fileClaim(deps, booking, { description, items }, files) {
  const now = deps.clock.now();
  const problem = inspectionOpen(booking, now);
  if (problem) throw problem;
  const images = conditionPhotos(files, CLAIM_PHOTOS_MIN);
  const totalPaise = items.reduce((sum, item) => sum + item.amountPaise, 0);
  await withStoredPhotos(deps, images, async (tx, stored) => {
    await transition(tx, now, booking, {
      from: ['RETURNED'],
      to: 'CLAIM_OPEN',
      actor: ownerActor(booking),
      action: 'CLAIM_FILED',
      reason: description,
      verb: 'claimed on',
    });
    const photos = evidencePhotos(stored, now);
    const open = await tx.dispute.findFirst({
      where: { bookingId: booking.id, status: { in: UNFINISHED } },
    });
    if (open) {
      await tx.dispute.update({
        where: { id: open.id },
        data: { claimItems: items, claimedDamagePaise: totalPaise },
      });
      await recordEvidence(tx, now, open.id, {
        authorId: booking.ownerId,
        role: open.claimantId === booking.ownerId ? 'CLAIMANT' : 'RESPONDENT',
        text: description,
        photos,
      });
    } else {
      await openDispute(tx, now, {
        kind: 'RENTAL_DEPOSIT',
        bookingId: booking.id,
        claimantId: booking.ownerId,
        respondentId: booking.renterId,
        description,
        claimItems: items,
        claimedDamagePaise: totalPaise,
        evidence: { authorId: booking.ownerId, text: description, photos },
      });
    }
  });
  await announceOpened(deps, { bookingId: booking.id, kind: 'RENTAL_DEPOSIT' });
  const updated = await loadBooking(deps.db, booking.id);
  await notifyBooking(deps, updated, 'renter', 'claimFiledRenter');
  return updated;
}

/** The renter disputes the late fee: a deposit dispute (SPEC 13), or a note on the open one. */
export async function disputeLateFee(deps, booking, reason) {
  const now = deps.clock.now();
  if (
    !['RETURNED', 'CLAIM_OPEN'].includes(booking.status) ||
    !(booking.lateFeePaise > 0) ||
    booking.lateFeeDisputedAt
  ) {
    throw new AppError(409, 'LATE_FEE_NOT_DISPUTABLE', 'There is no late fee to dispute');
  }
  await deps.db.$transaction(async (tx) => {
    await transition(tx, now, booking, {
      from: ['RETURNED', 'CLAIM_OPEN'],
      data: { lateFeeDisputedAt: now },
      actor: renterActor(booking),
      action: 'LATE_FEE_DISPUTED',
      reason,
      verb: 'disputed',
    });
    const open = await tx.dispute.findFirst({
      where: { bookingId: booking.id, status: { in: UNFINISHED } },
    });
    if (open) {
      await tx.dispute.update({ where: { id: open.id }, data: { lateFeeDisputed: true } });
      await recordEvidence(tx, now, open.id, {
        authorId: booking.renterId,
        role: 'RESPONDENT',
        text: `Disputes the late fee: ${reason}`,
      });
    } else {
      await openDispute(tx, now, {
        kind: 'RENTAL_DEPOSIT',
        bookingId: booking.id,
        claimantId: booking.renterId,
        respondentId: booking.ownerId,
        description: reason,
        lateFeeDisputed: true,
        evidence: { authorId: booking.renterId, text: reason },
      });
    }
  });
  const updated = await loadBooking(deps.db, booking.id);
  await notifyBooking(deps, updated, 'owner', 'lateFeeDisputedOwner');
  return updated;
}

// ---------------------------------------------------------------------------
// Effects of dispute outcomes (called by the dispute module, which audits them)
// ---------------------------------------------------------------------------

const DISPUTE_STATES = ['RETURNED', 'CLAIM_OPEN', 'ADMIN_REVIEW'];

/** Takes the decided damage and late fee from the deposit and refunds the rest. */
export async function settleDeposit(deps, booking, { damagePaise, lateFeePaise }, actor, reason) {
  const now = deps.clock.now();
  const refund = await deps.db.$transaction((tx) =>
    settle(tx, now, booking, {
      from: DISPUTE_STATES,
      lateFeePaise,
      damagePaise,
      actor,
      action: 'DISPUTE_SETTLED',
      reason,
    }),
  );
  return afterSettlement(deps, booking.id, refund);
}

/** A deposit dispute went to an admin: a claim waiting for the renter now waits for review. */
export async function moveClaimToReview(deps, booking) {
  if (booking.status !== 'CLAIM_OPEN') return booking;
  const now = deps.clock.now();
  await deps.db.$transaction((tx) =>
    transition(tx, now, booking, {
      from: ['CLAIM_OPEN'],
      to: 'ADMIN_REVIEW',
      actor: SYSTEM,
      action: 'DISPUTE_TO_REVIEW',
      verb: 'reviewed',
    }),
  );
  return loadBooking(deps.db, booking.id);
}

/**
 * A deposit dispute ended without a settlement amount (withdrawn, or the late fee
 * waived): carry on where the booking was. Before the inspection deadline a
 * withdrawn claim returns the booking to inspection; otherwise it settles with
 * the late fee as it now stands and no damage.
 */
export async function resumeDeposit(deps, booking, actor, { waiveLateFee = false } = {}) {
  const now = deps.clock.now();
  const lateFeePaise = waiveLateFee ? 0 : (booking.lateFeePaise ?? 0);
  if (booking.status === 'RETURNED') {
    if (waiveLateFee) {
      await deps.db.$transaction((tx) =>
        transition(tx, now, booking, {
          from: ['RETURNED'],
          data: { lateFeePaise: 0 },
          actor,
          action: 'LATE_FEE_WAIVED',
          verb: 'changed',
        }),
      );
    }
    return loadBooking(deps.db, booking.id);
  }
  if (booking.status === 'CLAIM_OPEN' && booking.inspectionEndsAt > now) {
    await deps.db.$transaction((tx) =>
      transition(tx, now, booking, {
        from: ['CLAIM_OPEN'],
        to: 'RETURNED',
        data: { lateFeePaise },
        actor,
        action: 'CLAIM_WITHDRAWN',
        verb: 'changed',
      }),
    );
    return loadBooking(deps.db, booking.id);
  }
  return settleDeposit(deps, booking, { damagePaise: 0, lateFeePaise }, actor, null);
}

/** "Not returned" decided as returned after all: the inspection window starts now. */
export async function confirmReturned(deps, booking, actor, reason) {
  const now = deps.clock.now();
  await deps.db.$transaction((tx) =>
    transition(tx, now, booking, {
      from: ['ADMIN_REVIEW'],
      to: 'RETURNED',
      data: returnedData(booking, now),
      actor,
      action: 'RETURN_CONFIRMED',
      reason,
      verb: 'confirmed as returned',
    }),
  );
  const updated = await loadBooking(deps.db, booking.id);
  await notifyBooking(deps, updated, 'owner', 'returnedOwner');
  await notifyBooking(deps, updated, 'renter', 'returnedRenter');
  return updated;
}

/** The owner withdrew a "not returned" report: the rental is out again. */
export async function resumeActive(deps, booking, actor) {
  const now = deps.clock.now();
  await deps.db.$transaction((tx) =>
    transition(tx, now, booking, {
      from: ['ADMIN_REVIEW'],
      to: 'ACTIVE',
      data: { nonReturnReportedAt: null },
      actor,
      action: 'NOT_RETURNED_WITHDRAWN',
      verb: 'changed',
    }),
  );
  return loadBooking(deps.db, booking.id);
}

// ---------------------------------------------------------------------------
// Admin steps: each needs a reason and is written to the admin audit log
// ---------------------------------------------------------------------------

/** When the handover code cannot be used: the admin confirms the handover. */
export async function adminVerifyHandover(deps, booking, adminId, reason) {
  const now = deps.clock.now();
  await deps.db.$transaction(async (tx) => {
    await transition(tx, now, booking, {
      from: ['CONFIRMED'],
      to: 'ACTIVE',
      data: { handedOverAt: now },
      actor: adminActor(adminId),
      action: 'HANDOVER_VERIFIED',
      reason,
      verb: 'confirmed as handed over',
    });
    await adminAudit(tx, now, {
      adminId,
      action: 'VERIFY_HANDOVER',
      bookingId: booking.id,
      reason,
    });
  });
  const updated = await loadBooking(deps.db, booking.id);
  await notifyBooking(deps, updated, 'renter', 'handedOverRenter');
  return updated;
}

/** When the return code cannot be used: the admin confirms the return. */
export async function adminVerifyReturn(deps, booking, adminId, reason) {
  const now = deps.clock.now();
  if (booking.returnedAt) throw wrongState(booking, 'confirmed as returned');
  await deps.db.$transaction(async (tx) => {
    await transition(tx, now, booking, {
      from: ['ACTIVE'],
      to: 'RETURNED',
      data: returnedData(booking, now),
      actor: adminActor(adminId),
      action: 'RETURN_VERIFIED',
      reason,
      verb: 'confirmed as returned',
    });
    await adminAudit(tx, now, { adminId, action: 'VERIFY_RETURN', bookingId: booking.id, reason });
  });
  const updated = await loadBooking(deps.db, booking.id);
  await notifyBooking(deps, updated, 'owner', 'returnedOwner');
  await notifyBooking(deps, updated, 'renter', 'returnedRenter');
  return updated;
}

// ---------------------------------------------------------------------------
// The owner's closed days
// ---------------------------------------------------------------------------

async function ownRentListing(db, ownerId, listingId) {
  const listing = await db.listing.findFirst({
    where: { id: listingId, sellerId: ownerId, deletedAt: null },
  });
  if (!listing || listing.mode !== 'RENT') throw AppError.notFound('Rental listing not found');
  return listing;
}

const blockedView = (row) => ({
  id: row.id,
  listingId: row.listingId,
  startDate: fromDateColumn(row.startDate),
  endDate: fromDateColumn(row.endDate),
});

export async function listBlockedDates({ db }, ownerId, listingId) {
  await ownRentListing(db, ownerId, listingId);
  const rows = await db.rentalBlockedDate.findMany({
    where: { listingId },
    orderBy: { startDate: 'asc' },
  });
  return rows.map(blockedView);
}

export async function addBlockedDates(deps, ownerId, { listingId, startDate, endDate }) {
  const { db, clock } = deps;
  const now = clock.now();
  await ownRentListing(db, ownerId, listingId);
  const { first, last } = bookableWindow(now);
  if (endDate < startDate) throw AppError.badRequest('The last day must not be before the first');
  if (startDate < first || endDate > addCalendarDays(last, 60)) {
    throw AppError.badRequest('Close days from tomorrow onwards, within the next few months');
  }
  const row = await db.$transaction(async (tx) => {
    await lockListing(tx, listingId);
    if ((await tx.rentalBlockedDate.count({ where: { listingId } })) >= BLOCKED_RANGES_MAX) {
      throw new AppError(409, 'TOO_MANY_BLOCKS', `At most ${BLOCKED_RANGES_MAX} closed periods`);
    }
    if (await datesTaken(tx, now, listingId, startDate, endDate)) {
      throw new AppError(
        409,
        'DATES_UNAVAILABLE',
        'Some of these days are already booked, requested or closed',
      );
    }
    return tx.rentalBlockedDate.create({
      data: {
        listingId,
        startDate: toDateColumn(startDate),
        endDate: toDateColumn(endDate),
        createdAt: now,
      },
    });
  });
  return blockedView(row);
}

export async function removeBlockedDates({ db }, ownerId, id) {
  const row = await db.rentalBlockedDate.findUnique({ where: { id }, include: { listing: true } });
  if (!row || row.listing.sellerId !== ownerId) throw AppError.notFound('Closed period not found');
  await db.rentalBlockedDate.delete({ where: { id } });
}
