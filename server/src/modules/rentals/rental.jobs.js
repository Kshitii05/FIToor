import {
  RENTAL_DUE_DAY_REMINDER_HOURS,
  RENTAL_RETURN_REMINDER_HOURS,
} from '../../config/policy.js';
import { addHours } from '../../lib/clock.js';
import { notifyBooking } from './rental.emails.js';
import {
  claimUnanswered,
  dueToExpire,
  expireBooking,
  loadBooking,
  notifyExpired,
  settleAfterInspectionWindow,
} from './rental.service.js';

// Rental deadlines, run on a schedule. Each step changes a booking only if it is
// still in the state the deadline belongs to and the deadline has passed, so a late
// or repeated run changes nothing more. Each notifies the people involved and has an
// admin path (rental.service.js).

/** Unanswered requests (24 h) and unpaid approvals (12 h) expire and free their dates. */
async function expireRequests(deps, now) {
  const due = await deps.db.rentalBooking.findMany({ where: dueToExpire(now) });
  let done = 0;
  for (const booking of due) {
    const expired = await deps.db.$transaction((tx) => expireBooking(tx, now, booking));
    if (expired) {
      done += 1;
      await notifyExpired(deps, booking.id);
    }
  }
  return done;
}

/** One reminder per booking for each moment: the day before, the due day, and overdue. */
async function remind(deps, now, { flag, from, until, kinds }) {
  const due = await deps.db.rentalBooking.findMany({
    where: {
      status: 'ACTIVE',
      [flag]: null,
      returnDueAt: { ...(from ? { lte: from } : {}), ...(until ? { gt: until } : {}) },
    },
    select: { id: true },
  });
  let done = 0;
  for (const { id } of due) {
    const { count } = await deps.db.rentalBooking.updateMany({
      where: { id, status: 'ACTIVE', [flag]: null },
      data: { [flag]: now },
    });
    if (count !== 1) continue;
    done += 1;
    const booking = await loadBooking(deps.db, id);
    for (const [recipient, kind] of kinds) await notifyBooking(deps, booking, recipient, kind);
  }
  return done;
}

async function eachDue(where, deps, step) {
  const due = await deps.db.rentalBooking.findMany({ where, select: { id: true } });
  let done = 0;
  for (const { id } of due) if (await step(deps, id)) done += 1;
  return done;
}

/** Every rental deadline, in one pass. Returns how many of each were handled. */
export async function runRentalJobs(deps) {
  const now = deps.clock.now();
  return {
    expired: await expireRequests(deps, now),
    remindedBefore: await remind(deps, now, {
      flag: 'remindedBeforeAt',
      from: addHours(now, RENTAL_RETURN_REMINDER_HOURS),
      until: addHours(now, RENTAL_DUE_DAY_REMINDER_HOURS),
      kinds: [['renter', 'returnTomorrow']],
    }),
    remindedDueDay: await remind(deps, now, {
      flag: 'remindedDueDayAt',
      from: addHours(now, RENTAL_DUE_DAY_REMINDER_HOURS),
      until: now,
      kinds: [['renter', 'returnToday']],
    }),
    overdue: await remind(deps, now, {
      flag: 'overdueNotifiedAt',
      from: now,
      kinds: [
        ['renter', 'overdueRenter'],
        ['owner', 'overdueOwner'],
      ],
    }),
    // 48 hours after the return with no claim: the deposit is refunded (SPEC 13).
    settled: await eachDue(
      { status: 'RETURNED', inspectionEndsAt: { lte: now } },
      deps,
      settleAfterInspectionWindow,
    ),
    // Claims the renter did not answer within 48 hours go to an admin.
    claimsToReview: await eachDue(
      { status: 'CLAIM_OPEN', claim: { status: 'OPEN', respondDueAt: { lte: now } } },
      deps,
      claimUnanswered,
    ),
  };
}
