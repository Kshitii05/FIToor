import { Router } from 'express';
import { z } from 'zod';
import {
  EVIDENCE_PHOTOS_MAX,
  EVIDENCE_TEXT_MAX_LENGTH,
  LISTING_AMOUNT_MAX_PAISE,
  LISTING_IMAGE_MAX_BYTES,
  REASON_MAX_LENGTH,
} from '../../config/policy.js';
import { requireAdmin } from '../../lib/auth.js';
import { AppError } from '../../lib/errors.js';
import { paginationQuery } from '../../lib/pagination.js';
import { uploadImages } from '../../lib/upload.js';
import {
  addDisputeEvidence,
  adminDecideAppeal,
  adminDecideDispute,
  agreeToDispute,
  appealDispute,
  listDisputes,
  loadDispute,
  loadOwnDispute,
  toDisputeView,
  withdrawDispute,
} from './disputes.service.js';

const STATUSES = ['OPEN', 'UNDER_REVIEW', 'DECIDED', 'APPEALED', 'RESOLVED', 'CLOSED', 'WITHDRAWN'];
const KIND_NAMES = ['SALE_ISSUE', 'NOT_DELIVERED', 'RENTAL_DEPOSIT', 'NOT_RETURNED'];
const OUTCOMES = [
  'FULL_REFUND',
  'PARTIAL_REFUND',
  'REJECTED',
  'DELIVERED',
  'REFUND',
  'SETTLE',
  'RETURNED',
];

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({
  ...paginationQuery,
  status: z.enum(STATUSES).optional(),
  kind: z.enum(KIND_NAMES).optional(),
});
const reasonText = z
  .string('Give a reason')
  .trim()
  .min(5, 'Give a reason of at least 5 characters')
  .max(REASON_MAX_LENGTH);
const evidenceSchema = z.strictObject({
  text: z.string().max(EVIDENCE_TEXT_MAX_LENGTH).optional(),
});
const appealSchema = z.strictObject({ reason: reasonText });
const amount = z.number().int().min(0).max(LISTING_AMOUNT_MAX_PAISE);
const decisionShape = {
  refundPaise: amount.optional(),
  damagePaise: amount.optional(),
  lateFeePaise: amount.optional(),
  reason: reasonText,
};
const decideSchema = z.strictObject({ outcome: z.enum(OUTCOMES), ...decisionShape });
// An appeal decision without an outcome upholds the original decision.
const appealDecisionSchema = z.strictObject({
  outcome: z.enum(OUTCOMES).optional(),
  ...decisionShape,
});

const photos = uploadImages({
  fieldName: 'photos',
  maxFiles: EVIDENCE_PHOTOS_MAX,
  maxBytes: LISTING_IMAGE_MAX_BYTES,
});

function evidenceInput(req) {
  if (!req.is('multipart/form-data')) return evidenceSchema.parse(req.body ?? {});
  try {
    return evidenceSchema.parse(JSON.parse(req.body?.data || '{}'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw AppError.badRequest('Send the details as JSON in a "data" field');
    }
    throw error;
  }
}

/** `/disputes`: the signed-in person's disputes, as either side. */
export function createDisputesRouter(deps) {
  const { db, clock, limiters } = deps;
  const router = Router();
  router.use(deps.requireAuth);
  const mine = (req) => loadOwnDispute(db, idParams.parse(req.params).id, req.auth.userId);
  const reply = (req, res, dispute, status = 200) =>
    res.status(status).json({ dispute: toDisputeView(dispute, req.auth.userId, clock.now()) });

  router.get('/', async (req, res) => {
    const query = listQuery.parse(req.query);
    const me = req.auth.userId;
    const where = {
      OR: [{ claimantId: me }, { respondentId: me }],
      status: query.status,
      kind: query.kind,
    };
    res.json(await listDisputes(deps, where, query, me));
  });
  router.get('/:id', async (req, res) => reply(req, res, await mine(req)));
  router.post(
    '/:id/evidence',
    limiters.evidence,
    limiters.evidencePerUser,
    photos,
    async (req, res) => {
      const dispute = await mine(req);
      const input = evidenceInput(req);
      reply(
        req,
        res,
        await addDisputeEvidence(deps, req.auth.userId, dispute, input, req.files),
        201,
      );
    },
  );
  router.post('/:id/agree', async (req, res) =>
    reply(req, res, await agreeToDispute(deps, req.auth.userId, await mine(req))),
  );
  router.post('/:id/withdraw', async (req, res) =>
    reply(req, res, await withdrawDispute(deps, req.auth.userId, await mine(req))),
  );
  router.post('/:id/appeal', async (req, res) => {
    const { reason } = appealSchema.parse(req.body ?? {});
    reply(req, res, await appealDispute(deps, req.auth.userId, await mine(req), reason));
  });

  return router;
}

/** `/admin/disputes`: the review queue. Every decision needs a reason and is audited. */
export function createAdminDisputesRouter(deps) {
  const { db, clock } = deps;
  const router = Router();
  router.use(deps.requireAuth, requireAdmin);
  const load = (req) => loadDispute(db, idParams.parse(req.params).id);
  const reply = (req, res, dispute) =>
    res.json({ dispute: toDisputeView(dispute, req.auth.userId, clock.now(), { admin: true }) });

  router.get('/', async (req, res) => {
    const query = listQuery.parse(req.query);
    res.json(
      await listDisputes(deps, { status: query.status, kind: query.kind }, query, req.auth.userId, {
        admin: true,
      }),
    );
  });
  router.get('/:id', async (req, res) => reply(req, res, await load(req)));
  router.post('/:id/decide', async (req, res) => {
    const input = decideSchema.parse(req.body ?? {});
    reply(req, res, await adminDecideDispute(deps, req.auth.userId, await load(req), input));
  });
  router.post('/:id/decide-appeal', async (req, res) => {
    const input = appealDecisionSchema.parse(req.body ?? {});
    reply(req, res, await adminDecideAppeal(deps, req.auth.userId, await load(req), input));
  });

  return router;
}
