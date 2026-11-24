import crypto from 'node:crypto';
import {
  DISPATCH_EXTENSION_MAX_BUSINESS_DAYS,
  HANDOVER_MAX_ATTEMPTS,
  ISSUE_PHOTOS_MAX,
  ISSUE_PHOTOS_MIN,
  ISSUE_REPORT_WINDOW_DAYS,
  RECEIPT_WINDOW_HOURS,
} from '../../config/policy.js';
import { addBusinessDays, addDays, addHours } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { paged, pageWindow } from '../../lib/pagination.js';
import { discardStored, readImages, storeImages } from '../listings/listings.service.js';
import { createRefund, processRefund } from '../payments/refunds.service.js';
import {
  evidencePhotos,
  announceOpened,
  openDispute,
  UNFINISHED,
  unfinishedDispute,
} from '../disputes/dispute.records.js';
import { notify } from './order.emails.js';

// Seller orders as an explicit state machine (see the plan in docs). Every change
// goes through `transition`, which applies it only if the order is still in an
// allowed state, and records who made it and why in the append-only order history.

const ACTIVE = [
  'AWAITING_DISPATCH',
  'AWAITING_PICKUP',
  'DISPATCHED',
  'DELIVERY_REPORTED',
  'ADMIN_REVIEW',
  'DELIVERED',
  'ISSUE_OPEN',
];
const BEFORE_DISPATCH = ['AWAITING_DISPATCH', 'AWAITING_PICKUP'];

