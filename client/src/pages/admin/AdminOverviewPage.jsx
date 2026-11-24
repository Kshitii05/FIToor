import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminHeading } from '../../components/admin/AdminLayout.jsx';
import { RankChart, TrendChart } from '../../components/charts/Charts.jsx';
import {
  DateRangeFilter,
  ExportButton,
  StatGrid,
  StatTile,
} from '../../components/dashboard/Widgets.jsx';
import { Alert, Card, EmptyState, Loading, SectionHeading } from '../../components/ui/index.js';
import { initialRange } from '../../lib/dashboard.js';
import { categoryLabel } from '../../lib/listings.js';
import { formatPaise } from '../../lib/money.js';
import { useFetch } from '../../lib/useFetch.js';

/** Platform analytics (SPEC Module 11), with date filters and CSV. */
export default function AdminOverviewPage() {
  const [range, setRange] = useState(() => initialRange());
  const query = `from=${range.from}&to=${range.to}`;
  const { data, error, loading } = useFetch(`/admin/analytics?${query}`);

  return (
    <div className="space-y-8">
      <AdminHeading
        title="Overview"
        description="Money figures count completed orders and rentals on the day they completed. Deposits are never revenue."
        action={
          <ExportButton
            path={`/admin/analytics?${query}`}
            filename={`platform-${range.from}-to-${range.to}.csv`}
          />
        }
      />
      <DateRangeFilter value={range} onChange={setRange} />
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      {!data ? (
        error ? null : (
          <Loading label="Loading figures" />
        )
      ) : (
        <div
          className={`space-y-8 transition-opacity ${loading ? 'opacity-60' : ''}`}
          aria-busy={loading}
        >
          <StatGrid>
            <StatTile
              label="GMV"
              value={formatPaise(data.totals.gmvPaise)}
              note="Paid, less refunds"
            />
            <StatTile
              label="Commission revenue"
              value={formatPaise(data.totals.commissionPaise)}
              note={`Gateway fees ${formatPaise(data.totals.gatewayFeesPaise)}`}
            />
            <StatTile
              label="Completed"
              value={data.totals.sales + data.totals.rentals}
              note={`${data.totals.sales} sales · ${data.totals.rentals} rentals`}
            />
            <StatTile
              label="Average transaction"
              value={formatPaise(data.totals.averageTransactionPaise)}
            />
            <StatTile
              label="Users"
              value={data.users.total}
              note={`${data.users.new} new · ${data.users.suspended} suspended`}
            />
            <StatTile
              label="Active users"
              value={data.users.active}
              note={`${data.users.inactive} inactive for 30 days`}
            />
            <StatTile
              label="Live listings"
              value={data.listings.activeSale + data.listings.activeRent}
              note={`${data.listings.activeSale} for sale · ${data.listings.activeRent} for rent`}
            />
            <StatTile label="Refunds" value={formatPaise(data.totals.refundsPaise)} />
          </StatGrid>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <SectionHeading title="GMV and commission" />
              <TrendChart
                data={data.series}
                bucket={data.range.bucket}
                series={[
                  { key: 'gmvPaise', label: 'GMV', money: true },
                  { key: 'commissionPaise', label: 'Commission', money: true },
                ]}
                summary={`GMV ${formatPaise(data.totals.gmvPaise)}, commission ${formatPaise(data.totals.commissionPaise)}`}
              />
            </Card>
            <Card>
              <SectionHeading title="Sales and rentals" />
              <TrendChart
                kind="bar"
                data={data.series}
                bucket={data.range.bucket}
                series={[
                  { key: 'sales', label: 'Sales' },
                  { key: 'rentals', label: 'Rentals' },
                ]}
                summary={`${data.totals.sales} sales and ${data.totals.rentals} rentals completed`}
              />
            </Card>
            <Card>
              <SectionHeading title="Sign-ups and active users" />
              <TrendChart
                data={data.series}
                bucket={data.range.bucket}
                series={[
                  { key: 'signups', label: 'Sign-ups' },
                  { key: 'activeUsers', label: 'Active users' },
                ]}
                summary={`${data.users.new} sign-ups, ${data.users.active} active users`}
              />
            </Card>
            <Card>
              <SectionHeading
                title="Deposits"
                description="Collected and returned in the period; kept apart from revenue."
              />
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ['Collected', data.totals.depositsCollectedPaise],
                  ['Refunded', data.totals.depositsRefundedPaise],
                  ['Deducted for damage or late fees', data.totals.depositsDeductedPaise],
                  ['Paid out to sellers', data.totals.payoutsPaise],
                ].map(([label, paise]) => (
                  <div key={label} className="rounded-field bg-paper p-3">
                    <dt className="text-muted">{label}</dt>
                    <dd className="mt-1 font-semibold text-ink">{formatPaise(paise)}</dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card>
              <SectionHeading title="Popular categories" />
              {data.categories.length ? (
                <RankChart
                  data={data.categories.map((c) => ({
                    ...c,
                    name: categoryLabel(c.category),
                  }))}
                  labelKey="name"
                  valueKey="count"
                  valueLabel="Completed"
                />
              ) : (
                <EmptyState title="Nothing completed yet" />
              )}
            </Card>
            <Card>
              <SectionHeading title="Demand by area" description="Public area names only." />
              {data.localities.length ? (
                <RankChart
                  data={data.localities}
                  labelKey="locality"
                  valueKey="count"
                  valueLabel="Completed"
                />
              ) : (
                <EmptyState title="Nothing completed yet" />
              )}
            </Card>
          </div>

          <Card>
            <SectionHeading title="Top sellers" description="By GMV in the period." />
            {data.topSellers.length === 0 ? (
              <EmptyState title="Nothing completed yet" />
            ) : (
              <ol className="divide-y divide-line">
                {data.topSellers.map((seller, index) => (
                  <li key={seller.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                    <span className="w-6 text-sm text-muted">{index + 1}</span>
                    <Link
                      to={`/admin/users/${seller.id}`}
                      className="min-w-0 flex-1 truncate font-medium text-ink hover:underline"
                    >
                      {seller.displayName ?? seller.email}
                    </Link>
                    <span className="text-sm text-muted">
                      {seller.count} completed · {formatPaise(seller.gmvPaise)} GMV ·{' '}
                      {formatPaise(seller.commissionPaise)} commission
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
