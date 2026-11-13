import { Button } from './Button.jsx';

/** Previous / next controls for a paged list. Renders nothing for a single page. */
export function Pagination({ page, totalPages, onChange, disabled = false }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-3">
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </Button>
      <p className="text-sm text-muted" aria-live="polite">
        Page {page} of {totalPages}
      </p>
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled || page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

/** Shown in place of a list that has nothing in it. */
export function EmptyState({ title, children, action }) {
  return (
    <div className="rounded-card border border-dashed border-line-strong px-6 py-12 text-center">
      <p className="font-display text-xl font-semibold text-ink">{title}</p>
      {children ? <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** A row of filter buttons where one is selected. */
export function FilterTabs({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`min-h-9 rounded-full border px-3.5 text-sm font-medium transition-colors ${
              selected
                ? 'border-accent bg-accent text-white'
                : 'border-line-strong bg-surface text-ink hover:bg-paper'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
