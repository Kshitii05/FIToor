import { Link, useParams } from 'react-router-dom';
import { StatusBadge } from '../../components/admin/StatusBadge.jsx';
import { AdminHeading } from '../../components/admin/AdminLayout.jsx';
import { ReasonAction } from '../../components/admin/ReasonAction.jsx';
import {
  Alert,
  Badge,
  Card,
  Checkbox,
  Loading,
  SectionHeading,
} from '../../components/ui/index.js';
import { api } from '../../lib/api.js';
import { BANK_STATUS, USER_STATUS } from '../../lib/dashboard.js';
import { DISPUTE_KIND, DISPUTE_STATUS } from '../../lib/disputes.js';
import { formatPaise } from '../../lib/money.js';
import { when } from '../../lib/orders.js';
import { useFetch } from '../../lib/useFetch.js';

const label = (value) => value.toLowerCase().replaceAll('_', ' ');

/** One user: who they are, everything they did on both sides, and admin actions. */
export default function AdminUserPage() {
  const { id } = useParams();
  const { data, error, setData } = useFetch(`/admin/users/${id}`);

  if (error && !data) return <Alert tone="error">{error.message}</Alert>;
  if (!data) return <Loading />;
  const { user } = data;
  const act = (action) => async (body) =>
    setData(await api(`/admin/users/${id}/${action}`, { method: 'POST', body }));
  const isAdmin = user.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <AdminHeading
        title={user.displayName ?? 'Erased account'}
        description={`${user.email} · ${user.phone ?? 'no phone'} · joined ${when(user.createdAt)}`}
        action={
          isAdmin ? (
            <Badge>Admin</Badge>
          ) : (
            <div className="flex flex-wrap gap-2">
              <ReasonAction
                label="Warn"
                title="Send a warning"
                description="They get a notification and an email with your words."
                reasonLabel="Message to the user (also kept in the audit log)"
                onConfirm={act('warn')}
              />
              {user.status === 'ACTIVE' ? (
                <ReasonAction
                  label="Suspend"
                  variant="danger"
                  tone="danger"
                  title="Suspend this account"
                  description="They are signed out everywhere, cannot sign in, and their listings disappear from the site. Their open orders and rentals carry on: handle each one from its page."
                  initial={{ removeListings: false }}
                  fields={([values, setValues]) => (
                    <Checkbox
                      label="Also remove all their listings (ban)"
                      description="Removed listings stay removed even if the account is restored later."
                      checked={values.removeListings}
                      onChange={(removeListings) => setValues((v) => ({ ...v, removeListings }))}
                    />
                  )}
                  onConfirm={act('suspend')}
                />
              ) : null}
              {user.status === 'SUSPENDED' ? (
                <ReasonAction
                  label="Restore"
                  title="Restore this account"
                  onConfirm={act('restore')}
                />
              ) : null}
            </div>
          )
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge map={USER_STATUS} value={user.status} />
        {user.emailVerified ? (
          <Badge tone="success">Email verified</Badge>
        ) : (
          <Badge>Email not verified</Badge>
        )}
        {user.phoneVerified ? (
          <Badge tone="success">Phone verified</Badge>
        ) : (
          <Badge>Phone not verified</Badge>
        )}
        {user.bankAccountStatus ? (
          <StatusBadge map={BANK_STATUS} value={user.bankAccountStatus} />
        ) : null}
      </div>
      {user.status === 'SUSPENDED' ? (
        <Alert tone="notice" title={`Suspended ${when(user.suspendedAt)}`}>
          {user.suspensionReason}
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Bought', data.counts.purchases],
          ['Sold', data.counts.sales],
          ['Rented', data.counts.rentals],
          ['Rented out', data.counts.rentedOut],
        ].map(([name, count]) => (
          <div key={name} className="rounded-card border border-line bg-surface p-4">
            <p className="text-sm text-muted">{name}</p>
            <p className="font-display text-2xl font-semibold">{count}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted">
        Listings:{' '}
        {Object.entries(data.listings)
          .map(([status, count]) => `${count} ${label(status)}`)
          .join(', ') || 'none'}
        .{' '}
        <Link to={`/admin/listings?sellerId=${user.id}`} className="text-accent hover:underline">
          See listings
        </Link>
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <History title="Purchases" rows={data.purchases} link={(r) => `/admin/orders?q=${r.ref}`} />
        <History title="Sales" rows={data.sales} link={(r) => `/admin/orders?q=${r.ref}`} />
        <History title="Rentals" rows={data.rentals} link={(r) => `/admin/rentals?q=${r.ref}`} />
        <History
          title="Rented out"
          rows={data.rentedOut}
          link={(r) => `/admin/rentals?q=${r.ref}`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeading title="Disputes" />
          {data.disputes.length ? (
            <ul className="divide-y divide-line text-sm">
              {data.disputes.map((d) => (
                <li key={d.id} className="flex flex-wrap gap-x-3 py-2">
                  <Link to={`/admin/disputes/${d.id}`} className="font-medium hover:underline">
                    {DISPUTE_KIND[d.kind] ?? d.kind}
                  </Link>
                  <span className="text-muted">
                    {DISPUTE_STATUS[d.status]?.label ?? d.status} · as {d.side} ·{' '}
                    {when(d.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">None.</p>
          )}
        </Card>
        <Card>
          <SectionHeading title="Reports about them" />
          {data.reports.length ? (
            <ul className="divide-y divide-line text-sm">
              {data.reports.map((r) => (
                <li key={r.id} className="py-2">
                  <span className="font-medium">{label(r.reason)}</span>{' '}
                  <span className="text-muted">
                    · {label(r.status)} · {when(r.createdAt)}
                  </span>
                  {r.details ? <p className="text-muted">{r.details}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">None.</p>
          )}
        </Card>
      </div>

      <Card>
        <SectionHeading title="Admin actions on this account" />
        {data.audit.length ? (
          <ul className="divide-y divide-line text-sm">
            {data.audit.map((row) => (
              <li key={row.id} className="py-2">
                <span className="font-medium">{label(row.action)}</span>{' '}
                <span className="text-muted">
                  by {row.admin}, {when(row.createdAt)}
                </span>
                <p className="text-muted">{row.reason}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">None.</p>
        )}
      </Card>
    </div>
  );
}

function History({ title, rows, link }) {
  return (
    <Card>
      <SectionHeading title={title} description="The 10 most recent." />
      {rows.length ? (
        <ul className="divide-y divide-line text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 py-2">
              <Link to={link(row)} className="font-medium hover:underline">
                {row.ref}
              </Link>
              <span className="text-muted">
                {row.title ? `${row.title} · ` : ''}
                {label(row.status)} · {formatPaise(row.totalPaise)} · {when(row.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">None.</p>
      )}
    </Card>
  );
}
