import { Router } from 'express';
import { z } from 'zod';
import { BANK_REFERENCE_MAX_LENGTH } from '../../config/policy.js';
import { requireAdmin } from '../../lib/auth.js';
import { sendCsv, toCsv } from '../../lib/csv.js';
import { pageWindow, paged, paginationQuery } from '../../lib/pagination.js';
import { LISTING_CATEGORIES, LISTING_STATUSES } from '../listings/listings.validation.js';
import { platformAnalytics, rangeQuery, seriesColumns } from '../analytics/analytics.service.js';
import {
  bankAccountInclude,
  rejectBankAccount,
  toAdminBankAccount,
  verifyBankAccount,
} from '../payouts/bank.service.js';
import {
  bankFile,
  bankFileColumns,
  batchDetail,
  batchInclude,
  buildBatch,
  loadItem,
  markFailed,
  markPaid,
  payoutPreview,
  retryPayout,
  toBatch,
  toPayoutItem,
} from '../payouts/payouts.service.js';
import {
  listingColumns,
  listingInclude,
  listingsWhere,
  removeListing,
  restoreListing,
  toAdminListing,
} from './admin.listings.service.js';
import {
  DEPOSIT_STAGE_NAMES,
  depositColumns,
  depositsWhere,
  paymentColumns,
  paymentInclude,
  paymentsWhere,
  refundColumns,
  refundInclude,
  refundsWhere,
  retryRefund,
  toAdminDeposit,
  toAdminPayment,
  toAdminRefund,
} from './admin.money.service.js';
import { dayRange, idParams, listQuery, requiredReason, respondList } from './admin.query.js';
import {
  restoreUser,
  suspendUser,
  toAdminUser,
  userColumns,
  userDetail,
  userInclude,
  usersWhere,
  warnUser,
} from './admin.users.service.js';

const newest = [{ createdAt: 'desc' }, { id: 'desc' }];

const usersQuery = z.object({
  ...listQuery,
  status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING_DELETION', 'DELETED']).optional(),
  role: z.enum(['USER', 'ADMIN']).optional(),
});
const suspendBody = requiredReason.extend({ removeListings: z.boolean().default(false) });

const listingsQuery = z.object({
  ...listQuery,
  mode: z.enum(['SALE', 'RENT']).optional(),
  status: z.enum(LISTING_STATUSES).optional(),
  category: z.enum(LISTING_CATEGORIES).optional(),
  sellerId: z.uuid().optional(),
});

const paymentsQuery = z.object({ ...listQuery, status: z.enum(['CAPTURED', 'FAILED']).optional() });
const refundsQuery = z.object({
  ...listQuery,
  status: z.enum(['PENDING', 'PROCESSED', 'FAILED']).optional(),
  reason: z.string().max(40).optional(),
});
const depositsQuery = z.object({ ...listQuery, stage: z.enum(DEPOSIT_STAGE_NAMES).optional() });

const auditQuery = z.object({
  ...listQuery,
  adminId: z.uuid().optional(),
  action: z.string().trim().max(60).optional(),
  targetType: z.string().trim().max(40).optional(),
  targetId: z.string().trim().max(60).optional(),
});

const bankQuery = z.object({
  ...paginationQuery,
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).default('PENDING'),
});
const batchesQuery = z.object({
  ...paginationQuery,
  status: z.enum(['OPEN', 'CLOSED']).optional(),
});
const itemsQuery = z.object({
  ...paginationQuery,
  status: z.enum(['PENDING', 'PAID', 'FAILED']).optional(),
  sellerId: z.uuid().optional(),
});
const paidBody = z.strictObject({
  bankReference: z
    .string('Enter the bank reference (UTR)')
    .trim()
    .min(4, 'Enter the bank reference (UTR)')
    .max(BANK_REFERENCE_MAX_LENGTH),
});

/**
 * `/admin`: the Super Admin's users, listings, money, payouts, audit log and
 * analytics (SPEC Modules 10 and 11). The role is checked on every request.
 */