const orderInclude = {
  items: true,
  disputes: {
    include: { evidence: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  },
  buyer: { select: { id: true, phone: true, profile: { select: { displayName: true } } } },
  seller: { select: { id: true, phone: true, profile: { select: { displayName: true } } } },
};

const iso = (date) => (date ? date.toISOString() : null);

/** The order's sale-issue dispute, if the buyer ever reported one (one per order). */
const saleIssue = (order) => order.disputes?.findLast((d) => d.kind === 'SALE_ISSUE') ?? null;
const hasUnfinishedDispute = (order) =>
  (order.disputes ?? []).some((d) => UNFINISHED.includes(d.status));

/** The issue as the order pages have shown it since Step 5, now read from the dispute. */
function issueView(dispute, order) {
  if (!dispute || dispute.status === 'WITHDRAWN') return null;
  const finished = !UNFINISHED.includes(dispute.status);
  const decision = dispute.finalDecision ?? dispute.decision;
  const resolution =
    dispute.status === 'RESOLVED' ? 'FULL_REFUND' : finished ? (decision?.outcome ?? null) : null;
  return {
    disputeId: dispute.id,
    kind: dispute.category,
    description: dispute.description,
    photos: (dispute.evidence?.[0]?.photos ?? []).map((photo) => photo.url),
    status: finished ? 'RESOLVED' : 'OPEN',
    resolution,
    refundPaise:
      resolution === 'PARTIAL_REFUND'
        ? (decision?.refundPaise ?? null)
        : resolution === 'FULL_REFUND'
          ? order.refundedPaise
          : null,
  };
}

// ---------------------------------------------------------------------------
// What each side may do, and see
// ---------------------------------------------------------------------------

function buyerActions(order, now) {
  const actions = [];
  if (BEFORE_DISPATCH.includes(order.status)) actions.push('cancel');
  if (order.status === 'DELIVERY_REPORTED') actions.push('confirm', 'not-received');
  if (order.status === 'DELIVERED' && !saleIssue(order) && order.issueWindowEndsAt > now)
    actions.push('issue');
  if (order.status === 'AWAITING_DISPATCH' && order.extensionStatus === 'REQUESTED')
    actions.push('extension');
  return actions;
}

function sellerActions(order) {
  const actions = [];
  if (order.status === 'AWAITING_DISPATCH') actions.push('dispatch');
  if (['AWAITING_DISPATCH', 'DISPATCHED'].includes(order.status)) actions.push('deliver');
  if (order.status === 'AWAITING_PICKUP') actions.push('handover');
  if (BEFORE_DISPATCH.includes(order.status)) actions.push('cancel');
  if (order.status === 'AWAITING_DISPATCH' && order.extensionStatus === 'NONE')
    actions.push('extension');
  return actions;
}

function commonView(order) {
  return {
    id: order.id,
    ref: order.ref,
    status: order.status,
    fulfilment: order.fulfilment,
    itemsSubtotalPaise: order.itemsSubtotalPaise,
    deliveryChargePaise: order.deliveryChargePaise,
    totalPaise: order.totalPaise,
    refundedPaise: order.refundedPaise,
    deliveryAddress: order.deliveryAddress ?? null,
    courierReference: order.courierReference,
    dispatchDueAt: iso(order.dispatchDueAt),
    dispatchOverdue: order.dispatchOverdueAt !== null,
    extension: { status: order.extensionStatus, until: iso(order.extensionUntil) },
    dispatchedAt: iso(order.dispatchedAt),
    deliveryReportedAt: iso(order.deliveryReportedAt),
    receiptDueAt: iso(order.receiptDueAt),
    deliveredAt: iso(order.deliveredAt),
    issueWindowEndsAt: iso(order.issueWindowEndsAt),
    completedAt: iso(order.completedAt),
    cancelledAt: iso(order.cancelledAt),
    issue: issueView(saleIssue(order), order),
    disputes: (order.disputes ?? []).map((d) => ({
      id: d.id,
      ref: d.ref,
      kind: d.kind,
      status: d.status,
    })),
    createdAt: iso(order.createdAt),
  };
}

/** Contact details are shared only while the order is in progress (decision I48). */
const contact = (user, active) => ({
  id: user.id,
  displayName: user.profile.displayName,
  phone: active ? user.phone : null,
});

export function toBuyerOrder(order, now) {
  const active = ACTIVE.includes(order.status);
  return {
    ...commonView(order),
    items: order.items.map((item) => ({
      listingId: item.listingId,
      title: item.title,
      unitPricePaise: item.unitPricePaise,
      quantity: item.quantity,
      // The exact pickup spot, now that they have paid.
      pickup:
        order.fulfilment === 'PICKUP' && item.pickupLat !== null && active
          ? { lat: item.pickupLat, lng: item.pickupLng, locality: item.pickupLocality }
          : null,
    })),
    handoverCode: order.status === 'AWAITING_PICKUP' ? order.handoverCode : null,
    cancellationOffered: order.status === 'AWAITING_DISPATCH' && order.dispatchOverdueAt !== null,
    seller: contact(order.seller, active),
    actions: buyerActions(order, now),
  };
}

export function toSellerOrder(order) {
  const active = ACTIVE.includes(order.status);
  return {
    ...commonView(order),
    items: order.items.map((item) => ({
      listingId: item.listingId,
      title: item.title,
      unitPricePaise: item.unitPricePaise,
      quantity: item.quantity,
    })),
    commissionPaise: order.commissionPaise,
    sellerPayablePaise: order.sellerPayablePaise,
    // Payout-eligible only once complete with no unfinished dispute (I10, I85).
    payoutEligible: order.status === 'COMPLETED' && !hasUnfinishedDispute(order),
    handoverAttemptsLeft:
      order.status === 'AWAITING_PICKUP'
        ? Math.max(0, HANDOVER_MAX_ATTEMPTS - order.handoverAttempts)
        : null,
    buyer: contact(order.buyer, active),
    actions: sellerActions(order),
  };
}

export function toAdminOrder(order, now) {
  return {
    ...toSellerOrder(order),
    buyerView: toBuyerOrder(order, now),
    buyerId: order.buyerId,
    sellerId: order.sellerId,
    handoverAttempts: order.handoverAttempts,
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadOrder(db, id) {
  const order = await db.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) throw AppError.notFound('Order not found');
  return order;
}

export async function loadAs(db, id, { userId, side }) {
  const order = await loadOrder(db, id);
  if (side === 'buyer' && order.buyerId !== userId) throw AppError.notFound('Order not found');
  if (side === 'seller' && order.sellerId !== userId) throw AppError.notFound('Order not found');
  return order;
}

export async function listOrders({ db }, where, query, view) {
  const [rows, total] = await Promise.all([
    db.order.findMany({
      where,
      include: orderInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageWindow(query),
    }),
    db.order.count({ where }),
  ]);
  return paged(rows.map(view), total, query);
}

// ---------------------------------------------------------------------------
// The one way an order changes
// ---------------------------------------------------------------------------

function wrongState(order, verb) {
  return new AppError(
    409,
    'INVALID_ORDER_STATE',
    `This order is ${order.status.toLowerCase().replaceAll('_', ' ')} and cannot be ${verb}`,
  );
}

/**
 * Moves an order from one of `from` to `to` inside `tx`, with `data`, recording the
 * change. Throws when the order is no longer in an allowed state.
 */
async function transition(tx, now, order, { from, to, data = {}, actor, action, reason, verb }) {
  const { count } = await tx.order.updateMany({
    where: { id: order.id, status: { in: from } },
    data: { ...data, ...(to ? { status: to } : {}) },
  });
  if (count !== 1) throw wrongState(order, verb);
  await tx.orderEvent.create({
    data: {
      orderId: order.id,
      actorUserId: actor.userId ?? null,
      actorRole: actor.role,
      action,
      fromStatus: order.status,
      toStatus: to ?? order.status,
      reason: reason ?? null,
      createdAt: now,
    },
  });
}

async function adminAudit(tx, now, { adminId, action, orderId, reason, details }) {
  await tx.adminAuditLog.create({
    data: {
      adminId,
      action,
      targetType: 'order',
      targetId: orderId,
      reason,
      details: details ?? undefined,
      createdAt: now,
    },
  });
}

async function capturedPaymentId(tx, checkoutId) {
  const payment = await tx.payment.findFirst({
    where: { checkoutId, status: 'CAPTURED' },
    orderBy: { capturedAt: 'asc' },
  });
  if (!payment) throw new AppError(409, 'NO_PAYMENT', 'This order has no captured payment');
  return payment.id;
}

async function restock(tx, orderId) {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  for (const item of items) {
    await tx.$executeRaw`UPDATE listings SET quantity = quantity + ${item.quantity} WHERE id = ${item.listingId}::uuid`;
  }
}

/** Refunds whatever of an order is not refunded yet, inside `tx`. */
async function refundRest(tx, now, order, reason, key) {
  const amountPaise = order.totalPaise - order.refundedPaise;
  if (amountPaise <= 0) return null;
  return createRefund(tx, now, {
    key,
    checkoutId: order.checkoutId,
    orderId: order.id,
    paymentId: await capturedPaymentId(tx, order.checkoutId),
    amountPaise,
    itemsAmountPaise: order.itemsSubtotalPaise - order.itemsRefundedPaise,
    reason,
  });
}

async function finish(deps, orderId, refund) {
  if (refund) await processRefund(deps, refund.id);
  return loadOrder(deps.db, orderId);
}

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

const CANCEL_REASONS = { buyer: 'BUYER_CANCELLED', seller: 'SELLER_CANCELLED' };

/** Before dispatch only: the buyer or the seller cancels; the buyer is refunded in full. */
export async function cancelBeforeDispatch(deps, order, side, reason) {
  const { db, clock } = deps;
  const now = clock.now();
  const refund = await db.$transaction(async (tx) => {
    await transition(tx, now, order, {
      from: BEFORE_DISPATCH,
      to: 'CANCELLED',
      data: { cancelledAt: now },
      actor: {
        userId: side === 'buyer' ? order.buyerId : order.sellerId,
        role: side.toUpperCase(),
      },
      action: 'CANCELLED',
      reason,
      verb: 'cancelled',
    });
    // The item never left the seller, so it goes back on sale.
    await restock(tx, order.id);
    return refundRest(tx, now, order, CANCEL_REASONS[side], `order:${order.id}:cancel`);
  });
  const updated = await finish(deps, order.id, refund);
  await notify(deps, updated, side === 'buyer' ? 'seller' : 'buyer', 'cancelled');
  return updated;
}

// ---------------------------------------------------------------------------
// Seller steps
// ---------------------------------------------------------------------------

export async function markDispatched(deps, order, courierReference) {
  const now = deps.clock.now();
  await deps.db.$transaction((tx) =>
    transition(tx, now, order, {
      from: ['AWAITING_DISPATCH'],
      to: 'DISPATCHED',
      data: { dispatchedAt: now, courierReference: courierReference ?? null },
      actor: { userId: order.sellerId, role: 'SELLER' },
      action: 'DISPATCHED',
      verb: 'marked as sent',
    }),
  );
  const updated = await loadOrder(deps.db, order.id);
  await notify(deps, updated, 'buyer', 'dispatchedBuyer');
  return updated;
}

/** The seller says it was delivered. Not proof: the buyer, or an admin, confirms (SPEC 16). */
export async function markDeliveryReported(deps, order) {
  const now = deps.clock.now();
  await deps.db.$transaction((tx) =>
    transition(tx, now, order, {
      from: ['AWAITING_DISPATCH', 'DISPATCHED'],
      to: 'DELIVERY_REPORTED',
      data: {
        dispatchedAt: order.dispatchedAt ?? now,
        deliveryReportedAt: now,
        receiptDueAt: addHours(now, RECEIPT_WINDOW_HOURS),
      },
      actor: { userId: order.sellerId, role: 'SELLER' },
      action: 'DELIVERY_REPORTED',
      verb: 'marked as delivered',
    }),
  );
  const updated = await loadOrder(deps.db, order.id);
  await notify(deps, updated, 'buyer', 'deliveryReportedBuyer');
  return updated;
}

const deliveredData = (now) => ({
  deliveredAt: now,
  issueWindowEndsAt: addDays(now, ISSUE_REPORT_WINDOW_DAYS),
});

/** Pickup: the seller enters the buyer's one-time code; the right code completes delivery. */
export async function completeHandover(deps, order, code) {
  const { db, clock } = deps;
  if (order.status !== 'AWAITING_PICKUP') throw wrongState(order, 'handed over');
  if (order.handoverAttempts >= HANDOVER_MAX_ATTEMPTS) {
    throw new AppError(
      429,
      'HANDOVER_LOCKED',
      'Too many wrong codes. Contact support to unlock it.',
    );
  }
  const right =
    typeof code === 'string' &&
    code.length === order.handoverCode.length &&
    crypto.timingSafeEqual(Buffer.from(code), Buffer.from(order.handoverCode));

  if (!right) {
    // Counted with a conditional update, so parallel guesses cannot exceed the limit.
    const { count } = await db.order.updateMany({
      where: {
        id: order.id,
        status: 'AWAITING_PICKUP',
        handoverAttempts: { lt: HANDOVER_MAX_ATTEMPTS },
      },
      data: { handoverAttempts: { increment: 1 } },
    });
    if (count !== 1)
      throw new AppError(
        429,
        'HANDOVER_LOCKED',
        'Too many wrong codes. Contact support to unlock it.',
      );
    throw new AppError(400, 'WRONG_HANDOVER_CODE', 'That code is not right', {
      attemptsLeft: HANDOVER_MAX_ATTEMPTS - order.handoverAttempts - 1,
    });
  }

  const now = clock.now();
  await db.$transaction((tx) =>
    transition(tx, now, order, {
      from: ['AWAITING_PICKUP'],
      to: 'DELIVERED',
      data: deliveredData(now),
      actor: { userId: order.sellerId, role: 'SELLER' },
      action: 'HANDED_OVER',
      verb: 'handed over',
    }),
  );
  const updated = await loadOrder(db, order.id);
  await notify(deps, updated, 'seller', 'deliveredSeller');
  return updated;
}

export async function requestExtension(deps, order, businessDays) {
  if (order.status !== 'AWAITING_DISPATCH' || order.extensionStatus !== 'NONE') {
    throw new AppError(
      409,
      'EXTENSION_NOT_ALLOWED',
      'An extension can be asked for once, before the order is sent',
    );
  }
  const days = Math.min(businessDays, DISPATCH_EXTENSION_MAX_BUSINESS_DAYS);
  const now = deps.clock.now();
  await deps.db.$transaction((tx) =>
    transition(tx, now, order, {
      from: ['AWAITING_DISPATCH'],
      data: {
        extensionStatus: 'REQUESTED',
        extensionUntil: addBusinessDays(order.dispatchDueAt, days),
      },
      actor: { userId: order.sellerId, role: 'SELLER' },
      action: 'EXTENSION_REQUESTED',
      verb: 'extended',
    }),
  );
  const updated = await loadOrder(deps.db, order.id);
  await notify(deps, updated, 'buyer', 'extensionRequestedBuyer');
  return updated;
}

// ---------------------------------------------------------------------------
// Buyer steps
// ---------------------------------------------------------------------------

export async function answerExtension(deps, order, accept) {
  if (order.status !== 'AWAITING_DISPATCH' || order.extensionStatus !== 'REQUESTED') {
    throw new AppError(409, 'NO_EXTENSION_REQUEST', 'There is no extension request to answer');
  }
  const now = deps.clock.now();
  await deps.db.$transaction((tx) =>
    transition(tx, now, order, {
      from: ['AWAITING_DISPATCH'],
      data: accept
        ? {
            extensionStatus: 'ACCEPTED',
            dispatchDueAt: order.extensionUntil,
            dispatchOverdueAt: null,
            dispatchWarnedAt: null,
          }
        : { extensionStatus: 'DECLINED' },
      actor: { userId: order.buyerId, role: 'BUYER' },
      action: accept ? 'EXTENSION_ACCEPTED' : 'EXTENSION_DECLINED',
      verb: 'extended',
    }),
  );
  return loadOrder(deps.db, order.id);
}

export async function confirmReceipt(deps, order) {
  const now = deps.clock.now();
  await deps.db.$transaction((tx) =>
    transition(tx, now, order, {
      from: ['DELIVERY_REPORTED'],
      to: 'DELIVERED',
      data: deliveredData(now),
      actor: { userId: order.buyerId, role: 'BUYER' },
      action: 'RECEIPT_CONFIRMED',
      verb: 'confirmed',
    }),
  );
  const updated = await loadOrder(deps.db, order.id);
  await notify(deps, updated, 'seller', 'deliveredSeller');
  return updated;
}

/** The buyer says it never arrived: the order goes to review and a dispute opens (I79). */
export async function reportNotReceived(deps, order, reason) {
  const now = deps.clock.now();
  await deps.db.$transaction(async (tx) => {
    await transition(tx, now, order, {
      from: ['DELIVERY_REPORTED'],
      to: 'ADMIN_REVIEW',
      actor: { userId: order.buyerId, role: 'BUYER' },
      action: 'NOT_RECEIVED',
      reason,
      verb: 'reported',
    });
    await openDispute(tx, now, {
      kind: 'NOT_DELIVERED',
      orderId: order.id,
      claimantId: order.buyerId,
      respondentId: order.sellerId,
      description: reason || 'The buyer says the order did not arrive.',
      evidence: { authorId: order.buyerId, text: reason || null },
    });
  });
  await announceOpened(deps, { orderId: order.id, kind: 'NOT_DELIVERED' });
  const updated = await loadOrder(deps.db, order.id);
  await notify(deps, updated, 'seller', 'sentToReview');
  return updated;
}

/** Within 7 days of delivery: wrong, damaged or not as described, with photos. */
export async function reportIssue(deps, order, { kind, description }, files) {
  const { db, clock } = deps;
  const now = clock.now();
  if (order.status !== 'DELIVERED') throw wrongState(order, 'reported');
  if (saleIssue(order)) {
    throw new AppError(
      409,
      'ISSUE_ALREADY_REPORTED',
      'A problem was already reported for this order',
    );
  }
  if (order.issueWindowEndsAt <= now) {
    throw new AppError(
      409,
      'ISSUE_WINDOW_CLOSED',
      'Problems can be reported up to 7 days after delivery',
    );
  }
  const images = readImages(files);
  if (images.length < ISSUE_PHOTOS_MIN || images.length > ISSUE_PHOTOS_MAX) {
    throw new AppError(
      400,
      'ISSUE_PHOTOS',
      `Add between ${ISSUE_PHOTOS_MIN} and ${ISSUE_PHOTOS_MAX} photos of the problem`,
    );
  }

  const stored = await storeImages(deps, images, 'disputes');
  try {
    await db.$transaction(async (tx) => {
      await transition(tx, now, order, {
        from: ['DELIVERED'],
        to: 'ISSUE_OPEN',
        actor: { userId: order.buyerId, role: 'BUYER' },
        action: 'ISSUE_REPORTED',
        reason: description,
        verb: 'reported',
      });
      await openDispute(tx, now, {
        kind: 'SALE_ISSUE',
        orderId: order.id,
        claimantId: order.buyerId,
        respondentId: order.sellerId,
        category: kind,
        description,
        evidence: {
          authorId: order.buyerId,
          text: description,
          photos: evidencePhotos(stored, now),
        },
      });
    });
  } catch (error) {
    await discardStored(deps, stored);
    throw error;
  }
  await announceOpened(deps, { orderId: order.id, kind: 'SALE_ISSUE' });
  const updated = await loadOrder(db, order.id);
  await notify(deps, updated, 'seller', 'issueOpenedSeller');
  return updated;
}

// ---------------------------------------------------------------------------
// Effects of dispute outcomes (called by the dispute module, which audits them)
// ---------------------------------------------------------------------------

/** Delivery is confirmed by an admin decision or the buyer's own word. */
export async function confirmDelivery(deps, order, actor, reason, from = ['ADMIN_REVIEW']) {
  const now = deps.clock.now();
  await deps.db.$transaction((tx) =>
    transition(tx, now, order, {
      from,
      to: 'DELIVERED',
      data: deliveredData(now),
      actor,
      action: 'DELIVERY_VERIFIED',
      reason,
      verb: 'confirmed as delivered',
    }),
  );
  const updated = await loadOrder(deps.db, order.id);
  await notify(deps, updated, 'seller', 'deliveredSeller');
  return updated;
}

/** Lost in transit: cancelled with a full refund; the item is not back on sale (SPEC 14). */
export async function cancelUndelivered(deps, order, actor, reason) {
  const now = deps.clock.now();
  const refund = await deps.db.$transaction(async (tx) => {
    await transition(tx, now, order, {
      from: ['ADMIN_REVIEW'],
      to: 'CANCELLED',
      data: { cancelledAt: now },
      actor,
      action: 'CANCELLED',
      reason,
      verb: 'cancelled',
    });
    return refundRest(tx, now, order, 'NOT_DELIVERED', `order:${order.id}:cancel`);
  });
  const updated = await finish(deps, order.id, refund);
  await notify(deps, updated, 'buyer', 'cancelled');
  await notify(deps, updated, 'seller', 'cancelled');
  return updated;
}

/** Settles a sale issue: full refund, partial refund (items only) or none (I52). */
export async function resolveIssue(deps, order, { resolution, refundPaise }, actor, reason) {
  const now = deps.clock.now();
  const windowOver = order.issueWindowEndsAt <= now;
  const next = resolution === 'FULL_REFUND' ? 'REFUNDED' : windowOver ? 'COMPLETED' : 'DELIVERED';
  const refund = await deps.db.$transaction(async (tx) => {
    await transition(tx, now, order, {
      from: ['ISSUE_OPEN'],
      to: next,
      data: next === 'COMPLETED' ? { completedAt: now } : {},
      actor,
      action: `ISSUE_${resolution}`,
      reason,
      verb: 'resolved',
    });
    if (resolution === 'FULL_REFUND')
      return refundRest(tx, now, order, 'ISSUE_FULL', `order:${order.id}:issue`);
    if (resolution === 'PARTIAL_REFUND') {
      return createRefund(tx, now, {
        key: `order:${order.id}:issue`,
        checkoutId: order.checkoutId,
        orderId: order.id,
        paymentId: await capturedPaymentId(tx, order.checkoutId),
        amountPaise: refundPaise,
        itemsAmountPaise: refundPaise,
        reason: 'ISSUE_PARTIAL',
      });
    }
    return null;
  });
  return finish(deps, order.id, refund);
}

/** The largest partial refund allowed for an order's issue (less than what is left). */
export const partialRefundLimit = (order) =>
  order.itemsSubtotalPaise - order.itemsRefundedPaise - 1;

// ---------------------------------------------------------------------------
// Admin steps: each needs a reason and is written to the admin audit log
// ---------------------------------------------------------------------------

/** The seller said delivered and the buyer has not answered yet: an admin confirms it. */
export async function adminVerifyDelivery(deps, order, adminId, reason) {
  const now = deps.clock.now();
  const updated = await confirmDelivery(deps, order, { userId: adminId, role: 'ADMIN' }, reason, [
    'DELIVERY_REPORTED',
  ]);
  await deps.db.$transaction((tx) =>
    adminAudit(tx, now, { adminId, action: 'VERIFY_DELIVERY', orderId: order.id, reason }),
  );
  return updated;
}

/** Cancels an order that cannot go ahead, with a full refund. Disputes are decided instead. */
export async function adminCancel(deps, order, adminId, reason) {
  const now = deps.clock.now();
  if (await unfinishedDispute(deps.db, { orderId: order.id })) {
    throw new AppError(
      409,
      'DISPUTE_OPEN',
      'This order has an open dispute; decide the dispute instead',
    );
  }
  const beforeDispatch = BEFORE_DISPATCH.includes(order.status);
  const refund = await deps.db.$transaction(async (tx) => {
    await transition(tx, now, order, {
      from: [...BEFORE_DISPATCH, 'DISPATCHED', 'DELIVERY_REPORTED'],
      to: 'CANCELLED',
      data: { cancelledAt: now },
      actor: { userId: adminId, role: 'ADMIN' },
      action: 'CANCELLED',
      reason,
      verb: 'cancelled',
    });
    await adminAudit(tx, now, { adminId, action: 'CANCEL_ORDER', orderId: order.id, reason });
    // Lost in transit: the seller bears it and the item is not back on sale (SPEC 14).
    if (beforeDispatch) await restock(tx, order.id);
    return refundRest(
      tx,
      now,
      order,
      beforeDispatch ? 'ADMIN_CANCELLED' : 'NOT_DELIVERED',
      `order:${order.id}:cancel`,
    );
  });
  const updated = await finish(deps, order.id, refund);
  await notify(deps, updated, 'buyer', 'cancelled');
  await notify(deps, updated, 'seller', 'cancelled');
  return updated;
}

/** A withdrawn sale issue: the order is received again (or complete, if the window has passed). */
export async function restoreAfterIssue(deps, order, actor) {
  const now = deps.clock.now();
  const windowOver = order.issueWindowEndsAt <= now;
  await deps.db.$transaction((tx) =>
    transition(tx, now, order, {
      from: ['ISSUE_OPEN'],
      to: windowOver ? 'COMPLETED' : 'DELIVERED',
      data: windowOver ? { completedAt: now } : {},
      actor,
      action: 'ISSUE_WITHDRAWN',
      verb: 'restored',
    }),
  );
  return loadOrder(deps.db, order.id);
}

export async function adminResetHandover(deps, order, adminId, reason) {
  const now = deps.clock.now();
  const code = String(crypto.randomInt(0, 10 ** 6)).padStart(6, '0');
  await deps.db.$transaction(async (tx) => {
    await transition(tx, now, order, {
      from: ['AWAITING_PICKUP'],
      data: { handoverCode: code, handoverAttempts: 0 },
      actor: { userId: adminId, role: 'ADMIN' },
      action: 'HANDOVER_CODE_RESET',
      reason,
      verb: 'reset',
    });
    await adminAudit(tx, now, {
      adminId,
      action: 'RESET_HANDOVER_CODE',
      orderId: order.id,
      reason,
    });
  });
  return loadOrder(deps.db, order.id);
}
