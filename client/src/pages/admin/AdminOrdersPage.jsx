import { Link } from 'react-router-dom';
import { AdminList } from '../../components/admin/AdminList.jsx';
import { AdminHeading } from '../../components/admin/AdminLayout.jsx';
import { ReasonAction } from '../../components/admin/ReasonAction.jsx';
import { Badge } from '../../components/ui/index.js';
import { api } from '../../lib/api.js';
import { formatPaise } from '../../lib/money.js';
import { when } from '../../lib/orders.js';
import { rangeLabel } from '../../lib/rentals.js';

const words = (value) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ');
const statusOptions = (list) => list.map((value) => ({ value, label: words(value) }));

const ORDER_STATUSES = [
  'AWAITING_DISPATCH',
  'AWAITING_PICKUP',
  'DISPATCHED',
  'DELIVERY_REPORTED',
  'ADMIN_REVIEW',
  'DELIVERED',
  'ISSUE_OPEN',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
];
const BOOKING_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'CONFIRMED',
  'ACTIVE',
  'RETURNED',
  'CLAIM_OPEN',
  'ADMIN_REVIEW',
  'SETTLING',
  'COMPLETED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
];
const ATTENTION = ['ADMIN_REVIEW', 'DELIVERY_REPORTED', 'CLAIM_OPEN'];

const statusCell = (status) => (
  <Badge
    tone={ATTENTION.includes(status) ? 'notice' : status === 'COMPLETED' ? 'success' : 'neutral'}
  >
    {words(status)}
  </Badge>
);

function DisputeLinks({ disputes }) {
  if (!disputes?.length) return null;
  return (
    <p className="text-sm">
      Disputes:{' '}
      {disputes.map((d) => (
        <Link
          key={d.id}
          to={`/admin/disputes/${d.id}`}
          className="mr-2 text-accent hover:underline"
        >
          {d.ref} ({words(d.status)})
        </Link>
      ))}
    </p>
  );
}

/** One admin action on an order or booking: POST with a reason, then reload the list. */
const action = (base, id, path, reload) => async (body) => {
  await api(`${base}/${id}/${path}`, { method: 'POST', body });
  reload();
};

export function AdminOrdersPage() {
  return (
    <>
      <AdminHeading
        title="Orders"
        description="Every sale. Step in when a delivery cannot be confirmed or a pickup code is locked."
      />
      <AdminList
        path="/admin/orders"
        filename="orders.csv"
        search="Order ref or buyer/seller email"
        dates
        filters={[{ name: 'status', label: 'Status', options: statusOptions(ORDER_STATUSES) }]}
        columns={[
          { header: 'Order', cell: (o) => <span className="font-medium">{o.ref}</span> },
          {
            header: 'Buyer → seller',
            width: 'minmax(0,1.6fr)',
            cell: (o) => (
              <>
                <Link to={`/admin/users/${o.buyerId}`} className="hover:underline">
                  {o.buyer.displayName}
                </Link>{' '}
                →{' '}
                <Link to={`/admin/users/${o.sellerId}`} className="hover:underline">
                  {o.buyerView.seller.displayName}
                </Link>
              </>
            ),
          },
          { header: 'Total', cell: (o) => formatPaise(o.totalPaise) },
          { header: 'Status', cell: (o) => statusCell(o.status) },
          { header: 'Placed', cell: (o) => when(o.createdAt) },
        ]}
        expand={(o, reload) => (
          <div className="space-y-3 text-sm">
            <p className="text-muted">
              {o.items.map((i) => `${i.title} × ${i.quantity}`).join(', ')} ·{' '}
              {o.fulfilment === 'PICKUP' ? 'Pickup' : 'Delivery'} · commission{' '}
              {formatPaise(o.commissionPaise)} · seller gets {formatPaise(o.sellerPayablePaise)}
              {o.refundedPaise ? ` · refunded ${formatPaise(o.refundedPaise)}` : ''}
            </p>
            <DisputeLinks disputes={o.disputes} />
            <div className="flex flex-wrap gap-2">
              <ReasonAction
                label="Confirm delivery"
                description="Only with evidence that the buyer received it (SPEC 14). The 7-day issue window starts now."
                onConfirm={action('/admin/orders', o.id, 'verify-delivery', reload)}
              />
              {o.fulfilment === 'PICKUP' ? (
                <ReasonAction
                  label="Reset pickup code"
                  description="Unlocks the code after too many wrong tries."
                  onConfirm={action('/admin/orders', o.id, 'reset-handover-code', reload)}
                />
              ) : null}
              <ReasonAction
                label="Cancel and refund"
                variant="danger"
                tone="danger"
                description="The buyer gets everything back to their payment method. This cannot be undone."
                onConfirm={action('/admin/orders', o.id, 'cancel', reload)}
              />
            </div>
          </div>
        )}
      />
    </>
  );
}

export function AdminRentalsPage() {
  return (
    <>
      <AdminHeading
        title="Rentals"
        description="Every booking. Step in when a handover or return cannot be confirmed with the codes."
      />
      <AdminList
        path="/admin/rentals"
        filename="rentals.csv"
        search="Booking ref, title or email"
        dates
        filters={[{ name: 'status', label: 'Status', options: statusOptions(BOOKING_STATUSES) }]}
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
          {
            header: 'Renter → owner',
            width: 'minmax(0,1.5fr)',
            cell: (b) => (
              <>
                <Link to={`/admin/users/${b.renterId}`} className="hover:underline">
                  {b.renter.displayName}
                </Link>{' '}
                →{' '}
                <Link to={`/admin/users/${b.ownerId}`} className="hover:underline">
                  {b.renterView.owner.displayName}
                </Link>
              </>
            ),
          },
          { header: 'Dates', cell: (b) => rangeLabel(b.startDate, b.endDate) },
          { header: 'Status', cell: (b) => statusCell(b.status) },
        ]}
        expand={(b, reload) => (
          <div className="space-y-3 text-sm">
            <p className="text-muted">
              Fee {formatPaise(b.feePaise)} · deposit {formatPaise(b.depositPaise)} · total{' '}
              {formatPaise(b.totalPaise)} · commission {formatPaise(b.commissionPaise)}
            </p>
            <DisputeLinks disputes={b.disputes} />
            <div className="flex flex-wrap gap-2">
              <ReasonAction
                label="Confirm handover"
                description="Use when the handover code could not be entered and you have evidence it was handed over."
                onConfirm={action('/admin/rentals', b.id, 'verify-handover', reload)}
              />
              <ReasonAction
                label="Confirm return"
                description="Use when the return code could not be entered and you have evidence it came back. The 48-hour inspection starts now."
                onConfirm={action('/admin/rentals', b.id, 'verify-return', reload)}
              />
              <ReasonAction
                label="Cancel and refund"
                variant="danger"
                tone="danger"
                description="Before handover only. The renter gets everything back. This cannot be undone."
                onConfirm={action('/admin/rentals', b.id, 'cancel', reload)}
              />
            </div>
          </div>
        )}
      />
    </>
  );
}
