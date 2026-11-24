import { APP_NAME } from '../../config/app.js';
import { BUSINESS_TIME_ZONE } from '../../config/policy.js';
import { formatPaise } from '../orders/order.format.js';
import { fromDateColumn } from './rental.rules.js';

// Rental emails (SPEC 9: approval or rejection, confirmation, the day before return,
// the return date, overdue). In-app notifications arrive with Step 9.

const when = new Intl.DateTimeFormat('en-IN', {
  timeZone: BUSINESS_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});
const at = (date) => `${when.format(date)} (India time)`;
const dates = (b) => `${fromDateColumn(b.startDate)} to ${fromDateColumn(b.endDate)}`;
const name = (b) => `${b.ref} (${b.title})`;
/** The owner's damage claim on a booking, from its deposit dispute. */
const claimOf = (b) =>
  (b.disputes ?? []).findLast((d) => d.kind === 'RENTAL_DEPOSIT' && d.claimedDamagePaise !== null);

const messages = {
  requestedOwner: (b) => ({
    subject: `${APP_NAME}: rental request ${b.ref}`,
    text: `Someone wants to rent ${b.title} from ${dates(b)}. Approve or decline by ${at(b.holdExpiresAt)}; the dates are held until then.`,
  }),
  requestedRenter: (b) => ({
    subject: `${APP_NAME}: request ${b.ref} sent`,
    text: `Your request for ${b.title} (${dates(b)}) was sent. The owner has until ${at(b.holdExpiresAt)} to answer. You pay only after they approve.`,
  }),
  approvedRenter: (b) => ({
    subject: `${APP_NAME}: ${b.ref} approved, please pay`,
    text: `The owner approved your rental of ${b.title}. Pay ${formatPaise(b.totalPaise)} (rental ${formatPaise(b.feePaise)}, refundable deposit ${formatPaise(b.depositPaise)}${b.deliveryChargePaise ? `, delivery ${formatPaise(b.deliveryChargePaise)}` : ''}) by ${at(b.paymentDueAt)} to confirm it.`,
  }),
  declinedRenter: (b) => ({
    subject: `${APP_NAME}: ${b.ref} was declined`,
    text: `The owner declined your request for ${b.title}. You have not been charged.`,
  }),
  expiredRenter: (b) => ({
    subject: `${APP_NAME}: ${b.ref} expired`,
    text: `Your rental request ${name(b)} expired before it was ${b.approvedAt ? 'paid' : 'approved'}, and the dates were released. You have not been charged.`,
  }),
  expiredOwner: (b) => ({
    subject: `${APP_NAME}: ${b.ref} expired`,
    text: `The rental request ${name(b)} expired and its dates are free again.`,
  }),
  confirmedRenter: (b) => ({
    subject: `${APP_NAME}: ${b.ref} is booked`,
    text: `Your rental of ${b.title} for ${dates(b)} is confirmed. Show your handover code when you receive it. It is due back by ${at(b.returnDueAt)}.`,
  }),
  confirmedOwner: (b) => ({
    subject: `${APP_NAME}: ${b.ref} is booked`,
    text: `${b.title} is booked for ${dates(b)}. At handover, ask for the renter's code and take at least 2 photos of its condition.`,
  }),
  cancelled: (b) => ({
    subject: `${APP_NAME}: ${b.ref} was cancelled`,
    text: `The rental ${name(b)} was cancelled. Any refund due is on its way to the original payment method.`,
  }),
  handedOverRenter: (b) => ({
    subject: `${APP_NAME}: enjoy ${b.title}`,
    text: `You have ${b.title}. Please return it by ${at(b.returnDueAt)}. Late returns cost ${formatPaise(b.lateFeePerDayPaise)} for each started day after a 24-hour grace period.`,
  }),
  returnTomorrow: (b) => ({
    subject: `${APP_NAME}: ${b.title} is due back tomorrow`,
    text: `Rental ${b.ref} is due back by ${at(b.returnDueAt)}.`,
  }),
  returnToday: (b) => ({
    subject: `${APP_NAME}: ${b.title} is due back today`,
    text: `Rental ${b.ref} is due back today by ${at(b.returnDueAt)}. Ask the owner for their return code when you hand it back.`,
  }),
  overdueRenter: (b) => ({
    subject: `${APP_NAME}: ${b.title} is overdue`,
    text: `Rental ${b.ref} was due back by ${at(b.returnDueAt)}. After a 24-hour grace period a late fee of ${formatPaise(b.lateFeePerDayPaise)} applies for each started day.`,
  }),
  overdueOwner: (b) => ({
    subject: `${APP_NAME}: ${b.title} has not come back yet`,
    text: `Rental ${b.ref} was due back by ${at(b.returnDueAt)}. If it does not come back, you can report it to us 3 days after the due time.`,
  }),
  returnedOwner: (b) => ({
    subject: `${APP_NAME}: ${b.ref} is back`,
    text: `${b.title} has been returned. Check it by ${at(b.inspectionEndsAt)}: confirm it is fine, or report damage with photos. If you do neither, the deposit is refunded in full.`,
  }),
  returnedRenter: (b) => ({
    subject: `${APP_NAME}: return of ${b.ref} recorded`,
    text: `Thank you for returning ${b.title}.${b.lateFeePaise ? ` It was late, so a late fee of ${formatPaise(b.lateFeePaise)} applies.` : ''} The owner has until ${at(b.inspectionEndsAt)} to check it; then your deposit is settled.`,
  }),
  claimFiledRenter: (b) => ({
    subject: `${APP_NAME}: damage reported on ${b.ref}`,
    text: `The owner reported damage on ${b.title} and claims ${formatPaise(claimOf(b)?.claimedDamagePaise ?? 0)} from the deposit. Accept or answer it by ${at(claimOf(b)?.respondDueAt ?? new Date(0))}; if you do not answer, our team decides.`,
  }),
  lateFeeDisputedOwner: (b) => ({
    subject: `${APP_NAME}: the renter disputes the late fee on ${b.ref}`,
    text: `The renter disputes the late fee of ${formatPaise(b.lateFeePaise ?? 0)} on ${b.ref}. Our team will decide it when the deposit is settled.`,
  }),
  sentToReview: (b) => ({
    subject: `${APP_NAME}: ${b.ref} is being reviewed`,
    text: `Our team is reviewing rental ${b.ref} and will decide how the deposit is settled. We will email you.`,
  }),
  settledRenter: (b) => ({
    subject: `${APP_NAME}: deposit for ${b.ref}`,
    text: `Your deposit of ${formatPaise(b.depositPaise)} for ${b.ref} is settled: ${formatPaise(b.depositDeductedPaise)} deducted${b.owedPaise ? `, and ${formatPaise(b.owedPaise)} more is owed, which our team will contact you about` : ''}. ${b.depositPaise - b.depositDeductedPaise > 0 ? `${formatPaise(b.depositPaise - b.depositDeductedPaise)} is being refunded.` : 'Nothing is left to refund.'}`,
  }),
  refunded: (b, amountPaise) => ({
    subject: `${APP_NAME}: refund for ${b.ref}`,
    text: `A refund of ${formatPaise(amountPaise)} for rental ${b.ref} has been sent to your original payment method. It may take a few days to show.`,
  }),
  completedOwner: (b) => ({
    subject: `${APP_NAME}: ${b.ref} is complete`,
    text: `Rental ${b.ref} is complete and will be included in your next payout.`,
  }),
};

/**
 * Sends one of the messages above to the booking's renter or owner. A failure is
 * logged and never undoes the change that triggered it.
 */
export async function notifyBooking(deps, booking, recipient, kind, ...args) {
  const { db, emailSender, logger } = deps;
  try {
    const user = await db.user.findUnique({
      where: { id: recipient === 'renter' ? booking.renterId : booking.ownerId },
      select: { email: true, status: true },
    });
    if (!user || user.status === 'DELETED') return;
    await emailSender.send({ to: user.email, ...messages[kind](booking, ...args) });
  } catch (error) {
    logger.error(error);
  }
}
