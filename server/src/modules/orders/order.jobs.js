import { DISPATCH_WARNING_HOURS } from '../../config/policy.js';
import { addHours } from '../../lib/clock.js';
import { expireCheckouts } from '../checkout/checkout.service.js';
import { retryRefunds } from '../payments/refunds.service.js';
import { notify } from './order.emails.js';
import { loadOrder } from './order.service.js';

// Order deadlines, run on a schedule. Each step changes an order only if it is still
// in the state the deadline belongs to and the deadline has passed, so running it
// late or twice changes nothing more. Every step notifies the people involved, and
// each has an admin path (see order.service.js).

async function eachDue(deps, where, step) {
  const due = await deps.db.order.findMany({ where, select: { id: true } });
  let done = 0;
  for (const { id } of due) if (await step(id)) done += 1;
  return done;
}

/** A day before the dispatch deadline: remind the seller. */
function remindDispatch(deps, now) {
  return eachDue(
    deps,
    {
      status: 'AWAITING_DISPATCH',
      dispatchWarnedAt: null,
      dispatchDueAt: { lte: addHours(now, DISPATCH_WARNING_HOURS), gt: now },
    },
    async (id) => {
      const { count } = await deps.db.order.updateMany({
        where: { id, status: 'AWAITING_DISPATCH', dispatchWarnedAt: null },
        data: { dispatchWarnedAt: now },
      });
      if (count === 1)
        await notify(deps, await loadOrder(deps.db, id), 'seller', 'dispatchReminderSeller');
      return count === 1;
    },
  );
}

/** Deadline missed (I11): the buyer is offered cancellation. Nothing is cancelled automatically. */
function flagOverdueDispatch(deps, now) {
  return eachDue(
    deps,
    { status: 'AWAITING_DISPATCH', dispatchOverdueAt: null, dispatchDueAt: { lte: now } },
    async (id) => {
      const { count } = await deps.db.order.updateMany({
        where: {
          id,
          status: 'AWAITING_DISPATCH',
          dispatchOverdueAt: null,
          dispatchDueAt: { lte: now },
        },
        data: { dispatchOverdueAt: now },
      });
      if (count === 1) {
        const order = await loadOrder(deps.db, id);
        await notify(deps, order, 'buyer', 'dispatchOverdueBuyer');
        await notify(deps, order, 'seller', 'dispatchOverdueSeller');
      }
      return count === 1;
    },
  );
}

/** 48 hours after the seller reported delivery without an answer: admin review, never completion. */
function sendUnconfirmedToReview(deps, now) {
  return eachDue(deps, { status: 'DELIVERY_REPORTED', receiptDueAt: { lte: now } }, async (id) => {
    const moved = await deps.db.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id, status: 'DELIVERY_REPORTED', receiptDueAt: { lte: now } },
        data: { status: 'ADMIN_REVIEW' },
      });
      if (count === 1) {
        await tx.orderEvent.create({
          data: {
            orderId: id,
            actorRole: 'SYSTEM',
            action: 'RECEIPT_WINDOW_ENDED',
            fromStatus: 'DELIVERY_REPORTED',
            toStatus: 'ADMIN_REVIEW',
            createdAt: now,
          },
        });
      }
      return count === 1;
    });
    if (moved) {
      const order = await loadOrder(deps.db, id);
      await notify(deps, order, 'buyer', 'sentToReview');
      await notify(deps, order, 'seller', 'sentToReview');
    }
    return moved;
  });
}

/** 7 days after delivery with no open issue: complete and payout-eligible (I10). */
function completeDelivered(deps, now) {
  return eachDue(deps, { status: 'DELIVERED', issueWindowEndsAt: { lte: now } }, async (id) => {
    const moved = await deps.db.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id, status: 'DELIVERED', issueWindowEndsAt: { lte: now } },
        data: { status: 'COMPLETED', completedAt: now },
      });
      if (count === 1) {
        await tx.orderEvent.create({
          data: {
            orderId: id,
            actorRole: 'SYSTEM',
            action: 'ISSUE_WINDOW_ENDED',
            fromStatus: 'DELIVERED',
            toStatus: 'COMPLETED',
            createdAt: now,
          },
        });
      }
      return count === 1;
    });
    if (moved) await notify(deps, await loadOrder(deps.db, id), 'seller', 'completedSeller');
    return moved;
  });
}

/** Every order deadline, in one pass. Returns how many of each were handled. */
export async function runOrderJobs(deps) {
  const now = deps.clock.now();
  return {
    expiredCheckouts: await expireCheckouts(deps),
    dispatchReminders: await remindDispatch(deps, now),
    overdueDispatch: await flagOverdueDispatch(deps, now),
    sentToReview: await sendUnconfirmedToReview(deps, now),
    completed: await completeDelivered(deps, now),
    refundsRetried: await retryRefunds(deps),
  };
}
