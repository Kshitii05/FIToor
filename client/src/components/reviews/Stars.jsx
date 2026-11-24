import { useId } from 'react';

/** Read-only stars, e.g. "★★★★☆ 4.2". */
export function Stars({ value, size = 'text-base' }) {
  if (value === null || value === undefined) return null;
  const full = Math.round(value);
  return (
    <span
      className={`${size} text-accent`}
      aria-label={`${value} out of 5 stars`}
      title={`${value} out of 5`}
    >
      <span aria-hidden="true">
        {'★'.repeat(full)}
        <span className="text-line-strong">{'★'.repeat(5 - full)}</span>
      </span>
    </span>
  );
}

/** Pick 1 to 5 stars: a radio group, so it works with the keyboard. */
export function StarInput({ label, value, onChange }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-ink">{label}</legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className={`block text-2xl leading-none transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent ${
                value >= n ? 'text-accent' : 'text-line-strong hover:text-accent/60'
              }`}
            >
              ★
            </span>
            <span className="sr-only">
              {n} star{n > 1 ? 's' : ''}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
