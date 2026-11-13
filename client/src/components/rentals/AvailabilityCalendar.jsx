import { useState } from 'react';
import { addDays, overlaps } from '../../lib/rentals.js';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const monthName = new Intl.DateTimeFormat('en-IN', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const monthStart = (date) => `${date.slice(0, 7)}-01`;
function nextMonth(start, step) {
  const [y, m] = start.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + step, 1)).toISOString().slice(0, 10);
}

/**
 * A month calendar of a rental listing. Taken days are struck through; with
 * `durationDays` and `onChange`, a free start day can be picked and the whole
 * rental is highlighted.
 */
export function AvailabilityCalendar({
  firstStartDate,
  lastStartDate,
  blocked,
  durationDays = 1,
  value,
  onChange,
}) {
  const [month, setMonth] = useState(monthStart(value ?? firstStartDate));
  const lastMonth = monthStart(lastStartDate);
  const firstMonth = monthStart(firstStartDate);

  const isTaken = (day) =>
    blocked.some((range) => overlaps(range, { startDate: day, endDate: day }));
  const canStart = (day) =>
    day >= firstStartDate &&
    day <= lastStartDate &&
    !blocked.some((range) =>
      overlaps(range, { startDate: day, endDate: addDays(day, durationDays - 1) }),
    );
  const selectedEnd = value ? addDays(value, durationDays - 1) : null;

  const [y, m] = month.split('-').map(Number);
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length }, (_, i) => addDays(month, i)),
  ];

  return (
    <div className="rounded-card border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          className="rounded-field px-2 py-1 text-sm text-ink hover:bg-paper disabled:opacity-30"
          aria-label="Previous month"
          disabled={month <= firstMonth}
          onClick={() => setMonth(nextMonth(month, -1))}
        >
          ‹
        </button>
        <p className="text-sm font-medium text-ink" aria-live="polite">
          {monthName.format(new Date(Date.UTC(y, m - 1, 1)))}
        </p>
        <button
          type="button"
          className="rounded-field px-2 py-1 text-sm text-ink hover:bg-paper disabled:opacity-30"
          aria-label="Next month"
          disabled={month >= lastMonth}
          onClick={() => setMonth(nextMonth(month, 1))}
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid">
        {WEEKDAYS.map((day) => (
          <span key={day} className="py-1 font-medium text-muted" role="columnheader">
            {day}
          </span>
        ))}
        {cells.map((day, index) => {
          if (!day) return <span key={`gap-${index}`} />;
          const taken = isTaken(day);
          const inSelection = value && day >= value && day <= selectedEnd;
          const pickable = onChange && canStart(day);
          const outside = day < firstStartDate || day > addDays(lastStartDate, durationDays - 1);
          return (
            <button
              key={day}
              type="button"
              disabled={!pickable}
              aria-pressed={day === value}
              aria-label={`${day}${taken ? ', taken' : ''}${inSelection ? ', in your rental' : ''}`}
              onClick={() => onChange?.(day)}
              className={`aspect-square rounded-field text-sm transition-colors ${
                inSelection
                  ? 'bg-accent font-semibold text-white'
                  : taken
                    ? 'bg-paper text-muted line-through'
                    : outside
                      ? 'text-line-strong'
                      : pickable
                        ? 'text-ink hover:bg-accent-soft'
                        : 'text-muted'
              }`}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          <span className="line-through">12</span> taken
        </span>
        {onChange ? (
          <span>
            <span className="inline-block size-2.5 rounded-sm bg-accent align-middle" /> your rental
          </span>
        ) : null}
      </p>
    </div>
  );
}
