import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/authContext.js';
import { LikeButton } from '../components/listings/LikeButton.jsx';
import { AddToCart } from '../components/orders/AddToCart.jsx';
import { ClosedDates } from '../components/rentals/ClosedDates.jsx';
import { RentPanel } from '../components/rentals/RentPanel.jsx';
import { StatusBadge } from '../components/listings/ListingCard.jsx';
import { Alert, Button, ButtonLink, Card, Loading } from '../components/ui/index.js';
import { api } from '../lib/api.js';
import { categoryLabel, conditionLabel, daysLabel } from '../lib/listings.js';
import { formatPaise } from '../lib/money.js';
import { useListing } from '../lib/useListing.js';
import { AreaMap } from '../components/map/Maps.jsx';
import { useOrigin } from '../location/originContext.js';
import { distanceLabel } from '../lib/location.js';

function Gallery({ images, title }) {
  const [selected, setSelected] = useState(0);
  const current = images[Math.min(selected, images.length - 1)];

  return (
    <div>
      <div className="aspect-[4/5] overflow-hidden rounded-card border border-line bg-paper">
        <img
          src={current.url}
          alt={`${title}, photo ${selected + 1} of ${images.length}`}
          className="size-full object-cover"
        />
      </div>
      {images.length > 1 ? (
        <ul className="mt-3 grid grid-cols-6 gap-2 sm:grid-cols-8">
          {images.map((image, index) => (
            <li key={image.id}>
              <button
                type="button"
                aria-label={`Show photo ${index + 1}`}
                aria-current={index === selected ? 'true' : undefined}
                onClick={() => setSelected(index)}
                className={`block aspect-square w-full overflow-hidden rounded-field border-2 transition-colors ${
                  index === selected
                    ? 'border-accent'
                    : 'border-transparent hover:border-line-strong'
                }`}
              >
                <img src={image.url} alt="" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Facts({ listing }) {
  const facts = [
    ['Category', categoryLabel(listing.category)],
    ['Condition', conditionLabel(listing.condition)],
    ['Brand', listing.brand],
    ['Size', listing.size],
    ['Colour', listing.colour],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {facts.map(([term, value]) => (
        <div key={term}>
          <dt className="text-sm text-muted">{term}</dt>
          <dd className="break-words font-medium text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SalePricing({ sale }) {
  return (
    <div>
      <p className="font-display text-3xl font-semibold text-ink">{formatPaise(sale.pricePaise)}</p>
      <p className="mt-1 text-sm text-muted">
        {sale.quantity > 1
          ? `${sale.quantity} available`
          : sale.quantity === 1
            ? '1 available'
            : 'Sold out'}
      </p>
    </div>
  );
}

function RentPricing({ rent }) {
  return (
    <div>
      <table className="w-full text-left">
        <caption className="mb-2 text-left text-sm font-medium text-ink">Rental packages</caption>
        <tbody className="divide-y divide-line border-y border-line">
          {rent.packages.map((option) => (
            <tr key={option.id}>
              <th scope="row" className="py-2.5 font-normal text-ink">
                {daysLabel(option.durationDays)}
              </th>
              <td className="py-2.5 text-right font-semibold text-ink">
                {formatPaise(option.pricePaise)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-3 space-y-1 text-sm text-muted">
        <li>
          Refundable security deposit:{' '}
          <span className="font-medium text-ink">{formatPaise(rent.depositPaise)}</span>, collected
          with the rental fee and refunded after return and inspection.
        </li>
        <li>
          {rent.lateFeePerDayPaise > 0 ? (
            <>
              Late fee:{' '}
              <span className="font-medium text-ink">
                {formatPaise(rent.lateFeePerDayPaise)} per day
              </span>
              , for each day started after a 24-hour grace period.
            </>
          ) : (
            'No late fee.'
          )}
        </li>
      </ul>
    </div>
  );
}

function Fulfilment({ listing }) {
  return (
    <ul className="space-y-1 text-sm text-ink">
      {listing.pickup ? <li>Local pickup available</li> : null}
      {listing.delivery ? (
        <li>
          Home delivery within {listing.delivery.radiusKm} km ·{' '}
          {listing.delivery.chargePaise > 0
            ? `${formatPaise(listing.delivery.chargePaise)} delivery charge`
            : 'free delivery'}
        </li>
      ) : null}
    </ul>
  );
}

function OwnerControls({ listing, onChange }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function changeStatus(action) {
    setBusy(action);
    setError(null);
    try {
      onChange((await api(`/listings/${listing.id}/${action}`, { method: 'POST' })).listing);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    setError(null);
    try {
      await api(`/listings/${listing.id}`, { method: 'DELETE' });
      navigate('/my-listings', { state: { notice: `“${listing.title}” was deleted.` } });
    } catch (failure) {
      setError(failure.message);
      setBusy(null);
    }
  }

  return (
    <Card className="border-accent/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink">This is your listing</p>
        <StatusBadge status={listing.status} />
      </div>

      {listing.status === 'UNDER_REVIEW' ? (
        <p className="mt-2 text-sm text-muted">
          It is hidden from others while it is being reviewed.
        </p>
      ) : null}
      {listing.status === 'REMOVED' ? (
        <p className="mt-2 text-sm text-muted">
          It was removed for breaking the marketplace rules and is hidden from others.
        </p>
      ) : null}
      {listing.status === 'PAUSED' ? (
        <p className="mt-2 text-sm text-muted">It is hidden from others until you activate it.</p>
      ) : null}

      {error ? (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {listing.status !== 'REMOVED' ? (
          <ButtonLink to={`/listings/${listing.id}/edit`} variant="secondary" size="sm">
            Edit
          </ButtonLink>
        ) : null}
        {listing.status === 'ACTIVE' ? (
          <Button
            variant="secondary"
            size="sm"
            loading={busy === 'pause'}
            disabled={busy !== null}
            onClick={() => changeStatus('pause')}
          >
            Pause
          </Button>
        ) : null}
        {listing.status === 'PAUSED' ? (
          <Button
            size="sm"
            loading={busy === 'activate'}
            disabled={busy !== null}
            onClick={() => changeStatus('activate')}
          >
            Activate
          </Button>
        ) : null}
        {confirmingDelete ? (
          <>
            <Button
              variant="danger"
              size="sm"
              loading={busy === 'delete'}
              disabled={busy !== null}
              onClick={remove}
            >
              Yes, delete it
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => setConfirmingDelete(false)}
            >
              Keep it
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete…
          </Button>
        )}
      </div>
      {confirmingDelete ? (
        <p className="mt-2 text-sm text-muted">Deleting cannot be undone.</p>
      ) : null}
    </Card>
  );
}

function SellerCard({ seller }) {
  return (
    <Link
      to={`/users/${seller.id}`}
      className="flex items-center gap-3 rounded-field border border-line p-3 transition-colors hover:bg-paper"
    >
      {seller.photoUrl ? (
        <img src={seller.photoUrl} alt="" className="size-11 rounded-full object-cover" />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display font-semibold text-accent-strong"
        >
          {seller.displayName[0]?.toUpperCase()}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">{seller.displayName}</span>
        <span className="block truncate text-sm text-muted">
          {seller.locality ?? 'View profile'}
        </span>
      </span>
    </Link>
  );
}

export default function ListingDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const { originQuery } = useOrigin();
  const { loading, listing, error, setListing } = useListing(id, originQuery);

  if (loading) return <Loading label="Loading listing" />;

  if (error) {
    const missing = error.status === 404 || error.status === 400;
    return (
      <div className="mx-auto max-w-md">
        <Alert
          tone={missing ? 'notice' : 'error'}
          title={missing ? 'Listing not found' : undefined}
        >
          {missing ? 'This listing is no longer available.' : error.message}
        </Alert>
        <ButtonLink to="/" variant="secondary" className="mt-5">
          Back to home
        </ButtonLink>
      </div>
    );
  }

  const isOwner = user?.id === listing.seller.id;

  return (
    <article>
      {location.state?.notice ? (
        <Alert tone="success" className="mb-6">
          {location.state.notice}
        </Alert>
      ) : null}

      <div className="grid gap-8 md:grid-cols-2">
        {/* Remounted per listing so the selected photo starts at the cover. */}
        <Gallery key={listing.id} images={listing.images} title={listing.title} />

        <div className="space-y-6">
          <header>
            <p className="text-sm font-medium uppercase tracking-widest text-accent">
              {listing.mode === 'SALE' ? 'For sale' : 'For rent'}
            </p>
            <h1 className="mt-2 break-words font-display text-3xl font-semibold tracking-tight text-ink">
              {listing.title}
            </h1>
            {isOwner ? null : (
              <div className="mt-4">
                <LikeButton key={listing.id} listing={listing} />
              </div>
            )}
          </header>

          {isOwner ? <OwnerControls listing={listing} onChange={setListing} /> : null}

          {listing.sale ? <SalePricing sale={listing.sale} /> : <RentPricing rent={listing.rent} />}

          {isOwner ? null : <AddToCart key={listing.id} listing={listing} />}
          {listing.mode === 'RENT' && !isOwner ? (
            <RentPanel key={`rent-${listing.id}`} listing={listing} />
          ) : null}
          {listing.mode === 'RENT' && isOwner ? (
            <ClosedDates key={`closed-${listing.id}`} listing={listing} />
          ) : null}

          <Facts listing={listing} />

          <section>
            <h2 className="text-sm font-medium text-ink">Description</h2>
            <p className="mt-1 whitespace-pre-line break-words text-ink">{listing.description}</p>
          </section>

          <section>
            <h2 className="mb-1 text-sm font-medium text-ink">Getting it</h2>
            <Fulfilment listing={listing} />
            {listing.deliversToYou === true ? (
              <p className="mt-1 text-sm font-medium text-success">Delivers to where you are</p>
            ) : null}
          </section>

          {listing.location ? (
            <section>
              <h2 className="mb-1 text-sm font-medium text-ink">Where it is</h2>
              <p className="mb-2 text-sm text-muted">
                Around {listing.location.locality}
                {listing.distanceKm !== null && listing.distanceKm !== undefined
                  ? ` · ${distanceLabel(listing.distanceKm)}`
                  : ''}
              </p>
              <AreaMap point={listing.location} />
              <p className="mt-2 text-xs text-muted">
                {isOwner
                  ? 'Others see this area, not your exact pin. You can move the pin on the edit page.'
                  : 'The circle shows the area, not the exact spot.'}
              </p>
            </section>
          ) : null}

          <section>
            <h2 className="mb-2 text-sm font-medium text-ink">
              {listing.mode === 'SALE' ? 'Seller' : 'Owner'}
            </h2>
            <SellerCard seller={listing.seller} />
          </section>
        </div>
      </div>
    </article>
  );
}
