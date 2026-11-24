import { Prisma } from '@prisma/client';
import {
  BUSINESS_TIME_ZONE,
  PAYOUT_BATCH_HOUR,
  PAYOUT_BATCH_WEEKDAY,
  PAYOUT_PROCESSING_BUSINESS_DAYS,
} from '../../config/policy.js';
import {
  addBusinessDays,
  addCalendarDays,
  atBusinessTime,
  businessDate,
  businessWeekday,
} from '../../lib/clock.js';
import { rupees } from '../../lib/csv.js';
import { AppError } from '../../lib/errors.js';
import { recordLedger } from '../../lib/ledger.js';
import { UNFINISHED } from '../disputes/dispute.records.js';
import { deliver } from '../notifications/notifications.service.js';
import { formatPaise } from '../orders/order.format.js';
import { registerDeletionBlocker } from '../users/deletion.service.js';
import { writeAudit } from '../admin/admin.query.js';
import { accountNumberOf, masked, requireNewCheck } from './bank.service.js';

// Seller payouts (SPEC 12 and 16; DECISIONS I10, I55, I67, I85, I106 to I109).
//
// Once a week a batch gathers every payout-eligible transaction: a COMPLETED order
// or rental, with no unfinished dispute, not paid before, whose seller is active and
// has verified bank details, and whose net payable in the ledger is above zero. The
// admin sends the transfers by hand, then records each one as paid (with the bank's
// reference) or failed. A paid item writes SELLER_PAYOUT ledger rows; a failed one
// asks the seller to check their details, and can be retried once an admin has
// verified them again, under a new reference.

const UNFINISHED_SQL = Prisma.join(UNFINISHED.map((s) => Prisma.sql`${s}::"DisputeStatus"`));

/**
 * Every completed, not yet paid transaction with something owed to the seller, and
 * why it is held, if it is. `sellerId` narrows it to one seller. `client` may be a
 * transaction client.
 */
export async function unpaidTransactions(client, { sellerId } = {}) {
  const forSeller = sellerId ? Prisma.sql`AND t.seller_id = ${sellerId}::uuid` : Prisma.empty;
  const rows = await client.$queryRaw`
    WITH payable AS (
      SELECT order_id, booking_id,
        sum(CASE type WHEN 'SELLER_PAYABLE' THEN amount_paise ELSE -amount_paise END)::int AS net
      FROM ledger_entries
      WHERE type IN ('SELLER_PAYABLE', 'SELLER_PAYABLE_REVERSAL')
      GROUP BY order_id, booking_id
    ),
    t AS (
      SELECT 'order' AS kind, o.id, o.ref, o.seller_id, o.completed_at, p.net AS amount,
        EXISTS (SELECT 1 FROM disputes d WHERE d.order_id = o.id AND d.status IN (${UNFINISHED_SQL})) AS disputed
      FROM orders o
      JOIN payable p ON p.order_id = o.id
      WHERE o.status = 'COMPLETED'
        AND NOT EXISTS (SELECT 1 FROM payout_lines pl WHERE pl.order_id = o.id)
      UNION ALL
      SELECT 'booking', b.id, b.ref, b.owner_id, b.completed_at, p.net,
        EXISTS (SELECT 1 FROM disputes d WHERE d.booking_id = b.id AND d.status IN (${UNFINISHED_SQL}))
      FROM rental_bookings b
      JOIN payable p ON p.booking_id = b.id
      WHERE b.status = 'COMPLETED'
        AND NOT EXISTS (SELECT 1 FROM payout_lines pl WHERE pl.booking_id = b.id)
    )
    SELECT t.kind, t.id, t.ref, t.seller_id AS "sellerId", t.completed_at AS "completedAt",
      t.amount, u.email AS "sellerEmail",
      CASE
        WHEN t.disputed THEN 'DISPUTE_OPEN'
        WHEN u.status <> 'ACTIVE' THEN 'SELLER_NOT_ACTIVE'
        WHEN ba.status IS NULL THEN 'NO_BANK_ACCOUNT'
        WHEN ba.status <> 'VERIFIED' THEN 'BANK_NOT_VERIFIED'
      END AS hold
    FROM t
    JOIN users u ON u.id = t.seller_id
    LEFT JOIN seller_bank_accounts ba ON ba.user_id = t.seller_id
    WHERE t.amount > 0 ${forSeller}
    ORDER BY t.completed_at, t.id`;
  return rows.map((row) => ({
    ...row,
    completedAt: row.completedAt.toISOString(),
  }));
}

