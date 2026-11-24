import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AdminList } from '../../components/admin/AdminList.jsx';
import { AdminHeading } from '../../components/admin/AdminLayout.jsx';
import { ReasonAction } from '../../components/admin/ReasonAction.jsx';
import { StatTile } from '../../components/dashboard/Widgets.jsx';
import {
  Alert,
  Badge,
  Button,
  Card,
  Loading,
  SectionHeading,
  TextField,
} from '../../components/ui/index.js';
import { api, downloadFile } from '../../lib/api.js';
import { ADMIN_HOLD_REASON, PAYOUT_STATUS } from '../../lib/dashboard.js';
import { formatPaise } from '../../lib/money.js';
import { when } from '../../lib/orders.js';
import { useFetch } from '../../lib/useFetch.js';

const payoutBadge = (status) => {
  const info = PAYOUT_STATUS[status];
  return <Badge tone={info.tone}>{status === 'PENDING' ? 'To send' : info.label}</Badge>;
};

const txLink = (row) =>
  row.kind === 'order' ? `/admin/orders?q=${row.ref}` : `/admin/rentals?q=${row.ref}`;

/** Weekly payouts (SPEC 12): what is ready, what is held and why, and every batch. */
export function AdminPayoutsPage() {
  const preview = useFetch('/admin/payouts/eligible');
  const navigate = useNavigate();
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState(null);
  const [message, setMessage] = useState(null);

  async function build() {
    setBuilding(true);
    setBuildError(null);
    setMessage(null);
    try {
      const result = await api('/admin/payout-batches', { method: 'POST' });
      if (result.batch === null) {
        setMessage(result.message);
        preview.reload();
      } else {
        navigate(`/admin/payouts/${result.batch.id}`);
      }
    } catch (problem) {
      setBuildError(problem.message);
    } finally {
      setBuilding(false);
    }
  }

  const data = preview.data;
  return (
    <div className="space-y-8">
      <AdminHeading
        title="Payouts"
        description="A batch is built every Monday at 10:00 automatically. Only completed, undisputed sales and rentals of active sellers with verified bank details are paid."
        action={
          <Button onClick={build} loading={building} disabled={!data?.eligible.length}>
            Build a batch now
          </Button>
        }
      />
      {buildError ? <Alert tone="error">{buildError}</Alert> : null}
      {message ? <Alert tone="info">{message}</Alert> : null}
      {preview.error ? <Alert tone="error">{preview.error.message}</Alert> : null}
      {!data ? (
        preview.error ? null : (
          <Loading />
        )
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile
              label="Ready to pay"
              value={formatPaise(data.totals.eligiblePaise)}
              note={`${data.eligible.length} transactions, ${data.totals.eligibleSellers} sellers`}
            />
            <StatTile
              label="Held back"
              value={formatPaise(data.totals.heldPaise)}
              note={`${data.held.length} transactions`}
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <TransactionList title="Ready for the next batch" rows={data.eligible} />
            <TransactionList title="Held back" rows={data.held} held />
          </div>
        </>
      )}

      <section>
        <SectionHeading
          title="Payouts that need action"
          description="Failed transfers can be retried once the seller's bank details are verified again."
        />
        <AdminList
          path="/admin/payout-items"
          csv={false}
          extraQuery={{ status: 'FAILED' }}
          empty="No failed payouts"
          columns={itemColumns}
          expand={(item, reload) => <ItemActions item={item} onDone={reload} />}
        />
      </section>

      <section>
        <SectionHeading title="Batches" />
        <AdminList
          path="/admin/payout-batches"
          csv={false}
          empty="No batches yet"
          filters={[
            {
              name: 'status',
              label: 'Status',
              options: [
                { value: 'OPEN', label: 'Open' },
                { value: 'CLOSED', label: 'Closed' },
              ],
            },
          ]}
          columns={[
            {
              header: 'Batch',
              cell: (b) => (
                <Link to={`/admin/payouts/${b.id}`} className="font-medium hover:underline">
                  {b.ref}
                </Link>
              ),
            },
            { header: 'Total', cell: (b) => formatPaise(b.totalPaise) },
            {
              header: 'Payouts',
              cell: (b) =>
                `${b.counts.PAID} paid · ${b.counts.PENDING} to send · ${b.counts.FAILED} failed`,
              width: 'minmax(0,1.6fr)',
            },
            {
              header: 'Status',
              cell: (b) =>
                b.status === 'OPEN' ? (
                  <Badge tone={b.overdue ? 'danger' : 'notice'}>
                    {b.overdue ? 'Past target' : `Due ${when(b.dueAt)}`}
                  </Badge>
                ) : (
                  <Badge tone="success">Closed</Badge>
                ),
            },
            { header: 'Built', cell: (b) => `${when(b.createdAt)} · ${b.builtBy}` },
          ]}
        />
      </section>
    </div>
  );
}

