import crypto from 'node:crypto';
import {
  HANDOVER_CODE_LENGTH,
  LATE_FEE_GRACE_HOURS,
  LATE_FEE_PERIOD_HOURS,
  RENTAL_REFUND_BPS_BEFORE_START,
  RENTAL_REFUND_BPS_FROM_START,
  RENTAL_RETURN_HOUR,
} from '../../config/policy.js';
import { addCalendarDays, addHours, atBusinessTime, businessDate } from '../../lib/clock.js';

// Rental rules that need no database: dates, the late fee and cancellation refunds.
// Dates are calendar days in the business time zone, written `YYYY-MM-DD`.

const MS_PER_HOUR = 60 * 60 * 1000;

/** A `YYYY-MM-DD` date as stored in a DATE column (midnight UTC), and back. */
export const toDateColumn = (date) => new Date(`${date}T00:00:00.000Z`);
export const fromDateColumn = (value) => value.toISOString().slice(0, 10);

/** The last day of a rental of `durationDays` starting on `startDate` (both inclusive). */
export const endDateFor = (startDate, durationDays) => addCalendarDays(startDate, durationDays - 1);

/** Due back by 8 pm (business time) on the last day. */
export const returnDueAtFor = (endDate) => atBusinessTime(endDate, RENTAL_RETURN_HOUR);

/**
 * The late fee for a return: nothing up to 24 hours after the due time, then one
 * daily fee for each started 24-hour period after that (SPEC 13).
 */
export function lateFeeFor({ returnDueAt, returnedAt, lateFeePerDayPaise }) {
  const graceEnds = addHours(returnDueAt, LATE_FEE_GRACE_HOURS).getTime();
  const late = new Date(returnedAt).getTime() - graceEnds;
  if (late <= 0) return 0;
  return Math.ceil(late / (LATE_FEE_PERIOD_HOURS * MS_PER_HOUR)) * lateFeePerDayPaise;
}

/**
 * What a renter gets back for cancelling a paid booking now: half the fee before
 * the start day, none of it from the start day; the deposit and delivery always.
 */
export function renterCancelRefund(booking, now) {
  const beforeStart = businessDate(now) < fromDateColumn(booking.startDate);
  const bps = beforeStart ? RENTAL_REFUND_BPS_BEFORE_START : RENTAL_REFUND_BPS_FROM_START;
  const feePaise = Math.floor((booking.feePaise * bps) / 10000);
  return {
    feePaise,
    depositPaise: booking.depositPaise,
    deliveryPaise: booking.deliveryChargePaise,
    totalPaise: feePaise + booking.depositPaise + booking.deliveryChargePaise,
  };
}

/**
 * What comes out of the deposit at settlement. Deductions stop at the deposit;
 * anything beyond it is recorded as owed and handled by an admin (I12).
 */
export function depositSettlement({ depositPaise, lateFeePaise, damagePaise }) {
  const charged = lateFeePaise + damagePaise;
  const deductedPaise = Math.min(depositPaise, charged);
  return {
    deductedPaise,
    owedPaise: charged - deductedPaise,
    refundPaise: depositPaise - deductedPaise,
  };
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function bookingRef() {
  let ref = 'RNT-';
  for (let i = 0; i < 8; i += 1) ref += REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)];
  return ref;
}

export const oneTimeCode = () =>
  String(crypto.randomInt(0, 10 ** HANDOVER_CODE_LENGTH)).padStart(HANDOVER_CODE_LENGTH, '0');

/** Compares a typed code with the stored one in constant time. */
export const codeMatches = (typed, stored) =>
  typeof typed === 'string' &&
  typeof stored === 'string' &&
  typed.length === stored.length &&
  crypto.timingSafeEqual(Buffer.from(typed), Buffer.from(stored));
