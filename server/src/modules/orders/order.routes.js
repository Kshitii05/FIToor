import { Router } from 'express';
import { z } from 'zod';
import {
  DISPATCH_EXTENSION_MAX_BUSINESS_DAYS,
  HANDOVER_CODE_LENGTH,
  ISSUE_DESCRIPTION_MAX_LENGTH,
  ISSUE_DESCRIPTION_MIN_LENGTH,
  ISSUE_PHOTOS_MAX,
  LISTING_IMAGE_MAX_BYTES,
  REASON_MAX_LENGTH,
} from '../../config/policy.js';
import { requireAdmin } from '../../lib/auth.js';
import { AppError } from '../../lib/errors.js';
import { paginationQuery } from '../../lib/pagination.js';
import { uploadImages } from '../../lib/upload.js';
import {
  adminCancel,
  adminResetHandover,
  adminResolveIssue,
  adminVerifyDelivery,
  answerExtension,
  cancelBeforeDispatch,
  completeHandover,
  confirmReceipt,
  listOrders,
  loadAs,
  loadOrder,
  markDeliveryReported,
  markDispatched,
  reportIssue,
  reportNotReceived,
  requestExtension,
  toAdminOrder,
  toBuyerOrder,
  toSellerOrder,
} from './order.service.js';

const ORDER_STATUSES = [
  'AWAITING_DISPATCH',
  'AWAITING_PICKUP',
  'DISPATCHED',
  'DELIVERY_REPORTED',
  'ADMIN_REVIEW',
  'DELIVERED',
  'ISSUE_OPEN',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
];

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({ ...paginationQuery, status: z.enum(ORDER_STATUSES).optional() });
const optionalReason = z.strictObject({
  reason: z.string().trim().max(REASON_MAX_LENGTH).optional(),
});
const requiredReason = z.strictObject({
  reason: z
    .string('Give a reason')
    .trim()
    .min(5, 'Give a reason of at least 5 characters')
    .max(REASON_MAX_LENGTH),
});
const dispatchSchema = z.strictObject({ courierReference: z.string().trim().max(100).optional() });
const handoverSchema = z.strictObject({
  code: z.string().trim().length(HANDOVER_CODE_LENGTH, 'Enter the 6-digit code'),
});
const extensionRequestSchema = z.strictObject({
  businessDays: z.number().int().min(1).max(DISPATCH_EXTENSION_MAX_BUSINESS_DAYS),
});
const extensionAnswerSchema = z.strictObject({ accept: z.boolean() });
const issueSchema = z.strictObject({
  kind: z.enum(['WRONG_ITEM', 'DAMAGED', 'NOT_AS_DESCRIBED']),
  description: z
    .string()
    .trim()
    .min(ISSUE_DESCRIPTION_MIN_LENGTH)
    .max(ISSUE_DESCRIPTION_MAX_LENGTH),
});
const resolveSchema = z
  .strictObject({
    resolution: z.enum(['FULL_REFUND', 'PARTIAL_REFUND', 'REJECTED']),
    refundPaise: z.number().int().positive().optional(),
    reason: requiredReason.shape.reason,
  })
  .refine((value) => value.resolution !== 'PARTIAL_REFUND' || value.refundPaise !== undefined, {
    message: 'Enter the amount to refund',
    path: ['refundPaise'],
  });

const photos = uploadImages({
  fieldName: 'photos',
  maxFiles: ISSUE_PHOTOS_MAX,
  maxBytes: LISTING_IMAGE_MAX_BYTES,
});

function parseData(req) {
  try {
    return JSON.parse(req.body?.data ?? '');
  } catch {
    throw AppError.badRequest('Send the details as JSON in a "data" field');
  }
}

