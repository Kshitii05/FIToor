import { Link } from 'react-router-dom';
import { Badge } from '../ui/index.js';
import { categoryLabel, conditionLabel, headlinePrice, statusInfo } from '../../lib/listings.js';
import { formatPaise } from '../../lib/money.js';

export function StatusBadge({ status }) {
  const { label, tone } = statusInfo(status);
  return <Badge tone={tone}>{label}</Badge>;
}

export function ListingPrice({ listing, className = '' }) {
  const { paise, note } = headlinePrice(listing);
  return (
    <p className={className}>
      <span className="font-semibold text-ink">{formatPaise(paise)}</span>
      {note ? <span className="text-sm text-muted"> {note}</span> : null}
    </p>
  );
}

/** A listing in a grid: cover photo, title, price and a few facts. Links to its page. */
export function ListingCard({ listing }) {
  const cover = listing.images[0];
  return (
    <Link
      to={`/listings/${listing.id}`}
      className="group block overflow-hidden rounded-card border border-line bg-surface shadow-card transition-shadow hover:shadow-lg"
    >
      <div className="relative aspect-[4/5] bg-paper">
        {cover ? (
          <img
            src={cover.url}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : null}
        <span className="absolute left-3 top-3 rounded-full bg-surface/95 px-2.5 py-0.5 text-xs font-medium text-ink">
          {listing.mode === 'SALE' ? 'For sale' : 'For rent'}
        </span>
      </div>
      <div className="p-4">
        <h3 className="line-clamp-2 font-medium text-ink">{listing.title}</h3>
        <ListingPrice listing={listing} className="mt-1" />
        <p className="mt-1 truncate text-sm text-muted">
          {categoryLabel(listing.category)} · {conditionLabel(listing.condition)} · {listing.size}
        </p>
      </div>
    </Link>
  );
}

export function ListingGrid({ listings }) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {listings.map((listing) => (
        <li key={listing.id}>
          <ListingCard listing={listing} />
        </li>
      ))}
    </ul>
  );
}
