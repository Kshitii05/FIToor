import { Link } from 'react-router-dom';
import { Spinner } from './Feedback.jsx';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-field font-medium transition-colors ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

const VARIANTS = {
  primary: 'bg-accent text-white hover:bg-accent-strong',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-paper',
  ghost: 'text-accent hover:bg-accent-soft',
  danger: 'bg-danger text-white hover:bg-danger-strong',
};

const SIZES = {
  md: 'min-h-11 px-4 text-sm',
  sm: 'min-h-9 px-3 text-sm',
};

function classes({ variant = 'primary', size = 'md', block = false, className = '' }) {
  return [BASE, VARIANTS[variant], SIZES[size], block ? 'w-full' : '', className].join(' ');
}

export function Button({
  variant,
  size,
  block,
  className,
  loading = false,
  disabled = false,
  type = 'button',
  children,
  ...props
}) {
  return (
    <button
      type={type}
      className={classes({ variant, size, block, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

/** A router link that looks like a button. */
export function ButtonLink({ variant, size, block, className, children, ...props }) {
  return (
    <Link className={classes({ variant, size, block, className })} {...props}>
      {children}
    </Link>
  );
}