function TransactionList({ title, rows, held = false }) {
  return (
    <Card>
      <SectionHeading title={title} />
      {rows.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <Link to={txLink(row)} className="font-medium hover:underline">
                {row.ref}
              </Link>
              <span>{formatPaise(row.amount)}</span>
              <span className="min-w-0 truncate text-muted">{row.sellerEmail}</span>
              {held ? <Badge tone="notice">{ADMIN_HOLD_REASON[row.hold] ?? row.hold}</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const itemColumns = [
  { header: 'Payout', cell: (i) => <span className="font-medium">{i.ref}</span> },
  {
    header: 'Seller',
    width: 'minmax(0,1.5fr)',
    cell: (i) => (
      <Link to={`/admin/users/${i.seller.id}`} className="hover:underline">
        {i.seller.displayName ?? i.seller.email}
      </Link>
    ),
  },
  { header: 'Amount', cell: (i) => formatPaise(i.amountPaise) },
  { header: 'Status', cell: (i) => payoutBadge(i.status) },
  {
    header: 'For',
    width: 'minmax(0,1.4fr)',
    cell: (i) => i.lines.map((l) => l.ref).join(', '),
  },
];

/** Record a transfer as made or failed, or retry a failed one. */
function ItemActions({ item, onDone }) {
  const post = (path) => async (body) => {
    await api(`/admin/payout-items/${item.id}/${path}`, { method: 'POST', body });
    onDone();
  };
  return (
    <div className="space-y-3 text-sm">
      <ul className="space-y-1 text-muted">
        {item.attempts.map((a) => (
          <li key={a.reference}>
            {a.reference}: {a.accountNumber} ({a.ifsc}) · {PAYOUT_STATUS[a.status].label}
            {a.bankReference ? ` · bank reference ${a.bankReference}` : ''}
            {a.failureReason ? ` · ${a.failureReason}` : ''}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {item.status === 'PENDING' ? (
          <>
            <ReasonAction
              label="Mark paid"
              variant="primary"
              title={`Record ${formatPaise(item.amountPaise)} as sent`}
              description="Only after the bank confirms the transfer. The seller is told and the payout is booked in the ledger."
              needsReason={false}
              initial={{ bankReference: '' }}
              fields={([values, setValues], problems) => (
                <TextField
                  label="Bank reference (UTR)"
                  value={values.bankReference}
                  onChange={(e) => setValues((v) => ({ ...v, bankReference: e.target.value }))}
                  error={problems.bankReference}
                  required
                />
              )}
              onConfirm={post('paid')}
            />
            <ReasonAction
              label="Mark failed"
              variant="danger"
              tone="danger"
              description="The seller is asked to check their bank details; it can be retried after they are verified again."
              reasonLabel="What the bank said"
              onConfirm={post('failed')}
            />
          </>
        ) : null}
        {item.status === 'FAILED' ? (
          <ReasonAction
            label="Retry"
            description="Uses a new reference. Allowed only after the seller's bank details were verified again."
            onConfirm={post('retry')}
          />
        ) : null}
      </div>
    </div>
  );
}

/** One batch: the bank file, and recording each transfer. */
export function AdminPayoutBatchPage() {
  const { id } = useParams();
  const { data, error, reload } = useFetch(`/admin/payout-batches/${id}`);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  if (error && !data) return <Alert tone="error">{error.message}</Alert>;
  if (!data) return <Loading />;
  const { batch, items } = data;

  async function download() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadFile(`/admin/payout-batches/${id}/bank-file.csv`, `${batch.ref}-bank-file.csv`);
    } catch (problem) {
      setDownloadError(problem.message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6">
      <AdminHeading
        title={`Batch ${batch.ref}`}
        description={`Built ${when(batch.createdAt)} by ${batch.builtBy}. ${
          batch.status === 'OPEN'
            ? `Target: done by ${when(batch.dueAt)}.`
            : `Closed ${when(batch.closedAt)}.`
        }`}
        action={
          <Button
            variant="secondary"
            onClick={download}
            loading={downloading}
            disabled={!batch.counts.PENDING}
          >
            Download bank file
          </Button>
        }
      />
      {downloadError ? <Alert tone="error">{downloadError}</Alert> : null}
      {batch.overdue ? (
        <Alert tone="error">This batch is past its 3-business-day target.</Alert>
      ) : null}
      <Alert tone="info">
        The bank file has full account numbers: keep it private and delete it after the transfers.
        Every download is recorded in the audit log.
      </Alert>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total" value={formatPaise(batch.totalPaise)} />
        <StatTile label="Paid" value={batch.counts.PAID} />
        <StatTile label="To send" value={batch.counts.PENDING} />
        <StatTile label="Failed" value={batch.counts.FAILED} />
      </div>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <Card>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{item.ref}</span>
                <span>{formatPaise(item.amountPaise)}</span>
                {payoutBadge(item.status)}
                <Link
                  to={`/admin/users/${item.seller.id}`}
                  className="text-sm text-accent hover:underline"
                >
                  {item.seller.displayName ?? item.seller.email}
                </Link>
              </div>
              <p className="mt-1 text-sm text-muted">
                For {item.lines.map((l) => `${l.ref} (${formatPaise(l.amountPaise)})`).join(', ')}
              </p>
              <div className="mt-3">
                <ItemActions item={item} onDone={reload} />
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
