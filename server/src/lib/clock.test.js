import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  addDays,
  addHours,
  businessWeekday,
  createFixedClock,
  isBusinessDay,
  isPast,
  systemClock,
} from './clock.js';

// 2026-11-13 is a Friday. IST is UTC+05:30.
const FRIDAY_NOON_IST = '2026-11-13T06:30:00.000Z';

describe('clock', () => {
  it('system clock returns the current time', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('fixed clock stays put until set or advanced', () => {
    const clock = createFixedClock(FRIDAY_NOON_IST);
    expect(clock.now().toISOString()).toBe(FRIDAY_NOON_IST);
    expect(clock.now().toISOString()).toBe(FRIDAY_NOON_IST);

    clock.advance({ hours: 48 });
    expect(clock.now().toISOString()).toBe('2026-11-15T06:30:00.000Z');

    clock.advance({ days: 1, minutes: 30 });
    expect(clock.now().toISOString()).toBe('2026-11-16T07:00:00.000Z');

    clock.set('2027-01-01T00:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('fixed clock hands out copies, so callers cannot move it by mutation', () => {
    const clock = createFixedClock(FRIDAY_NOON_IST);
    clock.now().setUTCFullYear(1999);
    expect(clock.now().toISOString()).toBe(FRIDAY_NOON_IST);
  });

  it('adds hours and days without mutating the input', () => {
    const start = new Date(FRIDAY_NOON_IST);
    expect(addHours(start, 24).toISOString()).toBe('2026-11-14T06:30:00.000Z');
    expect(addDays(start, 7).toISOString()).toBe('2026-11-20T06:30:00.000Z');
    expect(start.toISOString()).toBe(FRIDAY_NOON_IST);
  });

  it('isPast compares a deadline with the injected clock', () => {
    const clock = createFixedClock(FRIDAY_NOON_IST);
    const deadline = addHours(clock.now(), 24);
    expect(isPast(deadline, clock)).toBe(false);
    clock.advance({ hours: 24 });
    expect(isPast(deadline, clock)).toBe(true);
  });

  it('rejects invalid dates', () => {
    expect(() => addHours('not a date', 1)).toThrow(TypeError);
  });
});

describe('business days', () => {
  it('treats Monday to Friday as business days', () => {
    expect(isBusinessDay('2026-11-09T06:30:00.000Z')).toBe(true); // Monday
    expect(isBusinessDay(FRIDAY_NOON_IST)).toBe(true);
    expect(isBusinessDay('2026-11-14T06:30:00.000Z')).toBe(false); // Saturday
    expect(isBusinessDay('2026-11-15T06:30:00.000Z')).toBe(false); // Sunday
  });

  it('decides the day in Asia/Kolkata, not UTC', () => {
    // Friday 20:00 UTC is already Saturday 01:30 in IST.
    expect(businessWeekday('2026-11-13T20:00:00.000Z')).toBe(6);
    expect(isBusinessDay('2026-11-13T20:00:00.000Z')).toBe(false);
    // Sunday 19:00 UTC is already Monday 00:30 in IST.
    expect(businessWeekday('2026-11-15T19:00:00.000Z')).toBe(1);
    expect(isBusinessDay('2026-11-15T19:00:00.000Z')).toBe(true);
  });

  it('adds business days within a week', () => {
    // Monday + 3 business days = Thursday, same time of day.
    expect(addBusinessDays('2026-11-09T06:30:00.000Z', 3).toISOString()).toBe(
      '2026-11-12T06:30:00.000Z',
    );
  });

  it('skips the weekend', () => {
    // Friday + 1 = Monday; Friday + 3 = Wednesday.
    expect(addBusinessDays(FRIDAY_NOON_IST, 1).toISOString()).toBe('2026-11-16T06:30:00.000Z');
    expect(addBusinessDays(FRIDAY_NOON_IST, 3).toISOString()).toBe('2026-11-18T06:30:00.000Z');
  });

  it('starts counting from Monday when the period begins on a weekend', () => {
    // Saturday + 1 = Monday; Saturday + 3 = Wednesday.
    expect(addBusinessDays('2026-11-14T06:30:00.000Z', 1).toISOString()).toBe(
      '2026-11-16T06:30:00.000Z',
    );
    expect(addBusinessDays('2026-11-14T06:30:00.000Z', 3).toISOString()).toBe(
      '2026-11-18T06:30:00.000Z',
    );
  });

  it('adding zero business days returns the same instant', () => {
    expect(addBusinessDays(FRIDAY_NOON_IST, 0).toISOString()).toBe(FRIDAY_NOON_IST);
  });

  it('rejects negative or fractional counts', () => {
    expect(() => addBusinessDays(FRIDAY_NOON_IST, -1)).toThrow(RangeError);
    expect(() => addBusinessDays(FRIDAY_NOON_IST, 1.5)).toThrow(RangeError);
  });
});
