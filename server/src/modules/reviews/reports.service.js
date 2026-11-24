import { AppError } from '../../lib/errors.js';
import { paged, pageWindow } from '../../lib/pagination.js';
import { setReviewVisibility } from './reviews.service.js';

// Reports (SPEC Module 7; I89, I90): a person, a listing, a chat message or a
// review. Reporting never removes anything by itself; an admin resolves each report
// with a reason, and every resolution is audited.

const cannotReport = (message) => new AppError(400, 'CANNOT_REPORT', message);

/** Checks the target exists and the reporter may report it. */
async function checkTarget(db, me, { targetType, targetId }) {
  if (targetType === 'USER') {
    const user = await db.user.findUnique({ where: { id: targetId } });
    if (!user) throw AppError.notFound('User not found');
    if (user.id === me) throw cannotReport('You cannot report yourself');
    return;
  }
  if (targetType === 'LISTING') {
    const listing = await db.listing.findFirst({ where: { id: targetId, deletedAt: null } });
    if (!listing) throw AppError.notFound('Listing not found');
    if (listing.sellerId === me) throw cannotReport('You cannot report your own listing');
    return;
  }
  if (targetType === 'MESSAGE') {
    const message = await db.message.findUnique({
      where: { id: targetId },
      include: { conversation: true },
    });
    const { conversation } = message ?? {};
    if (!message || (conversation.userAId !== me && conversation.userBId !== me)) {
      throw AppError.notFound('Message not found');
    }
    if (!message.senderId || message.senderId === me) {
      throw cannotReport('You can report only messages the other person sent');
    }
    return;
  }
  const review = await db.review.findUnique({ where: { id: targetId } });
  if (!review || review.status !== 'PUBLISHED') throw AppError.notFound('Review not found');
  if (review.authorId === me) throw cannotReport('You cannot report your own review');
}

const toReport = (report, target) => ({
  id: report.id,
  targetType: report.targetType,
  targetId: report.targetId,
  reason: report.reason,
  details: report.details,
  status: report.status,
  resolution: report.resolution,
  resolutionReason: report.resolutionReason,
  createdAt: report.createdAt.toISOString(),
  resolvedAt: report.resolvedAt?.toISOString() ?? null,
  ...(target !== undefined ? { target } : {}),
});

export async function createReport(deps, me, input) {
  const { db, clock } = deps;
  await checkTarget(db, me, input);
  try {
    const report = await db.report.create({
      data: {
        reporterId: me,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        details: input.details?.trim() || null,
        createdAt: clock.now(),
      },
    });
    return toReport(report);
  } catch (error) {
    // One open report per person and target: the partial unique index decided.
    if (error?.code === 'P2002') {
      throw new AppError(
        409,
        'ALREADY_REPORTED',
        'You have already reported this; our team is looking at it',
      );
    }
    throw error;
  }
}

/** What an admin needs to judge a report: a short summary of the reported thing. */
async function targetSummary(db, report) {
  const id = report.targetId;
  switch (report.targetType) {
    case 'USER': {
      const user = await db.user.findUnique({ where: { id }, include: { profile: true } });
      return user ? { displayName: user.profile?.displayName ?? null, status: user.status } : null;
    }
    case 'LISTING': {
      const listing = await db.listing.findUnique({ where: { id } });
      return listing
        ? { title: listing.title, status: listing.status, sellerId: listing.sellerId }
        : null;
    }
    case 'MESSAGE': {
      const message = await db.message.findUnique({ where: { id } });
      return message
        ? { body: message.body, senderId: message.senderId, conversationId: message.conversationId }
        : null;
    }
    default: {
      const review = await db.review.findUnique({ where: { id } });
      return review
        ? {
            text: review.text,
            overall: review.overall,
            status: review.status,
            authorId: review.authorId,
          }
        : null;
    }
  }
}

export async function listReports({ db }, query) {
  const where = { status: query.status, targetType: query.targetType };
  const [rows, total] = await Promise.all([
    db.report.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      ...pageWindow(query),
    }),
    db.report.count({ where }),
  ]);
  const items = [];
  for (const row of rows) items.push(toReport(row, await targetSummary(db, row)));
  return paged(items, total, query);
}

const ACTION_TARGET = { HIDE_REVIEW: 'REVIEW', REMOVE_LISTING: 'LISTING' };

/**
 * Resolves a report: dismiss it, hide the review, or remove the listing. An action
 * resolves every open report about the same thing. Audited, with the reason (I90).
 */
export async function resolveReport(deps, adminId, reportId, { action, reason }) {
  const { db, clock } = deps;
  const now = clock.now();
  const report = await db.report.findUnique({ where: { id: reportId } });
  if (!report) throw AppError.notFound('Report not found');
  if (report.status !== 'OPEN')
    throw new AppError(409, 'REPORT_RESOLVED', 'This report is already resolved');
  if (ACTION_TARGET[action] && ACTION_TARGET[action] !== report.targetType) {
    throw AppError.badRequest(
      `That action does not apply to a reported ${report.targetType.toLowerCase()}`,
    );
  }

  await db.$transaction(async (tx) => {
    if (action === 'HIDE_REVIEW') {
      await setReviewVisibility(tx, now, {
        reviewId: report.targetId,
        adminId,
        hidden: true,
        reason,
      });
    }
    if (action === 'REMOVE_LISTING') {
      const listing = await tx.listing.findUnique({ where: { id: report.targetId } });
      if (!listing) throw AppError.notFound('Listing not found');
      if (listing.status !== 'REMOVED') {
        await tx.listing.update({ where: { id: listing.id }, data: { status: 'REMOVED' } });
        await tx.listingStatusEvent.create({
          data: {
            listingId: listing.id,
            actorUserId: adminId,
            action: 'REMOVED',
            fromStatus: listing.status,
            toStatus: 'REMOVED',
            reason,
            createdAt: now,
          },
        });
      }
    }
    const status = action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED';
    await tx.report.updateMany({
      where:
        action === 'DISMISS'
          ? { id: report.id, status: 'OPEN' }
          : { targetType: report.targetType, targetId: report.targetId, status: 'OPEN' },
      data: {
        status,
        resolution: action,
        resolutionReason: reason,
        resolvedById: adminId,
        resolvedAt: now,
      },
    });
    await tx.adminAuditLog.create({
      data: {
        adminId,
        action: 'RESOLVE_REPORT',
        targetType: 'report',
        targetId: report.id,
        reason,
        details: { action, targetType: report.targetType, targetId: report.targetId },
        createdAt: now,
      },
    });
  });
  const updated = await db.report.findUniqueOrThrow({ where: { id: report.id } });
  return toReport(updated, await targetSummary(db, updated));
}
