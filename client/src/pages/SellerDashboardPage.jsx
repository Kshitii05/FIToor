import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendChart } from '../components/charts/Charts.jsx';
import { BankDetails } from '../components/dashboard/BankDetails.jsx';
import {
  DateRangeFilter,
  ExportButton,
  StatGrid,
  StatTile,
} from '../components/dashboard/Widgets.jsx';
import { Alert, Badge, Card, EmptyState, Loading, SectionHeading } from '../components/ui/index.js';
import { HOLD_REASON, initialRange, PAYOUT_STATUS, percent } from '../lib/dashboard.js';
import { formatPaise } from '../lib/money.js';
import { when } from '../lib/orders.js';
import { useFetch } from '../lib/useFetch.js';

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Every seller's dashboard (SPEC Module 11): earnings, views, top listings, payouts. */
export default function SellerDashboardPage() {
  const [range, setRange] = useState(() => initialRange());
  const query = `from=${range.from}&to=${range.to}`;
  const analytics = useFetch(`/me/analytics?${query}`);
  const data = analytics.data;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            Seller dashboard
          </h1>
          <p className="mt-1 text-sm text-muted">
            Completed sales and rentals, counted on the day they completed.
          </p>
        </div>
        <ExportButton
          path={`/me/analytics?${query}`}
          filename={`my-sales-${range.from}-to-${range.to}.csv`}
        />
      </div>
      <DateRangeFilter value={range} onChange={setRange} />

      {analytics.error ? <Alert tone="error">{analytics.error.message}</Alert> : null}
      {!data ? (
        <Loading label="Loading your figures" />
      ) : (
        <div
          className={`space-y-8 transition-opacity ${analytics.loading ? 'opacity-60' : ''}`}
          aria-busy={analytics.loading}
        >
          <StatGrid>
            <StatTile
              label="Net earnings"
              value={formatPaise(data.totals.netPaise)}
              note="After commission"
            />
            <StatTile
              label="Gross earnings"
              value={formatPaise(data.totals.grossPaise)}
              note={`Commission ${formatPaise(data.totals.commissionPaise)}`}
            />
            <StatTile label="Sales" value={data.totals.sales} />
            <StatTile label="Rentals" value={data.totals.rentals} />
            <StatTile label="Listing views" value={data.totals.views} note="One per person a day" />
            <StatTile
              label="Conversion"
              value={percent(data.totals.conversionRate)}
              note="Completed ÷ views"
            />
            <StatTile
              label="Average rating"
              value={data.totals.averageRating ?? '—'}
              note={`${data.totals.ratingCount} review${data.totals.ratingCount === 1 ? '' : 's'}`}
            />
            <StatTile label="Paid out" value={formatPaise(data.totals.paidOutPaise)} />
          </StatGrid>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <SectionHeading title="Net earnings" />
              <TrendChart
                kind="bar"
                data={data.series}
                bucket={data.range.bucket}
                series={[{ key: 'netPaise', label: 'Net earnings', money: true }]}
                summary={`Net earnings of ${formatPaise(data.totals.netPaise)} in the period`}
              />
            </Card>
            <Card>
              <SectionHeading title="Views and completed" />
              <TrendChart
                data={data.series}
                bucket={data.range.bucket}
                series={[
                  { key: 'views', label: 'Views' },
                  { key: 'sales', label: 'Sales' },
                  { key: 'rentals', label: 'Rentals' },
                ]}
                summary={`${data.totals.views} views, ${count(data.totals.sales, 'sale')} and ${count(data.totals.rentals, 'rental')}`}
              />
            </Card>
          </div>

          <Card>
            <SectionHeading title="Your listings" description="Most viewed in the period." />
            {data.topListings.length === 0 ? (
              <EmptyState title="No listings yet" />
            ) : (
              <ul className="divide-y divide-line">
                {data.topListings.map((listing) => (
                  <li key={listing.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                    <Link
                      to={`/listings/${listing.id}`}
                      className="min-w-0 flex-1 truncate font-medium text-ink hover:underline"
                    >
                      {listing.title}
                    </Link>
                    <span className="text-sm text-muted">
                      {listing.views} views · {listing.likes} likes · {listing.completed}{' '}
                      {listing.mode === 'RENT' ? 'rented' : 'sold'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Payouts />
      <BankDetails />
    </div>
  );
}

function Payouts() {
  const { data, error } = useFetch('/me/payouts');
  return (
    <Card>
      <SectionHeading
        title="Payouts"
        description="Paid by bank transfer every week for completed sales and rentals with nothing open."
      />
      {error ? (
        <Alert tone="error">{error.message}</Alert>
      ) : !data ? (
        <Loading label="Loading payouts" />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Paid" value={formatPaise(data.totals.paidPaise)} />
            <StatTile label="Being sent" value={formatPaise(data.totals.inProgressPaise)} />
            <StatTile label="Coming up" value={formatPaise(data.totals.upcomingPaise)} />
          </div>
          {data.upcoming.length ? (
            <div>
              <h3 className="text-sm font-semibold text-ink">Waiting for the next payout</h3>
              <ul className="mt-2 divide-y divide-line">
                {data.upcoming.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <Link
                      to={row.kind === 'order' ? `/sales/${row.id}` : `/rented-out/${row.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {row.ref}
                    </Link>
                    <span className="text-sm text-ink">{formatPaise(row.amountPaise)}</span>
                    {row.hold ? (
                      <Badge tone="notice">{HOLD_REASON[row.hold] ?? row.hold}</Badge>
                    ) : (
                      <Badge tone="success">In the next batch</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.payouts.length === 0 ? (
            <p className="text-sm text-muted">No payouts yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.payouts.map((payout) => {
                const status = PAYOUT_STATUS[payout.status];
                const last = payout.attempts.at(-1);
                return (
                  <li key={payout.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium text-ink">
                        {formatPaise(payout.amountPaise)}
                      </span>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <span className="text-sm text-muted">
                        {payout.paidAt ? `Sent ${when(payout.paidAt)}` : when(payout.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      To {last.accountNumber} ({last.ifsc})
                      {last.bankReference ? ` · bank reference ${last.bankReference}` : ''}
                      {last.failureReason ? ` · ${last.failureReason}` : ''} · for{' '}
                      {payout.lines.map((l) => l.ref).join(', ')}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