/** The next batch's contents and what is held back, with totals (admin preview). */
export async function payoutPreview({ db }) {
  const rows = await unpaidTransactions(db);
  const eligible = rows.filter((r) => !r.hold);
  const held = rows.filter((r) => r.hold);
  const sum = (list) => list.reduce((total, r) => total + r.amount, 0);
  return {
    eligible,
    held,
    totals: {
      eligiblePaise: sum(eligible),
      eligibleSellers: new Set(eligible.map((r) => r.sellerId)).size,
      heldPaise: sum(held),
    },
  };
}

// ---------------------------------------------------------------------------
// Building a batch
// ---------------------------------------------------------------------------

async function nextBatchRef(tx, now) {
  const day = businessDate(now).replaceAll('-', '');
  const sameDay = await tx.payoutBatch.count({ where: { ref: { startsWith: `PB-${day}` } } });
  return `PB-${day}-${sameDay + 1}`;
}

/**
 * Builds a batch from everything eligible now. `adminId` is null when the weekly
 * job builds it. Returns null when there is nothing to pay, and refuses while
 * another batch is still open.
 */
export async function buildBatch(deps, adminId) {
  const { db, clock } = deps;
  const now = clock.now();
  const batch = await db.$transaction(async (tx) => {
    // One builder at a time; the database also allows only one open batch.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payout-batch'))`;
    if (await tx.payoutBatch.findFirst({ where: { status: 'OPEN' } })) {
      throw new AppError(409, 'BATCH_OPEN', 'Finish the open payout batch first');
    }
    const eligible = (await unpaidTransactions(tx)).filter((r) => !r.hold);
    if (eligible.length === 0) return null;

    const bySeller = new Map();
    for (const row of eligible) {
      if (!bySeller.has(row.sellerId)) bySeller.set(row.sellerId, []);
      bySeller.get(row.sellerId).push(row);
    }
    const accounts = await tx.sellerBankAccount.findMany({
      where: { userId: { in: [...bySeller.keys()] }, status: 'VERIFIED' },
    });
    const accountOf = new Map(accounts.map((a) => [a.userId, a]));

    const ref = await nextBatchRef(tx, now);
    const totalPaise = eligible.reduce((total, r) => total + r.amount, 0);
    const created = await tx.payoutBatch.create({
      data: {
        ref,
        createdById: adminId,
        totalPaise,
        createdAt: now,
        dueAt: addBusinessDays(now, PAYOUT_PROCESSING_BUSINESS_DAYS),
      },
    });
    let seq = 0;
    for (const [sellerId, lines] of bySeller) {
      seq += 1;
      const account = accountOf.get(sellerId);
      const itemRef = `${ref}-${String(seq).padStart(3, '0')}`;
      await tx.payoutItem.create({
        data: {
          ref: itemRef,
          batchId: created.id,
          sellerId,
          amountPaise: lines.reduce((total, r) => total + r.amount, 0),
          createdAt: now,
          lines: {
            create: lines.map((r) => ({
              orderId: r.kind === 'order' ? r.id : null,
              bookingId: r.kind === 'booking' ? r.id : null,
              amountPaise: r.amount,
            })),
          },
          attempts: {
            create: {
              reference: itemRef,
              holderName: account.holderName,
              accountLast4: account.accountLast4,
              ifsc: account.ifsc,
              createdAt: now,
            },
          },
        },
      });
    }
    if (adminId) {
      await writeAudit(tx, now, {
        adminId,
        action: 'BUILD_PAYOUT_BATCH',
        targetType: 'payoutBatch',
        targetId: created.id,
        reason: 'Built a payout batch',
        details: { ref, totalPaise, sellers: bySeller.size },
      });
    }
    return created;
  });
  if (batch) {
    await notifyAdmins(deps, {
      key: `payoutBatch:${batch.id}:built`,
      type: 'payoutBatchBuilt',
      title: `Payout batch ${batch.ref} is ready`,
      body: `${rupeeText(batch.totalPaise)} to send by ${dateText(batch.dueAt)}. Download the bank file, make the transfers, then record each one.`,
      link: `/admin/payouts/${batch.id}`,
    });
  }
  return batch;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const itemInclude = {
  seller: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
  lines: {
    include: {
      order: { select: { ref: true } },
      booking: { select: { ref: true } },
    },
  },
  attempts: { orderBy: { createdAt: 'asc' } },
  batch: { select: { id: true, ref: true } },
};

function toAttempt(a) {
  return {
    reference: a.reference,
    status: a.status,
    holderName: a.holderName,
    accountNumber: masked(a.accountLast4),
    ifsc: a.ifsc,
    bankReference: a.bankReference,
    failureReason: a.failureReason,
    createdAt: a.createdAt.toISOString(),
    finishedAt: a.finishedAt?.toISOString() ?? null,
  };
}

export function toPayoutItem(item) {
  return {
    id: item.id,
    ref: item.ref,
    batch: item.batch,
    status: item.status,
    amountPaise: item.amountPaise,
    seller: {
      id: item.seller.id,
      email: item.seller.email,
      displayName: item.seller.profile?.displayName ?? null,
    },
    lines: item.lines.map((l) => ({
      kind: l.orderId ? 'order' : 'booking',
      id: l.orderId ?? l.bookingId,
      ref: l.order?.ref ?? l.booking?.ref,
      amountPaise: l.amountPaise,
    })),
    attempts: item.attempts.map(toAttempt),
    createdAt: item.createdAt.toISOString(),
    paidAt: item.paidAt?.toISOString() ?? null,
    failedAt: item.failedAt?.toISOString() ?? null,
  };
}

/** A seller's own view of a payout: no other seller, no full number. */
export function toOwnPayout(item) {
  const view = toPayoutItem(item);
  delete view.seller;
  return view;
}

export function toBatch(batch, now) {
  const counts = { PENDING: 0, PAID: 0, FAILED: 0 };
  for (const item of batch.items ?? []) counts[item.status] += 1;
  return {
    id: batch.id,
    ref: batch.ref,
    status: batch.status,
    totalPaise: batch.totalPaise,
    builtBy: batch.createdBy?.email ?? 'weekly job',
    createdAt: batch.createdAt.toISOString(),
    dueAt: batch.dueAt.toISOString(),
    overdue: batch.status === 'OPEN' && batch.dueAt <= now,
    closedAt: batch.closedAt?.toISOString() ?? null,
    counts,
  };
}

export const batchInclude = {
  createdBy: { select: { email: true } },
  items: { select: { status: true } },
};

export async function batchDetail({ db, clock }, id) {
  const batch = await db.payoutBatch.findUnique({ where: { id }, include: batchInclude });
  if (!batch) throw AppError.notFound('Payout batch not found');
  const items = await db.payoutItem.findMany({
    where: { batchId: id },
    include: itemInclude,
    orderBy: { ref: 'asc' },
  });
  return { batch: toBatch(batch, clock.now()), items: items.map(toPayoutItem) };
}

export async function loadItem(db, id) {
  const item = await db.payoutItem.findUnique({ where: { id }, include: itemInclude });
  if (!item) throw AppError.notFound('Payout not found');
  return item;
}

// ---------------------------------------------------------------------------
// The bank file
// ---------------------------------------------------------------------------

/**
 * The transfers still to make in a batch, with full account numbers, for the bank
 * (I105). Only the account an admin verified is used; a seller whose details
 * changed after the batch was built is listed without a number until checked.
 * Every download is audit logged.
 */
export async function bankFile({ db, clock }, adminId, batchId) {
  const batch = await db.payoutBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw AppError.notFound('Payout batch not found');
  const items = await db.payoutItem.findMany({
    where: { batchId, status: 'PENDING' },
    include: {
      seller: { select: { email: true, bankAccount: true } },
      attempts: { where: { status: 'PENDING' } },
    },
    orderBy: { ref: 'asc' },
  });
  const now = clock.now();
  const rows = [];
  await db.$transaction(async (tx) => {
    for (const item of items) {
      const account = item.seller.bankAccount;
      const attempt = item.attempts[0];
      const usable = account?.status === 'VERIFIED';
      if (usable && attempt) {
        // The attempt records which (masked) account the transfer goes to.
        await tx.payoutAttempt.update({
          where: { id: attempt.id },
          data: {
            holderName: account.holderName,
            accountLast4: account.accountLast4,
            ifsc: account.ifsc,
          },
        });
      }
      rows.push({
        reference: attempt?.reference,
        amountPaise: item.amountPaise,
        holderName: usable ? account.holderName : '',
        accountNumber: usable ? accountNumberOf(account) : '',
        ifsc: usable ? account.ifsc : '',
        email: item.seller.email,
        note: usable ? '' : 'Bank details changed: wait for a check before paying',
      });
    }
    await writeAudit(tx, now, {
      adminId,
      action: 'DOWNLOAD_PAYOUT_BANK_FILE',
      targetType: 'payoutBatch',
      targetId: batchId,
      reason: 'Bank file downloaded to make the transfers',
      details: { items: rows.length },
    });
  });
  return { ref: batch.ref, rows };
}

export const bankFileColumns = [
  ['payout reference', (r) => r.reference],
  ['amount (rupees)', (r) => rupees(r.amountPaise)],
  ['account holder', (r) => r.holderName],
  ['account number', (r) => r.accountNumber],
  ['ifsc', (r) => r.ifsc],
  ['seller email', (r) => r.email],
  ['note', (r) => r.note],
];

// ---------------------------------------------------------------------------
// Recording the outcome
// ---------------------------------------------------------------------------

async function closeIfDone(tx, now, batchId) {
  const pending = await tx.payoutItem.count({ where: { batchId, status: 'PENDING' } });
  if (pending === 0) {
    await tx.payoutBatch.updateMany({
      where: { id: batchId, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: now },
    });
  }
}

const notPending = () =>
  new AppError(409, 'PAYOUT_NOT_PENDING', 'This payout is not waiting to be recorded');

/** Records a transfer as made. Writes the payout ledger rows once (I106). */
export async function markPaid(deps, adminId, itemId, { bankReference }) {
  const { db, clock } = deps;
  const now = clock.now();
  const item = await db.$transaction(async (tx) => {
    const { count } = await tx.payoutItem.updateMany({
      where: { id: itemId, status: 'PENDING' },
      data: { status: 'PAID', paidAt: now },
    });
    if (count !== 1) {
      if (!(await tx.payoutItem.findUnique({ where: { id: itemId } }))) {
        throw AppError.notFound('Payout not found');
      }
      throw notPending();
    }
    const paid = await tx.payoutItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { lines: true },
    });
    await tx.payoutAttempt.updateMany({
      where: { itemId, status: 'PENDING' },
      data: { status: 'PAID', bankReference, finishedAt: now, recordedById: adminId },
    });
    await recordLedger(
      tx,
      now,
      paid.lines.map((line) => ({
        key: `payout-line:${line.id}`,
        type: 'SELLER_PAYOUT',
        amountPaise: line.amountPaise,
        orderId: line.orderId,
        bookingId: line.bookingId,
        sellerId: paid.sellerId,
      })),
    );
    await writeAudit(tx, now, {
      adminId,
      action: 'MARK_PAYOUT_PAID',
      targetType: 'payoutItem',
      targetId: itemId,
      reason: `Transfer made, bank reference ${bankReference}`,
      details: { amountPaise: paid.amountPaise, bankReference },
    });
    await closeIfDone(tx, now, paid.batchId);
    return paid;
  });
  await deliver(deps, {
    userId: item.sellerId,
    key: `payout:${item.id}:paid`,
    category: 'PAYMENTS',
    type: 'payoutPaid',
    title: `Payout sent: ${rupeeText(item.amountPaise)}`,
    body: `We sent ${rupeeText(item.amountPaise)} to your bank account (reference ${bankReference}). It can take a little while to show up.`,
    link: '/dashboard',
  });
  return toPayoutItem(await loadItem(db, itemId));
}

