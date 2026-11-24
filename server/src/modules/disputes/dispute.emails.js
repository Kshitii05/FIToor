import { APP_NAME } from '../../config/app.js';
import { BUSINESS_TIME_ZONE } from '../../config/policy.js';

// Dispute emails. The spec asks for an acknowledgement within 24 hours (SPEC 15):
// the opener hears at once. In-app notifications arrive with Step 9.

const when = new Intl.DateTimeFormat('en-IN', {
  timeZone: BUSINESS_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});
const at = (date) => `${when.format(date)} (India time)`;

const messages = {
  opened: (d) => ({
    subject: `${APP_NAME}: dispute ${d.ref} opened`,
    text: `We have your report (${d.ref}). The other side has until ${at(d.respondDueAt)} to answer; then our team reviews it, usually within 5 business days.`,
  }),
  openedAgainst: (d) => ({
    subject: `${APP_NAME}: a dispute needs your answer (${d.ref})`,
    text: `A dispute (${d.ref}) was opened about your transaction. Agree to it or add your side with photos by ${at(d.respondDueAt)}; after that our team decides.`,
  }),
  underReview: (d) => ({
    subject: `${APP_NAME}: dispute ${d.ref} is with our team`,
    text: `Our team is reviewing dispute ${d.ref} and aims to decide within 5 business days. You can still add evidence.`,
  }),
  evidenceAdded: (d) => ({
    subject: `${APP_NAME}: new evidence on ${d.ref}`,
    text: `The other side added to dispute ${d.ref}. You can read it in your disputes.`,
  }),
  decided: (d) => ({
    subject: `${APP_NAME}: decision on ${d.ref}`,
    text: `Our team decided dispute ${d.ref}. Either side can appeal once, with a reason, until ${at(d.appealDueAt)}; after that the decision takes effect.`,
  }),
  appealed: (d) => ({
    subject: `${APP_NAME}: ${d.ref} was appealed`,
    text: `The decision on dispute ${d.ref} was appealed. Our team will look again; that decision is final.`,
  }),
  closed: (d) => ({
    subject: `${APP_NAME}: ${d.ref} is closed`,
    text: `The decision on dispute ${d.ref} has taken effect. Any refund is on its way to the original payment method.`,
  }),
  resolved: (d) => ({
    subject: `${APP_NAME}: ${d.ref} is resolved`,
    text: `Dispute ${d.ref} was settled by agreement and has taken effect.`,
  }),
  withdrawn: (d) => ({
    subject: `${APP_NAME}: ${d.ref} was withdrawn`,
    text: `Dispute ${d.ref} was withdrawn by the person who opened it.`,
  }),
};

/** Emails one side of a dispute ('claimant' or 'respondent'). Failures are only logged. */
export async function notifyDispute(deps, dispute, side, kind) {
  const { db, emailSender, logger } = deps;
  try {
    const user = await db.user.findUnique({
      where: { id: side === 'claimant' ? dispute.claimantId : dispute.respondentId },
      select: { email: true, status: true },
    });
    if (!user || user.status === 'DELETED') return;
    await emailSender.send({ to: user.email, ...messages[kind](dispute) });
  } catch (error) {
    logger.error(error);
  }
}

export const notifyBoth = async (deps, dispute, kind) => {
  await notifyDispute(deps, dispute, 'claimant', kind);
  await notifyDispute(deps, dispute, 'respondent', kind);
};
