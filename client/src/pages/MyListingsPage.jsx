import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ListingPrice, StatusBadge } from '../components/listings/ListingCard.jsx';
import {
  Alert,
  Button,
  ButtonLink,
  EmptyState,
  FilterTabs,
  Loading,
  Pagination,
} from '../components/ui/index.js';
import { api } from '../lib/api.js';
import { STATUSES } from '../lib/listings.js';

const FILTERS = [
  { value: '', label: 'All' },
  ...STATUSES.map(({ value, label }) => ({ value, label })),
];

function ListingRow({ listing, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cover = listing.images[0];

  async function changeStatus(action) {
    setBusy(true);
    setError(null);
    try {
      await api(`/listings/${listing.id}/${action}`, { method: 'POST' });
      onChanged();
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  }

  return (
    <li className="rounded-card border border-line bg-surface p-3 shadow-card sm:p-4">
      <div className="flex gap-4">
        <Link
          to={`/listings/${listing.id}`}
          className="block size-20 shrink-0 overflow-hidden rounded-field bg-paper sm:size-24"
        >
          {cover ? <img src={cover.url} alt="" className="size-full object-cover" /> : null}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link
              to={`/listings/${listing.id}`}
              className="min-w-0 break-words font-medium text-ink underline-offset-4 hover:underline"
            >
              {listing.title}
            </Link>
            <StatusBadge status={listing.status} />
          </div>
          <ListingPrice listing={listing} className="mt-0.5" />
          <p className="mt-0.5 text-sm text-muted">
            {listing.mode === 'SALE'
              ? listing.sale.quantity === 0
                ? 'For sale · sold out'
                : `For sale · ${listing.sale.quantity} available`
              : 'For rent'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {listing.status !== 'REMOVED' ? (
              <ButtonLink to={`/listings/${listing.id}/edit`} variant="secondary" size="sm">
                Edit
              </ButtonLink>
            ) : null}
            {listing.status === 'ACTIVE' ? (
              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                onClick={() => changeStatus('pause')}
              >
                Pause
              </Button>
            ) : null}
            {listing.status === 'PAUSED' ? (
              <Button size="sm" loading={busy} onClick={() => changeStatus('activate')}>
                Activate
              </Button>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export default function MyListingsPage() {
  const location = useLocation();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  // Keyed by the request it answers, so results for an older filter are never shown.
  const [result, setResult] = useState({ key: null });

  const query = new URLSearchParams({ page: String(page) });
  if (status) query.set('status', status);
  const key = `${query}#${version}`;

  useEffect(() => {
    let cancelled = false;
    api(`/me/listings?${query}`)
      .then((data) => {
        if (!cancelled) setResult({ key, data });
      })
      .catch((error) => {
        if (!cancelled) setResult({ key, error });
      });
    return () => {
      cancelled = true;
    };
    // `key` already captures everything `query` depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loading = result.key !== key;
  // While the next page loads, keep showing the previous one rather than a blank list.
  const data = result.data;

  function changeFilter(next) {
    setStatus(next);
    setPage(1);
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">My listings</h1>
        <ButtonLink to="/listings/new">List an item</ButtonLink>
      </div>

      {location.state?.notice ? (
        <Alert tone="success" className="mt-5">
          {location.state.notice}
        </Alert>
      ) : null}

      <div className="mt-6">
        <FilterTabs
          label="Filter by status"
          options={FILTERS}
          value={status}
          onChange={changeFilter}
        />
      </div>

      <div className="mt-5" aria-busy={loading}>
        {result.error && !loading ? (
          <Alert tone="error">{result.error.message}</Alert>
        ) : !data ? (
          <Loading label="Loading your listings" />
        ) : data.items.length === 0 ? (
          <EmptyState
            title={status ? 'Nothing here' : 'You have no listings yet'}
            action={
              status ? null : <ButtonLink to="/listings/new">List your first item</ButtonLink>
            }
          >
            {status
              ? 'No listings match this filter.'
              : 'Sell a piece you no longer wear, or rent out one for special occasions.'}
          </EmptyState>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">
              {data.total} {data.total === 1 ? 'listing' : 'listings'}
            </p>
            <ul className={`space-y-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
              {data.items.map((listing) => (
                <ListingRow
                  key={listing.id}
                  listing={listing}
                  onChanged={() => setVersion((current) => current + 1)}
                />
              ))}
            </ul>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              disabled={loading}
              onChange={setPage}
            />
          </>
        )}
      </div>
    </div>
  );
}
