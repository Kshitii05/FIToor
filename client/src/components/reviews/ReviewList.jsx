import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/authContext.js';
import { api } from '../../lib/api.js';
import { RATING_FIELDS } from '../../lib/disputes.js';
import { when } from '../../lib/orders.js';
import { ReportButton } from '../reports/ReportButton.jsx';
import { Alert, Card, Pagination, SectionHeading } from '../ui/index.js';
import { Stars } from './Stars.jsx';

const ROLE = {
  BUYER: 'Bought from them',
  SELLER: 'Sold to them',
  RENTER: 'Rented from them',
  OWNER: 'Rented to them',
};

/** Someone's published reviews and average ratings, on their public profile. */
export function ReviewList({ userId }) {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ page: null });

  useEffect(() => {
    let cancelled = false;
    api(`/users/${encodeURIComponent(userId)}/reviews?page=${page}&pageSize=10`, { auth: false })
      .then((data) => !cancelled && setResult({ page, data }))
      .catch((error) => !cancelled && setResult({ page, error }));
    return () => {
      cancelled = true;
    };
  }, [userId, page]);

  const { data, error } = result;
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (!data) return null;
  const { summary } = data;

  return (
    <Card className="mt-6">
      <SectionHeading
        title="Reviews"
        description={
          summary.count
            ? `${summary.count} review${summary.count > 1 ? 's' : ''} from completed purchases and rentals`
            : 'No reviews yet. Reviews come only from completed purchases and rentals.'
        }
      />
      {summary.count ? (
        <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2">
          <p className="flex items-center gap-2">
            <span className="font-display text-3xl font-semibold text-ink">{summary.overall}</span>
            <Stars value={summary.overall} size="text-xl" />
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            {RATING_FIELDS.filter((f) => f.key !== 'overall' && summary[f.key] !== null).map(
              (f) => (
                <div key={f.key} className="flex gap-2">
                  <dt className="text-muted">{f.label}</dt>
                  <dd className="text-ink">{summary[f.key]}</dd>
                </div>
              ),
            )}
          </dl>
        </div>
      ) : null}
      <ul className="divide-y divide-line">
        {data.items.map((review) => (
          <li key={review.id} className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <span className="font-medium text-ink">{review.author?.displayName}</span>
                <span className="ml-2 text-muted">
                  {ROLE[review.authorRole]} · {when(review.createdAt)}
                </span>
              </p>
              <Stars value={review.overall} />
            </div>
            <p className="mt-1 text-xs font-medium text-success">
              ✓ Verified {review.transaction === 'PURCHASE' ? 'purchase' : 'rental'}
            </p>
            {review.text ? (
              <p className="mt-2 whitespace-pre-line break-words text-sm text-ink">{review.text}</p>
            ) : null}
            {review.photos.length ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {review.photos.map((photo) => (
                  <li key={photo.url}>
                    <a href={photo.url} target="_blank" rel="noreferrer">
                      <img
                        src={photo.url}
                        alt="Review"
                        className="size-16 rounded-field border border-line object-cover"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {user && review.author?.id !== user.id ? (
              <div className="mt-2">
                <ReportButton
                  targetType="REVIEW"
                  targetId={review.id}
                  label="Report review"
                  compact
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
    </Card>
  );
}

/** "★ 4.5 · 3 reviews" next to a seller, or nothing when there are none. */
export function RatingBadge({ userId }) {
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api(`/users/${encodeURIComponent(userId)}/reviews?pageSize=1`, { auth: false })
      .then((data) => !cancelled && setSummary(data.summary))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);
  if (!summary?.count) return null;
  return (
    <span className="text-sm text-ink">
      <span className="text-accent" aria-hidden="true">
        ★
      </span>{' '}
      {summary.overall} · {summary.count} review{summary.count > 1 ? 's' : ''}
    </span>
  );
}
