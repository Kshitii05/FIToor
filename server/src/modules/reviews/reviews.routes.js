import { Router } from 'express';
import { z } from 'zod';
import {
  LISTING_IMAGE_MAX_BYTES,
  REASON_MAX_LENGTH,
  REPORT_DETAILS_MAX_LENGTH,
  REVIEW_PHOTOS_MAX,
  REVIEW_TEXT_MAX_LENGTH,
} from '../../config/policy.js';
import { requireAdmin, requireVerified } from '../../lib/auth.js';
import { AppError } from '../../lib/errors.js';
import { paginationQuery } from '../../lib/pagination.js';
import { uploadImages } from '../../lib/upload.js';
import { createReport, listReports, resolveReport } from './reports.service.js';
import { adminSetReview, createReview, pendingReviews, reviewsOf } from './reviews.service.js';

const idParams = z.object({ id: z.uuid() });
const rating = z.number().int().min(1, 'From 1 to 5 stars').max(5, 'From 1 to 5 stars');
const reviewSchema = z
  .strictObject({
    orderId: z.uuid().optional(),
    bookingId: z.uuid().optional(),
    overall: rating,
    communication: rating,
    handover: rating,
    condition: rating.optional(),
    text: z.string().max(REVIEW_TEXT_MAX_LENGTH).optional(),
  })
  .refine((v) => Boolean(v.orderId) !== Boolean(v.bookingId), {
    message: 'Say which order or rental you are reviewing',
  });
const reasonText = z
  .string('Give a reason')
  .trim()
  .min(5, 'Give a reason of at least 5 characters')
  .max(REASON_MAX_LENGTH);
const reportSchema = z.strictObject({
  targetType: z.enum(['USER', 'LISTING', 'MESSAGE', 'REVIEW']),
  targetId: z.uuid(),
  reason: z.enum([
    'PROHIBITED_ITEM',
    'COUNTERFEIT',
    'SCAM',
    'HARASSMENT',
    'INAPPROPRIATE',
    'SPAM',
    'OTHER',
  ]),
  details: z.string().max(REPORT_DETAILS_MAX_LENGTH).optional(),
});
const reportsQuery = z.object({
  ...paginationQuery,
  status: z.enum(['OPEN', 'ACTIONED', 'DISMISSED']).optional(),
  targetType: z.enum(['USER', 'LISTING', 'MESSAGE', 'REVIEW']).optional(),
});
const resolveSchema = z.strictObject({
  action: z.enum(['DISMISS', 'HIDE_REVIEW', 'REMOVE_LISTING']),
  reason: reasonText,
});
const visibilitySchema = z.strictObject({ reason: reasonText });

const photos = uploadImages({
  fieldName: 'photos',
  maxFiles: REVIEW_PHOTOS_MAX,
  maxBytes: LISTING_IMAGE_MAX_BYTES,
});

function reviewInput(req) {
  if (!req.is('multipart/form-data')) return reviewSchema.parse(req.body ?? {});
  try {
    return reviewSchema.parse(JSON.parse(req.body?.data || '{}'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw AppError.badRequest('Send the details as JSON in a "data" field');
    }
    throw error;
  }
}

/** `/reviews`: write a review of a completed order or rental. */
export function createReviewsRouter(deps) {
  const router = Router();
  router.post(
    '/',
    deps.requireAuth,
    deps.limiters.reviewPerUser,
    requireVerified,
    photos,
    async (req, res) => {
      const input = reviewInput(req);
      res.status(201).json({ review: await createReview(deps, req.auth.userId, input, req.files) });
    },
  );
  return router;
}

/** `/me/reviews`: what the signed-in person can still review. */
export function createMyReviewsRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth);
  router.get('/pending', async (req, res) => {
    res.json({ items: await pendingReviews(deps, req.auth.userId) });
  });
  return router;
}

/** `/users/:id/reviews`: someone's published reviews and average ratings (public). */
export function createUserReviewsRouter(deps) {
  const router = Router();
  router.get('/:id/reviews', async (req, res) => {
    const { id } = idParams.parse(req.params);
    res.json(await reviewsOf(deps, id, z.object(paginationQuery).parse(req.query)));
  });
  return router;
}

/** `/reports`: report a person, listing, message or review. */
export function createReportsRouter(deps) {
  const router = Router();
  router.post(
    '/',
    deps.limiters.report,
    deps.requireAuth,
    deps.limiters.reportPerUser,
    async (req, res) => {
      const input = reportSchema.parse(req.body ?? {});
      res.status(201).json({ report: await createReport(deps, req.auth.userId, input) });
    },
  );
  return router;
}

/** `/admin/reports` and `/admin/reviews`: moderation. Reasons required; audited. */
export function createAdminModerationRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth, requireAdmin);
  router.get('/reports', async (req, res) => {
    res.json(await listReports(deps, reportsQuery.parse(req.query)));
  });
  router.post('/reports/:id/resolve', async (req, res) => {
    const { id } = idParams.parse(req.params);
    const input = resolveSchema.parse(req.body ?? {});
    res.json({ report: await resolveReport(deps, req.auth.userId, id, input) });
  });
  for (const [path, hidden] of [
    ['hide', true],
    ['show', false],
  ]) {
    router.post(`/reviews/:id/${path}`, async (req, res) => {
      const { id } = idParams.parse(req.params);
      const { reason } = visibilitySchema.parse(req.body ?? {});
      res.json({ review: await adminSetReview(deps, req.auth.userId, id, { hidden, reason }) });
    });
  }
  return router;
}
