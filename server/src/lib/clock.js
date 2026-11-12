// Shared clock and business-day calendar (DECISIONS I9).
//
// Timestamps are stored and passed around as UTC instants (Date). Calendar questions
// ("is this a business day?") are answered in the business time zone from config.
// Code that needs the current time takes a clock instead of calling `new Date()`,
// so deadline rules can be tested with a fixed clock.

import { BUSINESS_TIME_ZONE, BUSINESS_WEEKDAYS } from '../config/policy.js';

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export const systemClock = Object.freeze({
  now: () => new Date(),
});

/** A clock that only moves when told to. For tests. */
export function createFixedClock(start) {
  let current = toDate(start);
  return {
    now: () => new Date(current.getTime()),
    set: (instant) => {
      current = toDate(instant);
    },
    advance: ({ days = 0, hours = 0, minutes = 0, seconds = 0 } = {}) => {
      current = new Date(
        current.getTime() +
          days * MS_PER_DAY +
          hours * MS_PER_HOUR +
          minutes * MS_PER_MINUTE +
          seconds * 1000,
      );
    },
  };
}

export function addMinutes(instant, minutes) {
  return new Date(toDate(instant).getTime() + minutes * MS_PER_MINUTE);
}

export function addHours(instant, hours) {
  return new Date(toDate(instant).getTime() + hours * MS_PER_HOUR);
}

/** Adds whole 24-hour periods. The business time zone has no daylight saving shifts. */
export function addDays(instant, days) {
  return new Date(toDate(instant).getTime() + days * MS_PER_DAY);
}

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  weekday: 'short',
});
const ISO_WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** ISO weekday (1 = Monday ... 7 = Sunday) of the instant in the business time zone. */
export function businessWeekday(instant) {
  return ISO_WEEKDAY[weekdayFormatter.format(toDate(instant))];
}

export function isBusinessDay(instant) {
  return BUSINESS_WEEKDAYS.includes(businessWeekday(instant));
}

/**
 * The instant `count` business days after `instant`, at the same time of day.
 * Steps forward one day at a time and counts only the business days it lands on,
 * so a period starting on a Saturday or Sunday begins counting from Monday.
 */
export function addBusinessDays(instant, count) {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError('count must be a non-negative integer');
  }
  let result = toDate(instant);
  let remaining = count;
  while (remaining > 0) {
    result = addDays(result, 1);
    if (isBusinessDay(result)) remaining -= 1;
  }
  return result;
}

export function isPast(deadline, clock = systemClock) {
  return clock.now().getTime() >= toDate(deadline).getTime();
}

function toDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Invalid date');
  return date;
}