/**
 * Records a transfer as failed (SPEC 12): the seller is told, and their bank
 * details need a new check before the payout can be tried again.
 */
export async function markFailed(deps, adminId, itemId, { reason }) {
  const { db, clock } = deps;
  const now = clock.now();
  const item = await db.$transaction(async (tx) => {
    const { count } = await tx.payoutItem.updateMany({
      where: { id: itemId, status: 'PENDING' },
      data: { status: 'FAILED', failedAt: now },
    });
    if (count !== 1) {
      if (!(await tx.payoutItem.findUnique({ where: { id: itemId } }))) {
        throw AppError.notFound('Payout not found');
      }
      throw notPending();
    }
    const failed = await tx.payoutItem.findUniqueOrThrow({ where: { id: itemId } });
    await tx.payoutAttempt.updateMany({
      where: { itemId, status: 'PENDING' },
      data: { status: 'FAILED', failureReason: reason, finishedAt: now, recordedById: adminId },
    });
    await requireNewCheck(tx, failed.sellerId, `A payout to this account failed: ${reason}`);
    await writeAudit(tx, now, {
      adminId,
      action: 'MARK_PAYOUT_FAILED',
      targetType: 'payoutItem',
      targetId: itemId,
      reason,
      details: { amountPaise: failed.amountPaise },
    });
    await closeIfDone(tx, now, failed.batchId);
    return failed;
  });
  await deliver(deps, {
    userId: item.sellerId,
    key: `payout:${item.id}:failed:${now.getTime()}`,
    category: 'PAYMENTS',
    type: 'payoutFailed',
    title: 'A payout did not go through',
    body: `We could not send ${rupeeText(item.amountPaise)} to your bank account: ${reason} Check your bank details; we will try again once they are verified.`,
    link: '/dashboard',
  });
  return toPayoutItem(await loadItem(db, itemId));
}