export function createAdminRouter(deps) {
  const { db, clock } = deps;
  const router = Router();
  router.use(deps.requireAuth, requireAdmin);
  const admin = (req) => req.auth.userId;
  const id = (req) => idParams.parse(req.params).id;

  // Users -------------------------------------------------------------------
  router.get('/users', async (req, res) => {
    const query = usersQuery.parse(req.query);
    const where = usersWhere(query);
    await respondList(res, query, {
      find: (window) =>
        db.user.findMany({ where, include: userInclude, orderBy: newest, ...window }),
      count: () => db.user.count({ where }),
      view: toAdminUser,
      columns: userColumns,
      filename: 'users.csv',
    });
  });
  router.get('/users/:id', async (req, res) => res.json(await userDetail(deps, id(req))));
  router.post('/users/:id/suspend', async (req, res) =>
    res.json(await suspendUser(deps, admin(req), id(req), suspendBody.parse(req.body ?? {}))),
  );
  router.post('/users/:id/restore', async (req, res) =>
    res.json(await restoreUser(deps, admin(req), id(req), requiredReason.parse(req.body ?? {}))),
  );
  router.post('/users/:id/warn', async (req, res) =>
    res.json(await warnUser(deps, admin(req), id(req), requiredReason.parse(req.body ?? {}))),
  );

  // Listings ----------------------------------------------------------------
  router.get('/listings', async (req, res) => {
    const query = listingsQuery.parse(req.query);
    const where = listingsWhere(query);
    await respondList(res, query, {
      find: (window) =>
        db.listing.findMany({ where, include: listingInclude, orderBy: newest, ...window }),
      count: () => db.listing.count({ where }),
      view: toAdminListing,
      columns: listingColumns,
      filename: 'listings.csv',
    });
  });
  router.post('/listings/:id/remove', async (req, res) =>
    res.json({
      listing: await removeListing(deps, admin(req), id(req), requiredReason.parse(req.body ?? {})),
    }),
  );
  router.post('/listings/:id/restore', async (req, res) =>
    res.json({
      listing: await restoreListing(
        deps,
        admin(req),
        id(req),
        requiredReason.parse(req.body ?? {}),
      ),
    }),
  );

  // Payments, refunds, deposits ---------------------------------------------
  router.get('/payments', async (req, res) => {
    const query = paymentsQuery.parse(req.query);
    const where = paymentsWhere(query);
    await respondList(res, query, {
      find: (window) =>
        db.payment.findMany({ where, include: paymentInclude, orderBy: newest, ...window }),
      count: () => db.payment.count({ where }),
      view: toAdminPayment,
      columns: paymentColumns,
      filename: 'payments.csv',
    });
  });
  router.get('/refunds', async (req, res) => {
    const query = refundsQuery.parse(req.query);
    const where = refundsWhere(query);
    await respondList(res, query, {
      find: (window) =>
        db.refund.findMany({ where, include: refundInclude, orderBy: newest, ...window }),
      count: () => db.refund.count({ where }),
      view: toAdminRefund,
      columns: refundColumns,
      filename: 'refunds.csv',
    });
  });
  router.post('/refunds/:id/retry', async (req, res) =>
    res.json({
      refund: await retryRefund(deps, admin(req), id(req), requiredReason.parse(req.body ?? {})),
    }),
  );
  router.get('/deposits', async (req, res) => {
    const query = depositsQuery.parse(req.query);
    const where = depositsWhere(query);
    await respondList(res, query, {
      find: (window) =>
        db.rentalBooking.findMany({
          where,
          orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
          ...window,
        }),
      count: () => db.rentalBooking.count({ where }),
      view: toAdminDeposit,
      columns: depositColumns,
      filename: 'deposits.csv',
    });
  });

  // Audit log ---------------------------------------------------------------
  router.get('/audit-log', async (req, res) => {
    const query = auditQuery.parse(req.query);
    const where = {};
    if (query.adminId) where.adminId = query.adminId;
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;
    const created = dayRange(query);
    if (created) where.createdAt = created;
    if (query.q) where.reason = { contains: query.q, mode: 'insensitive' };
    const include = { admin: { select: { email: true } } };
    await respondList(res, query, {
      find: (window) => db.adminAuditLog.findMany({ where, include, orderBy: newest, ...window }),
      count: () => db.adminAuditLog.count({ where }),
      view: (row) => ({
        id: row.id,
        admin: { id: row.adminId, email: row.admin.email },
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        reason: row.reason,
        details: row.details,
        createdAt: row.createdAt.toISOString(),
      }),
      columns: [
        ['when', (r) => r.createdAt],
        ['admin', (r) => r.admin.email],
        ['action', (r) => r.action],
        ['target type', (r) => r.targetType],
        ['target id', (r) => r.targetId],
        ['reason', (r) => r.reason],
        ['details', (r) => (r.details ? JSON.stringify(r.details) : '')],
      ],
      filename: 'audit-log.csv',
    });
  });

  // Bank accounts -----------------------------------------------------------
  router.get('/bank-accounts', async (req, res) => {
    const query = bankQuery.parse(req.query);
    const where = { status: query.status };
    const [rows, total] = await Promise.all([
      db.sellerBankAccount.findMany({
        where,
        include: bankAccountInclude,
        orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        ...pageWindow(query),
      }),
      db.sellerBankAccount.count({ where }),
    ]);
    res.json(paged(rows.map(toAdminBankAccount), total, query));
  });
  router.post('/bank-accounts/:id/verify', async (req, res) =>
    res.json({
      bankAccount: await verifyBankAccount(
        deps,
        admin(req),
        id(req),
        requiredReason.parse(req.body ?? {}),
      ),
    }),
  );
  router.post('/bank-accounts/:id/reject', async (req, res) =>
    res.json({
      bankAccount: await rejectBankAccount(
        deps,
        admin(req),
        id(req),
        requiredReason.parse(req.body ?? {}),
      ),
    }),
  );

  // Payouts -----------------------------------------------------------------
  router.get('/payouts/eligible', async (_req, res) => res.json(await payoutPreview(deps)));
  router.get('/payout-batches', async (req, res) => {
    const query = batchesQuery.parse(req.query);
    const where = query.status ? { status: query.status } : {};
    const [rows, total] = await Promise.all([
      db.payoutBatch.findMany({
        where,
        include: batchInclude,
        orderBy: newest,
        ...pageWindow(query),
      }),
      db.payoutBatch.count({ where }),
    ]);
    const now = clock.now();
    res.json(
      paged(
        rows.map((b) => toBatch(b, now)),
        total,
        query,
      ),
    );
  });
  router.post('/payout-batches', async (req, res) => {
    const batch = await buildBatch(deps, admin(req));
    if (!batch) return res.status(200).json({ batch: null, message: 'Nothing is ready to pay' });
    return res.status(201).json(await batchDetail(deps, batch.id));
  });
  router.get('/payout-batches/:id', async (req, res) => res.json(await batchDetail(deps, id(req))));
  router.get('/payout-batches/:id/bank-file.csv', async (req, res) => {
    const file = await bankFile(deps, admin(req), id(req));
    sendCsv(res, `${file.ref}-bank-file.csv`, toCsv(bankFileColumns, file.rows));
  });
  router.get('/payout-items', async (req, res) => {
    const query = itemsQuery.parse(req.query);
    const where = {};
    if (query.status) where.status = query.status;
    if (query.sellerId) where.sellerId = query.sellerId;
    const [rows, total] = await Promise.all([
      db.payoutItem.findMany({
        where,
        select: { id: true },
        orderBy: newest,
        ...pageWindow(query),
      }),
      db.payoutItem.count({ where }),
    ]);
    const items = await Promise.all(rows.map((row) => loadItem(db, row.id)));
    res.json(paged(items.map(toPayoutItem), total, query));
  });
  router.post('/payout-items/:id/paid', async (req, res) =>
    res.json({ item: await markPaid(deps, admin(req), id(req), paidBody.parse(req.body ?? {})) }),
  );
  router.post('/payout-items/:id/failed', async (req, res) =>
    res.json({
      item: await markFailed(deps, admin(req), id(req), requiredReason.parse(req.body ?? {})),
    }),
  );
  router.post('/payout-items/:id/retry', async (req, res) =>
    res.json({
      item: await retryPayout(deps, admin(req), id(req), requiredReason.parse(req.body ?? {})),
    }),
  );

  // Analytics ---------------------------------------------------------------
  router.get('/analytics', async (req, res) => {
    const query = rangeQuery.parse(req.query);
    const result = await platformAnalytics(deps, query);
    if (query.format === 'csv') {
      return sendCsv(
        res,
        `platform-${result.range.from}-to-${result.range.to}.csv`,
        toCsv(seriesColumns(result.series), result.series),
      );
    }
    return res.json(result);
  });

  return router;
}
