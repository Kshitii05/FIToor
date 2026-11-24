import {
  APPEAL_WINDOW_DAYS,
  DISPUTE_EVIDENCE_RETENTION_DAYS,
  DISPUTE_REVIEW_BUSINESS_DAYS,
  EVIDENCE_PHOTOS_MAX,
} from '../../config/policy.js';
import { addBusinessDays, addDays } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { paged, pageWindow } from '../../lib/pagination.js';
import { discardStored, readImages, storeImages } from '../listings/listings.service.js';
import { notifyBoth, notifyDispute } from './dispute.emails.js';
import { checkDecision, cleanDecision, KINDS, loadSubject } from './dispute.kinds.js';
import { evidencePhotos, recordEvidence, UNFINISHED } from './dispute.records.js';

// One dispute state machine for every post-sale problem (I79 to I85):
//
//   OPEN --(answer, or 48 h)--> UNDER_REVIEW --(admin)--> DECIDED --(3 days)--> CLOSED
//     |                              |                       '--(appeal)--> APPEALED --(admin, final)--> CLOSED
//     '--(the other side agrees)--> RESOLVED      '--(opener withdraws)--> WITHDRAWN
//
// A decision takes effect only when the appeal window ends, or right after the
// appeal is decided (I13). Agreement takes effect at once. Effects are the order and
// rental functions in dispute.kinds.js. Every admin step needs a reason and is audited.

const ANSWERABLE = ['OPEN', 'UNDER_REVIEW'];
const EVIDENCE_OPEN = ['OPEN', 'UNDER_REVIEW', 'APPEALED'];

const person = { select: { id: true, status: true, profile: { select: { displayName: true } } } };
const disputeInclude = {
  evidence: {
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { profile: { select: { displayName: true } } } } },
  },
  claimant: person,
  respondent: person,
  order: { select: { ref: true } },
  booking: { select: { ref: true, title: true } },
};

const iso = (date) => (date ? date.toISOString() : null);
const personView = (user) => ({
  id: user.id,
  displayName: user.status === 'DELETED' ? 'Deleted user' : user.profile.displayName,
});

function roleOf(dispute, userId) {
  if (dispute.claimantId === userId) return 'CLAIMANT';
  if (dispute.respondentId === userId) return 'RESPONDENT';
  return null;
}

function actionsFor(dispute, role, now) {
  if (!role) return [];
  const kind = KINDS[dispute.kind];
  const actions = [];
  if (EVIDENCE_OPEN.includes(dispute.status)) actions.push('evidence');
  if (role === 'RESPONDENT' && ANSWERABLE.includes(dispute.status) && kind.canAgree(dispute))
    actions.push('agree');
  if (role === 'CLAIMANT' && ANSWERABLE.includes(dispute.status) && kind.canWithdraw(dispute))
    actions.push('withdraw');
  if (dispute.status === 'DECIDED' && !dispute.appealedAt && dispute.appealDueAt > now)
    actions.push('appeal');
  return actions;
}