/**
 * Tries a failed payout again under a new reference. Allowed only once an admin
 * has verified the seller's bank details after the failure.
 */
export async function retryPayout(deps, adminId, itemId, { reason }) {
  const { db, clock } = deps;
  const now = clock.now();
  await db.$transaction(async (tx) => {
    const item = await tx.payoutItem.findUnique({
      where: { id: itemId },
      include: { attempts: true },
    });
    if (!item) throw AppError.notFound('Payout not found');
    if (item.status !== 'FAILED') {
      throw new AppError(409, 'PAYOUT_NOT_FAILED', 'Only a failed payout can be tried again');
    }
    const account = await tx.sellerBankAccount.findUnique({ where: { userId: item.sellerId } });
    if (account?.status !== 'VERIFIED' || !(account.verifiedAt > item.failedAt)) {
      throw new AppError(
        409,
        'BANK_NOT_REVERIFIED',
        'Verify the seller’s bank details again before trying this payout again',
      );
    }
    const seller = await tx.user.findUnique({ where: { id: item.sellerId } });
    if (seller.status !== 'ACTIVE') {
      throw new AppError(409, 'SELLER_NOT_ACTIVE', 'This seller’s account is not active');
    }
    const { count } = await tx.payoutItem.updateMany({
      where: { id: itemId, status: 'FAILED' },
      data: { status: 'PENDING', failedAt: null },
    });
    if (count !== 1)
      throw new AppError(409, 'PAYOUT_NOT_FAILED', 'Only a failed payout can be tried again');
    const reference = `${item.ref}-R${item.attempts.length}`;
    await tx.payoutAttempt.create({
      data: {
        itemId,
        reference,
        holderName: account.holderName,
        accountLast4: account.accountLast4,
        ifsc: account.ifsc,
        createdAt: now,
      },
    });
    await writeAudit(tx, now, {
      adminId,
      action: 'RETRY_PAYOUT',
      targetType: 'payoutItem',
      targetId: itemId,
      reason,
      details: { reference },
    });
  });
  return toPayoutItem(await loadItem(db, itemId));
}

