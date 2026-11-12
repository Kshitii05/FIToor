export function Card({ className = '', children }) {
  return (
    <section
      className={`rounded-card border border-line bg-surface p-5 shadow-card sm:p-7 ${className}`}
    >
      {children}
    </section>
  );
}

/** Heading block for a card or page section. */
export function SectionHeading({ title, description, action }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
