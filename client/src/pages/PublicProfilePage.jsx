import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../auth/authContext.js';
import { ListingGrid } from '../components/listings/ListingCard.jsx';
import { ReportButton } from '../components/reports/ReportButton.jsx';
import { ReviewList } from '../components/reviews/ReviewList.jsx';
import {
  Alert,
  ButtonLink,
  Card,
  EmptyState,
  Loading,
  Pagination,
} from '../components/ui/index.js';
import { api } from '../lib/api.js';
import { formatMonthYear } from '../lib/format.js';

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export default function PublicProfilePage() {
  const { id } = useParams();
  const { user: me } = useAuth();
  // Keyed by id, so a result for a previous profile is never shown for the current one.
  const [result, setResult] = useState({ id: null });

  useEffect(() => {
    let cancelled = false;
    api(`/users/${encodeURIComponent(id)}`, { auth: false })
      .then((data) => {
        if (!cancelled) setResult({ id, user: data.user });
      })
      .catch((error) => {
        if (!cancelled) setResult({ id, error });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (result.id !== id) return <Loading label="Loading profile" />;

  if (result.error) {
    const missing = result.error.status === 404 || result.error.status === 400;
    return (
      <div className="mx-auto max-w-md">
        <Alert
          tone={missing ? 'notice' : 'error'}
          title={missing ? 'Profile not found' : undefined}
        >
          {missing ? 'This person is not on the marketplace, or has left.' : result.error.message}
        </Alert>
        <ButtonLink to="/" variant="secondary" className="mt-5">
          Back to home
        </ButtonLink>
      </div>
    );
  }

  const { user } = result;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Card>
        <div className="flex items-center gap-4">
          {user.photoUrl ? (
            <img src={user.photoUrl} alt="" className="size-16 rounded-full object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-xl font-semibold text-accent-strong"
            >
              {initials(user.displayName)}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="break-words font-display text-2xl font-semibold tracking-tight text-ink">
              {user.displayName}
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              {user.locality ? `${user.locality} · ` : ''}Member since{' '}
              {formatMonthYear(user.memberSince)}
            </p>
          </div>
        </div>
        {user.bio ? (
          <p className="mt-5 whitespace-pre-line break-words text-ink">{user.bio}</p>
        ) : null}
        {me && me.id !== user.id ? (
          <div className="mt-4">
            <ReportButton targetType="USER" targetId={user.id} label="Report this person" />
          </div>
        ) : null}
      </Card>

      {/* Remounted per profile so paging starts again at the first page. */}
      <SellerListings key={user.id} sellerId={user.id} />
      <ReviewList key={`reviews-${user.id}`} userId={user.id} />
    </div>
  );
}

function SellerListings({ sellerId }) {
  const [page, setPage] = useState(1);
  // Keyed by page, so a slow response for another page is never shown for this one.
  const [result, setResult] = useState({ page: null });

  useEffect(() => {
    let cancelled = false;
    api(`/users/${encodeURIComponent(sellerId)}/listings?page=${page}`, { auth: false })
      .then((data) => {
        if (!cancelled) setResult({ page, data });
      })
      .catch((error) => {
        if (!cancelled) setResult({ page, error });
      });
    return () => {
      cancelled = true;
    };
  }, [sellerId, page]);

  const loading = result.page !== page;
  const { data, error } = result;

  return (
    <section className="mt-8">
      <h2 className="font-display text-xl font-semibold text-ink">Listings</h2>
      <div className="mt-4" aria-busy={loading}>
        {error && !loading ? (
          <Alert tone="error">{error.message}</Alert>
        ) : !data ? (
          <Loading label="Loading listings" />
        ) : data.items.length === 0 ? (
          <EmptyState title="Nothing listed right now" />
        ) : (
          <>
            <div className={`transition-opacity ${loading ? 'opacity-60' : ''}`}>
              <ListingGrid listings={data.items} />
            </div>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              disabled={loading}
              onChange={setPage}
            />
          </>
        )}
      </div>
    </section>
  );
}