// ---------------------------------------------------------------------------
// Seller view
// ---------------------------------------------------------------------------

export async function sellerPayouts({ db }, sellerId) {
  const [items, unpaid] = await Promise.all([
    db.payoutItem.findMany({
      where: { sellerId },
      include: itemInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    unpaidTransactions(db, { sellerId }),
  ]);
  const paidPaise = items.filter((i) => i.status === 'PAID').reduce((t, i) => t + i.amountPaise, 0);
  const inProgressPaise = items
    .filter((i) => i.status !== 'PAID')
    .reduce((t, i) => t + i.amountPaise, 0);
  return {
    payouts: items.map(toOwnPayout),
    upcoming: unpaid.map(({ kind, id, ref, amount, completedAt, hold }) => ({
      kind,
      id,
      ref,
      amountPaise: amount,
      completedAt,
      hold,
    })),
    totals: {
      paidPaise,
      inProgressPaise,
      upcomingPaise: unpaid.reduce((t, r) => t + r.amount, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Scheduled work
// ---------------------------------------------------------------------------

/** The weekly build time on or before `now`: Monday 10:00 in the business time zone. */
export function weeklyBuildTime(now) {
  const today = businessDate(now);
  const back = (businessWeekday(now) - PAYOUT_BATCH_WEEKDAY + 7) % 7;
  const thisWeek = atBusinessTime(addCalendarDays(today, -back), PAYOUT_BATCH_HOUR);
  return thisWeek <= now
    ? thisWeek
    : atBusinessTime(addCalendarDays(today, -back - 7), PAYOUT_BATCH_HOUR);
}

/**
 * Builds the weekly batch once its time has come (if none was built since, and none
 * is open), and tells the admins about a batch past its 3-business-day target.
 */
export async function runPayoutJobs(deps) {
  const { db, clock } = deps;
  const now = clock.now();
  let built = null;
  const since = weeklyBuildTime(now);
  const [open, recent] = await Promise.all([
    db.payoutBatch.findFirst({ where: { status: 'OPEN' } }),
    db.payoutBatch.findFirst({ where: { createdAt: { gte: since } } }),
  ]);
  if (!open && !recent) {
    try {
      built = await buildBatch(deps, null);
    } catch (error) {
      if (error.code !== 'BATCH_OPEN') throw error;
    }
  }

  const overdue = await db.payoutBatch.findMany({
    where: { status: 'OPEN', dueAt: { lte: now }, overdueNotifiedAt: null },
  });
  for (const batch of overdue) {
    const { count } = await db.payoutBatch.updateMany({
      where: { id: batch.id, overdueNotifiedAt: null },
      data: { overdueNotifiedAt: now },
    });
    if (count !== 1) continue;
    await notifyAdmins(deps, {
      key: `payoutBatch:${batch.id}:overdue`,
      type: 'payoutBatchOverdue',
      title: `Payout batch ${batch.ref} is past its target`,
      body: `It was due by ${dateText(batch.dueAt)}. Record the remaining transfers as paid or failed.`,
      link: `/admin/payouts/${batch.id}`,
    });
  }
  return { built: built ? 1 : 0, overdue: overdue.length };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function notifyAdmins(deps, { key, ...notification }) {
  const admins = await deps.db.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
  });
  for (const admin of admins) {
    await deliver(deps, {
      userId: admin.id,
      key: `${key}:${admin.id}`,
      category: 'PAYMENTS',
      ...notification,
    });
  }
}

const rupeeText = formatPaise;
const dateFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: BUSINESS_TIME_ZONE,
  day: 'numeric',
  month: 'short',
});
const dateText = (instant) => dateFormat.format(instant);

// Unpaid money keeps an account open (I16): payouts in progress or failed, and
// completed transactions still waiting to be paid.
registerDeletionBlocker(async ({ db, userId }) => {
  const open = await db.payoutItem.count({
    where: { sellerId: userId, status: { in: ['PENDING', 'FAILED'] } },
  });
  if (open > 0) return 'A payout to you is still in progress';
  const unpaid = await unpaidTransactions(db, { sellerId: userId });
  return unpaid.length > 0 ? 'You have earnings that have not been paid out yet' : null;
});
