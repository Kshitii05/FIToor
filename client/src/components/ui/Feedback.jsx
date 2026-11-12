const ALERT_TONES = {
  error: 'border-danger/25 bg-danger-soft text-danger-strong',
  success: 'border-success/25 bg-success-soft text-success',
  notice: 'border-notice/25 bg-notice-soft text-notice',
  info: 'border-accent/20 bg-accent-soft text-accent-strong',
};

/** A message block. Errors are announced immediately; other tones politely. */
export function Alert({ tone = 'info', title, children, className = '' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-field border px-4 py-3 text-sm ${ALERT_TONES[tone]} ${className}`}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? 'mt-1' : ''}>{children}</div>
    </div>
  );
}

const BADGE_TONES = {
  success: 'bg-success-soft text-success',
  notice: 'bg-notice-soft text-notice',
  neutral: 'bg-paper text-muted border border-line',
};

export function Badge({ tone = 'neutral', children }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}

/** Centered loading state for a page or section. */
export function Loading({ label = 'Loading' }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-muted">
      <Spinner />
      <span className="text-sm">{label}…</span>
    </div>
  );
}
