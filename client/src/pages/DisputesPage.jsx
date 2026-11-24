import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  EmptyState,
  FilterTabs,
  Loading,
  Pagination,
} from '../components/ui/index.js';
import { api } from '../lib/api.js';
import { DISPUTE_FILTERS, DISPUTE_KIND, DISPUTE_STATUS } from '../lib/disputes.js';
import { when } from '../lib/orders.js';

/** Disputes the signed-in person opened or must answer. */
export default function DisputesPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page) });
  if (status) query.set('status', status);
  const key = `/disputes?${query}`;
  const [result, setResult] = useState({ key: null });

  useEffect(() => {
    let cancelled = false;
    api(key)
      .then((data) => !cancelled && setResult({ key, data }))
      .catch((error) => !cancelled && setResult({ key, error }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  const loading = result.key !== key;
  const { data, error } = result;
  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Disputes</h1>
      <p className="mt-1 text-sm text-muted">
        Problems with orders and rentals. The other side has 48 hours to answer; then our team
        decides, usually within 5 business days.
      </p>
      <div className="mt-5">
        <FilterTabs
          label="Filter by status"
          options={DISPUTE_FILTERS}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
      </div>
      <div className="mt-5" aria-busy={loading}>
        {error && !loading ? (
          <Alert tone="error">{error.message}</Alert>
        ) : !data ? (
          <Loading label="Loading" />
        ) : data.items.length === 0 ? (
          <EmptyState title={status ? 'Nothing here' : 'No disputes'}>
            You can report a problem from an order or rental page.
          </EmptyState>
        ) : (
          <>
            <ul className={`space-y-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
              {data.items.map((dispute) => {
                const status = DISPUTE_STATUS[dispute.status];
                const needsMe = dispute.actions.some((a) => ['agree', 'appeal'].includes(a));
                return (
                  <li key={dispute.id}>
                    <Link
                      to={`/disputes/${dispute.id}`}
                      className="block rounded-card border border-line bg-surface p-4 shadow-card transition-shadow hover:shadow-lg"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-ink">
                          {DISPUTE_KIND[dispute.kind]} · {dispute.ref}
                        </p>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                      <p className="mt-1 truncate text-sm text-muted">
                        {dispute.subject?.type === 'order' ? 'Order' : 'Rental'}{' '}
                        {dispute.subject?.ref}
                        {dispute.subject?.title ? ` (${dispute.subject.title})` : ''} · with{' '}
                        {dispute.myRole === 'CLAIMANT'
                          ? dispute.respondent.displayName
                          : dispute.claimant.displayName}{' '}
                        · {when(dispute.createdAt)}
                      </p>
                      {needsMe ? (
                        <p className="mt-1 text-sm font-medium text-notice">Needs your attention</p>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
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
