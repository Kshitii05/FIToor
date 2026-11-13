import { Link } from 'react-router-dom';
import { formatPaise } from '../../lib/money.js';
import { addressLines, orderStatus, when } from '../../lib/orders.js';
import { Alert, Badge, ButtonLink, Card } from '../ui/index.js';

export function OrderStatusBadge({ status, side }) {
  const { label, tone } = orderStatus(status, side);
  return <Badge tone={tone}>{label}</Badge>;
}

export function OrderNotFound({ error, back }) {
  return (
    <div className="mx-auto max-w-md">
      <Alert tone={error.status === 404 ? 'notice' : 'error'}>
        {error.status === 404 ? 'This order does not exist, or is not yours.' : error.message}
      </Alert>
      <ButtonLink to={back} variant="secondary" className="mt-5">
        Back
      </ButtonLink>
    </div>
  );
}

export function OrderHeading({ order, side }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          Order {order.ref}
        </h1>
        <OrderStatusBadge status={order.status} side={side} />
      </div>
      <p className="mt-1 text-sm text-muted">
        Placed {when(order.createdAt)} ·{' '}
        {order.fulfilment === 'DELIVERY' ? 'Home delivery' : 'Local pickup'}
      </p>
    </div>
  );
}

export function OrderItems({ order, extra }) {
  return (
    <Card>
      <ul className="divide-y divide-line">
        {order.items.map((item) => (
          <li key={item.listingId} className="flex justify-between gap-3 py-2 text-sm">
            <Link
              to={`/listings/${item.listingId}`}
              className="min-w-0 break-words text-ink underline-offset-4 hover:underline"
            >
              {item.title}
              {item.quantity > 1 ? ` × ${item.quantity}` : ''}
            </Link>
            <span className="shrink-0 text-ink">
              {formatPaise(item.unitPricePaise * item.quantity)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
        {order.deliveryChargePaise > 0 ? (
          <div className="flex justify-between">
            <dt className="text-muted">Delivery</dt>
            <dd>{formatPaise(order.deliveryChargePaise)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between font-semibold">
          <dt>Total paid</dt>
          <dd>{formatPaise(order.totalPaise)}</dd>
        </div>
        {order.refundedPaise > 0 ? (
          <div className="flex justify-between text-success">
            <dt>Refunded</dt>
            <dd>{formatPaise(order.refundedPaise)}</dd>
          </div>
        ) : null}
        {extra}
      </dl>
    </Card>
  );
}

export function AddressBlock({ address, title = 'Deliver to' }) {
  if (!address) return null;
  return (
    <div className="text-sm">
      <p className="font-medium text-ink">{title}</p>
      {addressLines(address).map((line) => (
        <p key={line} className="break-words text-muted">
          {line}
        </p>
      ))}
    </div>
  );
}

export function KeyDates({ order }) {
  const rows = [
    ['Must be sent by', order.status === 'AWAITING_DISPATCH' ? order.dispatchDueAt : null],
    ['Sent', order.dispatchedAt],
    ['Marked delivered by seller', order.deliveryReportedAt],
    ['Confirm or report by', order.status === 'DELIVERY_REPORTED' ? order.receiptDueAt : null],
    ['Received', order.deliveredAt],
    [
      'Problems can be reported until',
      order.status === 'DELIVERED' ? order.issueWindowEndsAt : null,
    ],
    ['Completed', order.completedAt],
    ['Cancelled', order.cancelledAt],
  ].filter(([, value]) => value);
  if (rows.length === 0) return null;
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted">{label}</dt>
          <dd className="text-ink">{when(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OrderRow({ order, side }) {
  const to = side === 'buyer' ? `/orders/${order.id}` : `/sales/${order.id}`;
  const other = side === 'buyer' ? order.seller : order.buyer;
  const attention =
    (side === 'buyer' &&
      order.actions.some((action) => ['confirm', 'extension'].includes(action))) ||
    (side === 'seller' &&
      order.actions.some((action) => ['dispatch', 'handover'].includes(action))) ||
    order.cancellationOffered;
  return (
    <li>
      <Link
        to={to}
        className="block rounded-card border border-line bg-surface p-4 shadow-card transition-shadow hover:shadow-lg"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-ink">{order.ref}</p>
          <OrderStatusBadge status={order.status} side={side} />
        </div>
        <p className="mt-1 truncate text-sm text-muted">
          {order.items.map((item) => item.title).join(', ')}
        </p>
        <p className="mt-1 text-sm text-muted">
          {formatPaise(order.totalPaise)} · {side === 'buyer' ? 'from' : 'to'} {other.displayName} ·{' '}
          {when(order.createdAt)}
        </p>
        {attention ? (
          <p className="mt-1 text-sm font-medium text-notice">Needs your attention</p>
        ) : null}
      </Link>
    </li>
  );
}
