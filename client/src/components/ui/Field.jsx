import { useId } from 'react';

const CONTROL =
  'block w-full rounded-field border bg-surface px-3.5 text-base text-ink placeholder:text-muted/70 ' +
  'transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';

function controlClass(error, extra = '') {
  return `${CONTROL} ${error ? 'border-danger' : 'border-line-strong'} ${extra}`;
}

/** Label, optional hint and error message around a form control. */
function FieldShell({ id, label, hint, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id, hint, error) {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export function TextField({ label, hint, error, prefix, className = '', ...props }) {
  const id = useId();
  const input = (
    <input
      id={id}
      className={controlClass(error, `min-h-11 ${prefix ? 'rounded-l-none' : ''} ${className}`)}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, hint, error)}
      {...props}
    />
  );

  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      {prefix ? (
        <div className="flex">
          <span className="inline-flex items-center rounded-l-field border border-r-0 border-line-strong bg-paper px-3 text-base text-muted">
            {prefix}
          </span>
          {input}
        </div>
      ) : (
        input
      )}
    </FieldShell>
  );
}

export function TextArea({ label, hint, error, className = '', rows = 3, ...props }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        rows={rows}
        className={controlClass(error, `py-2.5 ${className}`)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...props}
      />
    </FieldShell>
  );
}

/** An on/off setting with a label and description. */
export function Switch({ label, description, checked, onChange, disabled = false }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <p id={`${id}-label`} className="text-sm font-medium text-ink">
          {label}
        </p>
        {description ? (
          <p id={`${id}-description`} className="mt-0.5 text-sm text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
          checked ? 'bg-accent' : 'bg-line-strong'
        }`}
      >
        <span
          className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5.5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