export function toDisputeView(dispute, viewerId, now, { admin = false } = {}) {
  const role = admin ? 'ADMIN' : roleOf(dispute, viewerId);
  return {
    id: dispute.id,
    ref: dispute.ref,
    kind: dispute.kind,
    status: dispute.status,
    myRole: role,
    orderId: dispute.orderId,
    bookingId: dispute.bookingId,
    subject: dispute.order
      ? { type: 'order', ref: dispute.order.ref }
      : dispute.booking
        ? { type: 'booking', ref: dispute.booking.ref, title: dispute.booking.title }
        : null,
    claimant: personView(dispute.claimant),
    respondent: personView(dispute.respondent),
    openedByClaimant: dispute.openedByClaimant,
    category: dispute.category,
    description: dispute.description,
    claimItems: dispute.claimItems,
    claimedDamagePaise: dispute.claimedDamagePaise,
    lateFeeDisputed: dispute.lateFeeDisputed,
    respondDueAt: iso(dispute.respondDueAt),
    respondedAt: iso(dispute.respondedAt),
    reviewDueAt: iso(dispute.reviewDueAt),
    reviewOverdue: dispute.reviewOverdueAt !== null,
    decision: dispute.decision,
    decisionReason: dispute.decisionReason,
    decidedAt: iso(dispute.decidedAt),
    appealDueAt: iso(dispute.appealDueAt),
    appealedBy: dispute.appealedById ? roleOf(dispute, dispute.appealedById) : null,
    appealReason: dispute.appealReason,
    appealedAt: iso(dispute.appealedAt),
    finalDecision: dispute.finalDecision,
    finalReason: dispute.finalReason,
    finalDecidedAt: iso(dispute.finalDecidedAt),
    closedAt: iso(dispute.closedAt),
    evidencePurged: dispute.evidencePurgedAt !== null,
    evidence: dispute.evidence.map((entry) => ({
      id: entry.id,
      role: entry.role,
      author: entry.author ? entry.author.profile.displayName : null,
      text: entry.text,
      photos: (entry.photos ?? []).map(({ url, takenAt }) => ({ url, takenAt })),
      createdAt: iso(entry.createdAt),
    })),
    createdAt: iso(dispute.createdAt),
    actions: actionsFor(dispute, role === 'ADMIN' ? null : role, now),
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadDispute(db, id) {
  const dispute = await db.dispute.findUnique({ where: { id }, include: disputeInclude });
  if (!dispute) throw AppError.notFound('Dispute not found');
  return dispute;
}

/** For one of its two sides only. */
export async function loadOwnDispute(db, id, userId) {
  const dispute = await loadDispute(db, id);
  if (!roleOf(dispute, userId)) throw AppError.notFound('Dispute not found');
  return dispute;
}

export async function listDisputes({ db, clock }, where, query, viewerId, options) {
  const [rows, total] = await Promise.all([
    db.dispute.findMany({
      where,
      include: disputeInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageWindow(query),
    }),
    db.dispute.count({ where }),
  ]);
  const now = clock.now();
  return paged(
    rows.map((row) => toDisputeView(row, viewerId, now, options)),
    total,
    query,
  );
}

async function adminAudit(tx, now, { adminId, action, disputeId, reason, details }) {
  await tx.adminAuditLog.create({
    data: {
      adminId,
      action,
      targetType: 'dispute',
      targetId: disputeId,
      reason,
      details: details ?? undefined,
      createdAt: now,
    },
  });
}

const changed = () => new AppError(409, 'DISPUTE_CHANGED', 'This dispute has changed; reload it');

// ---------------------------------------------------------------------------
// The two sides
// ---------------------------------------------------------------------------

/** The respondent answering (their first evidence while OPEN) sends it to an admin. */
async function toReview(tx, now, dispute, { answered }) {
  const { count } = await tx.dispute.updateMany({
    where: { id: dispute.id, status: 'OPEN' },
    data: {
      status: 'UNDER_REVIEW',
      reviewDueAt: addBusinessDays(now, DISPUTE_REVIEW_BUSINESS_DAYS),
      ...(answered ? { respondedAt: now } : {}),
    },
  });
  return count === 1;
}

async function afterReview(deps, disputeId) {
  const dispute = await loadDispute(deps.db, disputeId);
  const kind = KINDS[dispute.kind];
  if (kind.onReview) await kind.onReview(deps, dispute, await loadSubject(deps.db, dispute));
  await notifyBoth(deps, dispute, 'underReview');
}

export async function addDisputeEvidence(deps, me, dispute, { text }, files) {
  const { db, clock } = deps;
  const role = roleOf(dispute, me);
  if (!role) throw AppError.notFound('Dispute not found');
  if (!EVIDENCE_OPEN.includes(dispute.status)) {
    throw new AppError(409, 'DISPUTE_CLOSED_FOR_EVIDENCE', 'Evidence can no longer be added here');
  }
  const images = readImages(files);
  if (images.length > EVIDENCE_PHOTOS_MAX) {
    throw new AppError(
      400,
      'TOO_MANY_IMAGES',
      `Add at most ${EVIDENCE_PHOTOS_MAX} photos at a time`,
    );
  }
  const words = text?.trim() || null;
  if (!words && images.length === 0) throw AppError.badRequest('Write something or add a photo');

  const now = clock.now();
  const stored = await storeImages(deps, images, 'disputes');
  let moved = false;
  try {
    await db.$transaction(async (tx) => {
      await recordEvidence(tx, now, dispute.id, {
        authorId: me,
        role,
        text: words,
        photos: evidencePhotos(stored, now),
      });
      if (role === 'RESPONDENT' && dispute.status === 'OPEN') {
        moved = await toReview(tx, now, dispute, { answered: true });
      }
    });
  } catch (error) {
    await discardStored(deps, stored);
    throw error;
  }
  if (moved) await afterReview(deps, dispute.id);
  else
    await notifyDispute(
      deps,
      dispute,
      role === 'CLAIMANT' ? 'respondent' : 'claimant',
      'evidenceAdded',
    );
  return loadDispute(db, dispute.id);
}

/** The respondent agrees: it takes effect at once and cannot be appealed (I82). */
export async function agreeToDispute(deps, me, dispute) {
  const { db, clock } = deps;
  if (dispute.respondentId !== me)
    throw AppError.forbidden('Only the other side can agree to this');
  const kind = KINDS[dispute.kind];
  if (!ANSWERABLE.includes(dispute.status) || !kind.canAgree(dispute)) {
    throw new AppError(409, 'CANNOT_AGREE', 'This dispute cannot be settled by agreement now');
  }
  const actor = { userId: me, role: dispute.respondentId === me ? 'RESPONDENT' : 'CLAIMANT' };
  await kind.agree(deps, dispute, await loadSubject(db, dispute), actor);
  const now = clock.now();
  await db.$transaction(async (tx) => {
    const { count } = await tx.dispute.updateMany({
      where: { id: dispute.id, status: { in: ANSWERABLE } },
      data: { status: 'RESOLVED', respondedAt: dispute.respondedAt ?? now, closedAt: now },
    });
    if (count !== 1) throw changed();
    await recordEvidence(tx, now, dispute.id, {
      authorId: me,
      role: 'RESPONDENT',
      text: 'Agreed.',
    });
  });
  const updated = await loadDispute(db, dispute.id);
  await notifyBoth(deps, updated, 'resolved');
  return updated;
}

/** The opener withdraws it before a decision; the order or booking carries on. */
export async function withdrawDispute(deps, me, dispute) {
  const { db, clock } = deps;
  if (dispute.claimantId !== me)
    throw AppError.forbidden('Only the person it is for can withdraw it');
  const kind = KINDS[dispute.kind];
  if (!ANSWERABLE.includes(dispute.status) || !kind.canWithdraw(dispute)) {
    throw new AppError(409, 'CANNOT_WITHDRAW', 'This dispute cannot be withdrawn now');
  }
  await kind.withdraw(deps, dispute, await loadSubject(db, dispute), {
    userId: me,
    role: 'CLAIMANT',
  });
  const now = clock.now();
  await db.$transaction(async (tx) => {
    const { count } = await tx.dispute.updateMany({
      where: { id: dispute.id, status: { in: ANSWERABLE } },
      data: { status: 'WITHDRAWN', closedAt: now },
    });
    if (count !== 1) throw changed();
    await recordEvidence(tx, now, dispute.id, {
      authorId: me,
      role: 'CLAIMANT',
      text: 'Withdrawn.',
    });
  });
  const updated = await loadDispute(db, dispute.id);
  await notifyDispute(deps, updated, 'respondent', 'withdrawn');
  return updated;
}

/** Either side may appeal once, with a reason, within 3 days of the decision (I13, I83). */
export async function appealDispute(deps, me, dispute, reason) {
  const { db, clock } = deps;
  const role = roleOf(dispute, me);
  if (!role) throw AppError.notFound('Dispute not found');
  const now = clock.now();
  if (dispute.status !== 'DECIDED' || dispute.appealedAt || dispute.appealDueAt <= now) {
    throw new AppError(409, 'CANNOT_APPEAL', 'This decision can no longer be appealed');
  }
  await db.$transaction(async (tx) => {
    const { count } = await tx.dispute.updateMany({
      where: { id: dispute.id, status: 'DECIDED', appealedAt: null, appealDueAt: { gt: now } },
      data: {
        status: 'APPEALED',
        appealedById: me,
        appealReason: reason,
        appealedAt: now,
        reviewDueAt: addBusinessDays(now, DISPUTE_REVIEW_BUSINESS_DAYS),
        reviewOverdueAt: null,
      },
    });
    if (count !== 1)
      throw new AppError(409, 'CANNOT_APPEAL', 'This decision can no longer be appealed');
    await recordEvidence(tx, now, dispute.id, { authorId: me, role, text: `Appeal: ${reason}` });
  });
  const updated = await loadDispute(db, dispute.id);
  await notifyDispute(deps, updated, role === 'CLAIMANT' ? 'respondent' : 'claimant', 'appealed');
  return updated;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** Decides; it takes effect when the 3-day appeal window ends (I81). */
export async function adminDecideDispute(deps, adminId, dispute, input) {
  const { db, clock } = deps;
  if (!ANSWERABLE.includes(dispute.status)) {
    throw new AppError(409, 'CANNOT_DECIDE', 'This dispute is not waiting for a decision');
  }
  const decision = cleanDecision(input);
  checkDecision(dispute, await loadSubject(db, dispute), decision);
  const now = clock.now();
  await db.$transaction(async (tx) => {
    const { count } = await tx.dispute.updateMany({
      where: { id: dispute.id, status: { in: ANSWERABLE } },
      data: {
        status: 'DECIDED',
        decision,
        decisionReason: input.reason,
        decidedById: adminId,
        decidedAt: now,
        appealDueAt: addDays(now, APPEAL_WINDOW_DAYS),
      },
    });
    if (count !== 1) throw changed();
    await adminAudit(tx, now, {
      adminId,
      action: 'DECIDE_DISPUTE',
      disputeId: dispute.id,
      reason: input.reason,
      details: decision,
    });
  });
  const updated = await loadDispute(db, dispute.id);
  await notifyBoth(deps, updated, 'decided');
  return updated;
}

/** Applies a decision to the order or booking and closes the dispute. */
async function applyAndClose(deps, dispute, decision, actor, reason, extra = {}) {
  const { db, clock, logger } = deps;
  const subject = await loadSubject(db, dispute);
  try {
    await KINDS[dispute.kind].apply(deps, dispute, subject, decision, actor, reason);
  } catch (error) {
    // Already applied by an earlier run: the subject has moved on, so close the dispute.
    if (!['INVALID_ORDER_STATE', 'INVALID_BOOKING_STATE'].includes(error?.code)) throw error;
    logger.warn?.(`Dispute ${dispute.id}: effect already applied (${error.message})`);
  }
  const { count } = await db.dispute.updateMany({
    where: { id: dispute.id, status: { in: ['DECIDED', 'APPEALED'] } },
    data: { status: 'CLOSED', closedAt: clock.now(), ...extra },
  });
  if (count === 1) await notifyBoth(deps, await loadDispute(db, dispute.id), 'closed');
  return count === 1;
}

/** Decides an appeal: upholds the decision or replaces it. Final, and takes effect at once. */
export async function adminDecideAppeal(deps, adminId, dispute, input) {
  const { db, clock } = deps;
  if (dispute.status !== 'APPEALED') {
    throw new AppError(409, 'CANNOT_DECIDE', 'There is no appeal waiting');
  }
  const decision = input.outcome ? cleanDecision(input) : dispute.decision;
  if (input.outcome) checkDecision(dispute, await loadSubject(db, dispute), decision);
  const now = clock.now();
  await db.$transaction((tx) =>
    adminAudit(tx, now, {
      adminId,
      action: 'DECIDE_APPEAL',
      disputeId: dispute.id,
      reason: input.reason,
      details: decision,
    }),
  );
  await applyAndClose(deps, dispute, decision, { userId: adminId, role: 'ADMIN' }, input.reason, {
    finalDecision: decision,
    finalReason: input.reason,
    finalDecidedById: adminId,
    finalDecidedAt: now,
  });
  return loadDispute(db, dispute.id);
}

// ---------------------------------------------------------------------------
// Deadlines, run every minute
// ---------------------------------------------------------------------------

async function purgeEvidence(deps, dispute) {
  const entries = await deps.db.disputeEvidence.findMany({ where: { disputeId: dispute.id } });
  const stored = entries.flatMap((e) => (e.photos ?? []).filter((p) => p.storageId));
  await discardStored(deps, stored);
  await deps.db.$transaction([
    deps.db.disputeEvidence.updateMany({ where: { disputeId: dispute.id }, data: { photos: [] } }),
    deps.db.dispute.update({
      where: { id: dispute.id },
      data: { evidencePurgedAt: deps.clock.now() },
    }),
  ]);
}

export async function runDisputeJobs(deps) {
  const { db, clock } = deps;
  const now = clock.now();
  const result = { toReview: 0, closed: 0, overdue: 0, purged: 0 };

  // No answer within 48 hours: an admin decides (I80).
  for (const { id } of await db.dispute.findMany({
    where: { status: 'OPEN', respondDueAt: { lte: now } },
    select: { id: true },
  })) {
    const dispute = await loadDispute(db, id);
    if (await db.$transaction((tx) => toReview(tx, now, dispute, { answered: false }))) {
      result.toReview += 1;
      await afterReview(deps, id);
    }
  }

  // The appeal window ended without an appeal: the decision takes effect (I81).
  for (const { id } of await db.dispute.findMany({
    where: { status: 'DECIDED', appealDueAt: { lte: now } },
    select: { id: true },
  })) {
    const dispute = await loadDispute(db, id);
    const actor = { userId: dispute.decidedById, role: 'ADMIN' };
    if (await applyAndClose(deps, dispute, dispute.decision, actor, dispute.decisionReason)) {
      result.closed += 1;
    }
  }

  // Past the 5-business-day target: flagged for the admin queue.
  const overdue = await db.dispute.updateMany({
    where: {
      status: { in: ['UNDER_REVIEW', 'APPEALED'] },
      reviewDueAt: { lte: now },
      reviewOverdueAt: null,
    },
    data: { reviewOverdueAt: now },
  });
  result.overdue = overdue.count;

  // Evidence photos are kept 180 days after a dispute ends (SPEC 15, I84).
  for (const dispute of await db.dispute.findMany({
    where: {
      status: { in: ['RESOLVED', 'CLOSED', 'WITHDRAWN'] },
      closedAt: { lte: addDays(now, -DISPUTE_EVIDENCE_RETENTION_DAYS) },
      evidencePurgedAt: null,
    },
  })) {
    await purgeEvidence(deps, dispute);
    result.purged += 1;
  }
  return result;
}

export { UNFINISHED };