/** `/me/orders`: what the signed-in person bought. */
export function createBuyerOrdersRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth);
  const view = (order) => toBuyerOrder(order, deps.clock.now());
  const mine = (req) =>
    loadAs(deps.db, idParams.parse(req.params).id, { userId: req.auth.userId, side: 'buyer' });
  const reply = (res, order, status = 200) => res.status(status).json({ order: view(order) });

  router.get('/', async (req, res) => {
    const query = listQuery.parse(req.query);
    res.json(
      await listOrders(deps, { buyerId: req.auth.userId, status: query.status }, query, view),
    );
  });
  router.get('/:id', async (req, res) => reply(res, await mine(req)));
  router.post('/:id/cancel', async (req, res) => {
    const { reason } = optionalReason.parse(req.body ?? {});
    reply(res, await cancelBeforeDispatch(deps, await mine(req), 'buyer', reason));
  });
  router.post('/:id/confirm', async (req, res) =>
    reply(res, await confirmReceipt(deps, await mine(req))),
  );
  router.post('/:id/not-received', async (req, res) => {
    const { reason } = optionalReason.parse(req.body ?? {});
    reply(res, await reportNotReceived(deps, await mine(req), reason));
  });
  router.post('/:id/extension', async (req, res) => {
    const { accept } = extensionAnswerSchema.parse(req.body);
    reply(res, await answerExtension(deps, await mine(req), accept));
  });
  router.post('/:id/issue', photos, async (req, res) => {
    const order = await mine(req);
    const input = issueSchema.parse(parseData(req));
    reply(res, await reportIssue(deps, order, input, req.files), 201);
  });

  return router;
}

/** `/me/sales`: orders for the signed-in seller's listings. */
export function createSellerOrdersRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth);
  const mine = (req) =>
    loadAs(deps.db, idParams.parse(req.params).id, { userId: req.auth.userId, side: 'seller' });
  const reply = (res, order) => res.json({ order: toSellerOrder(order) });

  router.get('/', async (req, res) => {
    const query = listQuery.parse(req.query);
    res.json(
      await listOrders(
        deps,
        { sellerId: req.auth.userId, status: query.status },
        query,
        toSellerOrder,
      ),
    );
  });
  router.get('/:id', async (req, res) => reply(res, await mine(req)));
  router.post('/:id/dispatch', async (req, res) => {
    const { courierReference } = dispatchSchema.parse(req.body ?? {});
    reply(res, await markDispatched(deps, await mine(req), courierReference));
  });
  router.post('/:id/deliver', async (req, res) =>
    reply(res, await markDeliveryReported(deps, await mine(req))),
  );
  router.post('/:id/handover', deps.limiters.checkout, async (req, res) => {
    const { code } = handoverSchema.parse(req.body);
    reply(res, await completeHandover(deps, await mine(req), code));
  });
  router.post('/:id/cancel', async (req, res) => {
    const { reason } = requiredReason.parse(req.body ?? {});
    reply(res, await cancelBeforeDispatch(deps, await mine(req), 'seller', reason));
  });
  router.post('/:id/extension', async (req, res) => {
    const { businessDays } = extensionRequestSchema.parse(req.body);
    reply(res, await requestExtension(deps, await mine(req), businessDays));
  });

  return router;
}

/** `/admin/orders`: admin-only, every action needs a reason and is audited. */
export function createAdminOrdersRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth, requireAdmin);
  const view = (order) => toAdminOrder(order, deps.clock.now());
  const load = (req) => loadOrder(deps.db, idParams.parse(req.params).id);
  const reply = (res, order) => res.json({ order: view(order) });

  router.get('/', async (req, res) => {
    const query = listQuery.parse(req.query);
    res.json(await listOrders(deps, { status: query.status }, query, view));
  });
  router.get('/:id', async (req, res) => reply(res, await load(req)));
  router.post('/:id/verify-delivery', async (req, res) => {
    const { reason } = requiredReason.parse(req.body ?? {});
    reply(res, await adminVerifyDelivery(deps, await load(req), req.auth.userId, reason));
  });
  router.post('/:id/cancel', async (req, res) => {
    const { reason } = requiredReason.parse(req.body ?? {});
    reply(res, await adminCancel(deps, await load(req), req.auth.userId, reason));
  });
  router.post('/:id/resolve-issue', async (req, res) => {
    const input = resolveSchema.parse(req.body ?? {});
    reply(res, await adminResolveIssue(deps, await load(req), req.auth.userId, input));
  });
  router.post('/:id/reset-handover-code', async (req, res) => {
    const { reason } = requiredReason.parse(req.body ?? {});
    reply(res, await adminResetHandover(deps, await load(req), req.auth.userId, reason));
  });

  return router;
}
