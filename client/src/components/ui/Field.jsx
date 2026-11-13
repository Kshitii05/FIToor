import { useId } from 'react';
import { controlClass, describedBy } from './fieldStyles.js';

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

/** Text input. `prefix` and `suffix` show fixed text beside it, such as ₹ or km. */
export function TextField({ label, hint, error, prefix, suffix, className = '', ...props }) {
  const id = useId();
  const rounding = `${prefix ? 'rounded-l-none' : ''} ${suffix ? 'rounded-r-none' : ''}`;
  const input = (
    <input
      id={id}
      className={controlClass(error, `min-h-11 min-w-0 ${rounding} ${className}`)}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, hint, error)}
      {...props}
    />
  );
  const addOn =
    'inline-flex items-center border border-line-strong bg-paper px-3 text-base text-muted';

  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      {prefix || suffix ? (
        <div className="flex">
          {prefix ? <span className={`${addOn} rounded-l-field border-r-0`}>{prefix}</span> : null}
          {input}
          {suffix ? <span className={`${addOn} rounded-r-field border-l-0`}>{suffix}</span> : null}
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

/** Drop-down. `options` is a list of `{ value, label }`. */
export function SelectField({
  label,
  hint,
  error,
  options,
  placeholder,
  className = '',
  ...props
}) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <select
        id={id}
        className={controlClass(error, `min-h-11 ${className}`)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...props}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map(({ value, label: optionLabel }) => (
          <option key={value} value={value}>
            {optionLabel}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function Checkbox({ label, description, checked, onChange, disabled = false }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-1 size-4 shrink-0 accent-accent"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={description ? `${id}-description` : undefined}
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {description ? (
          <p id={`${id}-description`} className="mt-0.5 text-sm text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A small set of mutually exclusive choices shown as cards. */
export function ChoiceCards({ legend, options, value, onChange, error }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-ink">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer gap-3 rounded-field border p-4 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                selected ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface'
              }`}
            >
              <input
                type="radio"
                name={name}
                className="mt-1 size-4 shrink-0 accent-accent"
                checked={selected}
                onChange={() => onChange(option.value)}
              />
              <span>
                <span className="block text-sm font-semibold text-ink">{option.label}</span>
                <span className="mt-0.5 block text-sm text-muted">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
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
