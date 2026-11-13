// Shared look of form controls, used by every field component.

const CONTROL =
  'block w-full rounded-field border bg-surface px-3.5 text-base text-ink placeholder:text-muted/70 ' +
  'transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 ' +
  'disabled:bg-paper disabled:text-muted';

export function controlClass(error, extra = '') {
  return `${CONTROL} ${error ? 'border-danger' : 'border-line-strong'} ${extra}`;
}

/** The id of the element that describes a control: its error if any, else its hint. */
export function describedBy(id, hint, error) {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}
