import { useState } from 'react';
import { AdminList } from '../../components/admin/AdminList.jsx';
import { AdminHeading } from '../../components/admin/AdminLayout.jsx';
import { ReasonAction } from '../../components/admin/ReasonAction.jsx';
import { Badge, FilterTabs } from '../../components/ui/index.js';
import { api } from '../../lib/api.js';
import { formatPaise } from '../../lib/money.js';
import { when } from '../../lib/orders.js';

const words = (value) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ');
const TONE = { CAPTURED: 'success', PROCESSED: 'success', PENDING: 'notice', FAILED: 'danger' };
const badge = (status) => <Badge tone={TONE[status] ?? 'neutral'}>{words(status)}</Badge>;

const TABS = [
  { value: 'payments', label: 'Payments' },
  { value: 'refunds', label: 'Refunds' },
  { value: 'deposits', label: 'Deposits' },
];

/** Financial operations: payments in, refunds out, rental deposits (SPEC Module 10). */
export default function AdminMoneyPage() {
  const [tab, setTab] = useState('payments');
  return (
    <>
      <AdminHeading
        title="Money"
        description="Read from the stored records. Deposits are collected and refunded; they are never revenue."
      />
      <div className="mb-6">
        <FilterTabs label="Show" options={TABS} value={tab} onChange={setTab} />
      </div>
      {tab === 'payments' ? <Payments key="payments" /> : null}
      {tab === 'refunds' ? <Refunds key="refunds" /> : null}
      {tab === 'deposits' ? <Deposits key="deposits" /> : null}
    </>
  );
}

function Payments() {
  return (
    <AdminList
      path="/admin/payments"
      filename="payments.csv"
      search="Gateway payment id"
      dates
      filters={[
        {
          name: 'status',
          label: 'Status',
          options: [
            { value: 'CAPTURED', label: 'Captured' },
            { value: 'FAILED', label: 'Failed' },
          ],
        },
      ]}
      columns={[
        { header: 'Payment', width: 'minmax(0,1.5fr)', cell: (p) => p.gatewayPaymentId },
        {
          header: 'For',
          cell: (p) => (p.kind === 'rental' ? `Rental ${p.bookingRef}` : 'Checkout'),
        },
        { header: 'Payer', width: 'minmax(0,1.4fr)', cell: (p) => p.payerEmail },
        {
          header: 'Amount',
          cell: (p) => (
            <>
              {formatPaise(p.amountPaise)}
              {p.feePaise ? (
                <span className="block text-xs text-muted">fee {formatPaise(p.feePaise)}</span>
              ) : null}
            </>
          ),
        },
        { header: 'Status', cell: (p) => badge(p.status) },
        { header: 'When', cell: (p) => when(p.capturedAt ?? p.createdAt) },
      ]}
    />
  );
}

function Refunds() {
  return (
    <AdminList
      path="/admin/refunds"
      filename="refunds.csv"
      dates
      filters={[
        {
          name: 'status',
          label: 'Status',
          options: ['PENDING', 'PROCESSED', 'FAILED'].map((value) => ({
            value,
            label: words(value),
          })),
        },
      ]}
      columns={[
        { header: 'For', cell: (r) => r.orderRef ?? r.bookingRef ?? 'Checkout' },
        { header: 'Reason', width: 'minmax(0,1.3fr)', cell: (r) => words(r.reason) },
        {
          header: 'Amount',
          cell: (r) => (
            <>
              {formatPaise(r.amountPaise)}
              {r.depositAmountPaise ? (
                <span className="block text-xs text-muted">
                  deposit {formatPaise(r.depositAmountPaise)}
                </span>
              ) : null}
            </>
          ),
        },
        {
          header: 'Status',
          cell: (r) => (
            <>
              {badge(r.status)}
              {r.status === 'PENDING' && r.attempts > 1 ? (
                <span className="block text-xs text-muted">{r.attempts} tries</span>
              ) : null}
            </>
          ),
        },
        { header: 'Created', cell: (r) => when(r.createdAt) },
      ]}
      expand={(refund, reload) => (
        <div className="space-y-3 text-sm">
          <p className="text-muted">
            {refund.gatewayRefundId
              ? `Gateway refund ${refund.gatewayRefundId}. `
              : 'Not with the gateway yet. '}
            {refund.lastError ? `Last error: ${refund.lastError}` : ''}
            {refund.processedAt ? `Processed ${when(refund.processedAt)}.` : ''}
          </p>
          {refund.status === 'FAILED' ||
          (refund.status === 'PENDING' && !refund.gatewayRefundId) ? (
            <ReasonAction
              label="Retry refund"
              description={
                refund.status === 'FAILED'
                  ? 'A new refund for the same amount is sent; the failed one no longer counts.'
                  : 'It is sent again under the same reference, so the gateway cannot pay it twice.'
              }
              onConfirm={async (body) => {
                await api(`/admin/refunds/${refund.id}/retry`, { method: 'POST', body });
                reload();
              }}
            />
          ) : null}
        </div>
      )}
    />
  );
}

function Deposits() {
  return (
    <AdminList
      path="/admin/deposits"
      filename="deposits.csv"
      search="Booking ref"
      dates
      filters={[
        {
          name: 'stage',
          label: 'Stage',
          options: [
            { value: 'held', label: 'Not settled yet' },
            { value: 'settled', label: 'Settled' },
          ],
        },
      ]}
      columns={[
        {
          header: 'Booking',
          width: 'minmax(0,1.6fr)',
          cell: (b) => (
            <>
              <span className="font-medium">{b.ref}</span>{' '}
              <span className="text-muted">{b.title}</span>
            </>
          ),
        },
        { header: 'Collected', cell: (b) => formatPaise(b.depositPaise) },
        { header: 'Refunded', cell: (b) => formatPaise(b.refundedPaise) },
        { header: 'Deducted', cell: (b) => formatPaise(b.deductedPaise) },
        {
          header: 'Outstanding',
          cell: (b) =>
            b.outstandingPaise ? (
              <Badge tone="notice">{formatPaise(b.outstandingPaise)}</Badge>
            ) : (
              '—'
            ),
        },
        { header: 'Status', cell: (b) => words(b.status) },
      ]}
    />
  );
}
