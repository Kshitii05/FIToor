import { useEffect, useState } from 'react';
import { ListingGrid } from '../components/listings/ListingCard.jsx';
import { Alert, ButtonLink, EmptyState, Loading, Pagination } from '../components/ui/index.js';
import { api } from '../lib/api.js';

export default function LikedPage() {
  const [page, setPage] = useState(1);
  // Keyed by page, so a slow reply for another page never shows for this one.
  const [result, setResult] = useState({ page: null });

  useEffect(() => {
    let cancelled = false;
    api(`/me/likes?page=${page}&pageSize=24`)
      .then((data) => {
        if (!cancelled) setResult({ page, data });
      })
      .catch((error) => {
        if (!cancelled) setResult({ page, error });
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  const loading = result.page !== page;
  const { data, error } = result;

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Liked</h1>
      <p className="mt-1 text-sm text-muted">
        Pieces you saved for later. Listings that are no longer available drop off this list.
      </p>

      <div className="mt-6" aria-busy={loading}>
        {error && !loading ? (
          <Alert tone="error">{error.message}</Alert>
        ) : !data ? (
          <Loading label="Loading your liked listings" />
        ) : data.items.length === 0 ? (
          <EmptyState
            title="Nothing liked yet"
            action={<ButtonLink to="/search">Start browsing</ButtonLink>}
          >
            Tap the heart on any listing to keep it here.
          </EmptyState>
        ) : (
          <div className={`transition-opacity ${loading ? 'opacity-60' : ''}`}>
            <ListingGrid listings={data.items} />
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              disabled={loading}
              onChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
