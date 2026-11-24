import crypto from 'node:crypto';
import { DISPUTE_RESPONSE_HOURS } from '../../config/policy.js';
import { addHours } from '../../lib/clock.js';
import { notifyDispute } from './dispute.emails.js';

// The smallest piece of the dispute module: opening one, inside the caller's
// transaction. Orders and rentals use it without depending on the rest of the
// module (disputes.service.js), which in turn calls back into them for effects.

/** Statuses of a dispute that is not finished. */
export const UNFINISHED = ['OPEN', 'UNDER_REVIEW', 'DECIDED', 'APPEALED'];

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function disputeRef() {
  let ref = 'DSP-';
  for (let i = 0; i < 8; i += 1) ref += REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)];
  return ref;
}

/** Photo records for evidence: url, storage id (to delete later) and when taken. */
export const evidencePhotos = (stored, now) =>
  stored.map((photo) => ({
    url: photo.url,
    storageId: photo.storageId,
    takenAt: now.toISOString(),
  }));

/**
 * Opens a dispute in `tx`. The respondent has 48 hours to answer (I80). `evidence`
 * is the opener's first entry ({ text, photos }); `authorId` null means the system.
 */
export async function openDispute(
  tx,
  now,
  {
    kind,
    orderId,
    bookingId,
    claimantId,
    respondentId,
    openedByClaimant = true,
    evidence,
    ...fields
  },
) {
  const dispute = await tx.dispute.create({
    data: {
      ref: disputeRef(),
      kind,
      orderId: orderId ?? null,
      bookingId: bookingId ?? null,
      claimantId,
      respondentId,
      openedByClaimant,
      respondDueAt: addHours(now, DISPUTE_RESPONSE_HOURS),
      createdAt: now,
      ...fields,
    },
  });
  if (evidence) {
    await tx.disputeEvidence.create({
      data: {
        disputeId: dispute.id,
        authorId: evidence.authorId ?? null,
        role: evidence.authorId ? 'CLAIMANT' : 'SYSTEM',
        text: evidence.text ?? null,
        photos: evidence.photos ?? [],
        createdAt: now,
      },
    });
  }
  return dispute;
}

/** Adds an entry to a dispute's record in `tx`. */
export function recordEvidence(tx, now, disputeId, { authorId, role, text, photos }) {
  return tx.disputeEvidence.create({
    data: {
      disputeId,
      authorId: authorId ?? null,
      role,
      text: text ?? null,
      photos: photos ?? [],
      createdAt: now,
    },
  });
}

/** After an opening transaction commits: acknowledge it to the opener, ask the other side. */
export async function announceOpened(deps, where) {
  const dispute = await deps.db.dispute.findFirst({ where, orderBy: { createdAt: 'desc' } });
  if (!dispute) return;
  if (dispute.openedByClaimant) await notifyDispute(deps, dispute, 'claimant', 'opened');
  await notifyDispute(deps, dispute, 'respondent', 'openedAgainst');
}

/** The unfinished dispute about an order or booking, if any. */
export const unfinishedDispute = (db, where) =>
  db.dispute.findFirst({ where: { ...where, status: { in: UNFINISHED } } });
