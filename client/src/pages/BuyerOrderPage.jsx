import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MessageButton } from '../components/chat/MessageButton.jsx';
import { DisputeLinks } from '../components/disputes/DisputeLink.jsx';
import { ReviewPrompt } from '../components/reviews/ReviewPrompt.jsx';
import { PointMap } from '../components/map/Maps.jsx';
import {
  AddressBlock,
  KeyDates,
  OrderHeading,
  OrderItems,
  OrderNotFound,
} from '../components/orders/OrderParts.jsx';
import {
  Alert,
  Button,
  Card,
  Loading,
  SectionHeading,
  SelectField,
  TextArea,
} from '../components/ui/index.js';
import { api } from '../lib/api.js';
import { useOrder } from '../lib/useOrders.js';
import { photoProblem } from '../lib/listingForm.js';
import { ISSUE_KINDS, when } from '../lib/orders.js';
import { formatPaise } from '../lib/money.js';

function useAction(orderId, setOrder) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  async function run(action, body) {
    setBusy(action);
    setError(null);
    try {
      const { order } = await api(`/me/orders/${orderId}/${action}`, { method: 'POST', body });
      setOrder(order);
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, run };
}

function CancelPanel({ order, act }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Cancel order…
      </Button>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink">
        You will get a full refund of {formatPaise(order.totalPaise - order.refundedPaise)} to your
        original payment method.
      </p>
      <TextArea
        label="Reason (optional)"
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="flex flex-wrap gap-3">
        <Button
          variant="danger"
          loading={act.busy === 'cancel'}
          onClick={() => act.run('cancel', reason.trim() ? { reason: reason.trim() } : {})}
        >
          Yes, cancel it
        </Button>
        <Button variant="secondary" disabled={act.busy !== null} onClick={() => setOpen(false)}>
          Keep the order
        </Button>
      </div>
    </div>
  );
}

function ReceiptPanel({ act }) {
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink">The seller says this was delivered. Did you get it?</p>
      {reporting ? (
        <>
          <TextArea
            label="What happened?"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              variant="danger"
              loading={act.busy === 'not-received'}
              onClick={() =>
                act.run('not-received', reason.trim() ? { reason: reason.trim() } : {})
              }
            >
              Report it did not arrive
            </Button>
            <Button
              variant="secondary"
              disabled={act.busy !== null}
              onClick={() => setReporting(false)}
            >
              Back
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button loading={act.busy === 'confirm'} onClick={() => act.run('confirm')}>
            Yes, I received it
          </Button>
          <Button
            variant="secondary"
            disabled={act.busy !== null}
            onClick={() => setReporting(true)}
          >
            It did not arrive
          </Button>
        </div>
      )}
    </div>
  );
}

function IssuePanel({ order, setOrder }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('DAMAGED');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const input = useRef(null);

  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Report a problem…
        </Button>
        <p className="mt-2 text-sm text-muted">
          Wrong, damaged or not as described? You can report it until{' '}
          {when(order.issueWindowEndsAt)}.
        </p>
      </div>
    );
  }

  function choose(event) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = '';
    const problem = chosen.map(photoProblem).find(Boolean);
    setError(problem ?? null);
    setFiles((current) =>
      [...current, ...chosen.filter((file) => !photoProblem(file))].slice(0, 5),
    );
  }

  async function send() {
    if (description.trim().length < 10) {
      setError('Describe the problem in at least 10 characters.');
      return;
    }
    if (files.length === 0) {
      setError('Add at least one photo of the problem.');
      return;
    }
    const body = new FormData();
    body.append('data', JSON.stringify({ kind, description: description.trim() }));
    files.forEach((file) => body.append('photos', file));
    setSending(true);
    setError(null);
    try {
      setOrder((await api(`/me/orders/${order.id}/issue`, { method: 'POST', body })).order);
    } catch (failure) {
      setError(failure.message);
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      <SelectField
        label="What is wrong?"
        options={ISSUE_KINDS}
        value={kind}
        onChange={(event) => setKind(event.target.value)}
      />
      <TextArea
        label="Describe the problem"
        rows={3}
        maxLength={1000}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <div>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={choose}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={files.length >= 5}
          onClick={() => input.current?.click()}
        >
          Add photos
        </Button>
        <p className="mt-1 text-sm text-muted">
          {files.length ? files.map((file) => file.name).join(', ') : 'At least 1 photo, up to 5.'}
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button loading={sending} onClick={send}>
          Send report
        </Button>
        <Button variant="secondary" disabled={sending} onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </div>
  );
}

export default function BuyerOrderPage() {
  const { id } = useParams();
  const { loading, order, error, setOrder } = useOrder('buyer', id);
  const act = useAction(id, setOrder);

  if (loading) return <Loading label="Loading order" />;
  if (error) return <OrderNotFound error={error} back="/orders" />;
  const can = (action) => order.actions.includes(action);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <OrderHeading order={order} side="buyer" />
      <DisputeLinks disputes={order.disputes} />
      {order.status === 'COMPLETED' ? <ReviewPrompt about={{ orderId: order.id }} /> : null}

      {order.cancellationOffered ? (
        <Alert tone="notice" title="The seller has not sent this yet">
          The deadline to send it has passed. You can cancel for a full refund, or keep waiting.
        </Alert>
      ) : null}
      {order.status === 'ADMIN_REVIEW' ? (
        <Alert tone="notice" title="Being reviewed">
          Delivery was not confirmed, so our team is looking into it. We will email you.
        </Alert>
      ) : null}
      {order.issue ? (
        <Alert
          tone={order.issue.status === 'OPEN' ? 'notice' : 'info'}
          title={order.issue.status === 'OPEN' ? 'Problem reported' : 'Problem resolved'}
        >
          {order.issue.status === 'OPEN'
            ? 'Our team is reviewing your report.'
            : order.issue.resolution === 'REJECTED'
              ? 'After review, no refund was given for this report.'
              : `A refund of ${formatPaise(order.issue.refundPaise)} was given.`}
        </Alert>
      ) : null}

      {order.handoverCode ? (
        <Card className="border-accent/40">
          <SectionHeading
            title="Your pickup code"
            description="Show this to the seller when you collect the item. Do not share it before."
          />
          <p className="font-mono text-4xl font-semibold tracking-[0.3em] text-ink">
            {order.handoverCode}
          </p>
        </Card>
      ) : null}

      {act.error ? <Alert tone="error">{act.error}</Alert> : null}

      {order.actions.length > 0 ? (
        <Card>
          <div className="space-y-5">
            {can('extension') ? (
              <div className="space-y-3">
                <p className="text-sm text-ink">
                  The seller asks for more time: they would send it by {when(order.extension.until)}
                  .
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    loading={act.busy === 'extension'}
                    onClick={() => act.run('extension', { accept: true })}
                  >
                    Allow more time
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={act.busy !== null}
                    onClick={() => act.run('extension', { accept: false })}
                  >
                    No, keep the deadline
                  </Button>
                </div>
              </div>
            ) : null}
            {can('confirm') ? <ReceiptPanel act={act} /> : null}
            {can('issue') ? <IssuePanel order={order} setOrder={setOrder} /> : null}
            {can('cancel') ? <CancelPanel order={order} act={act} /> : null}
          </div>
        </Card>
      ) : null}

      <OrderItems order={order} />

      <Card>
        <div className="space-y-4">
          <KeyDates order={order} />
          {order.courierReference ? (
            <p className="text-sm">
              <span className="text-muted">Tracking reference:</span> {order.courierReference}
            </p>
          ) : null}
          <AddressBlock address={order.deliveryAddress} />
          {order.items.some((item) => item.pickup) ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">Pickup spot</p>
              {order.items
                .filter((item) => item.pickup)
                .slice(0, 1)
                .map((item) => (
                  <div key={item.listingId} className="space-y-2">
                    <p className="text-sm text-muted">Around {item.pickup.locality}</p>
                    <PointMap point={item.pickup} />
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${item.pickup.lat}&mlon=${item.pickup.lng}#map=17/${item.pickup.lat}/${item.pickup.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-accent underline-offset-4 hover:underline"
                    >
                      Open in OpenStreetMap
                    </a>
                  </div>
                ))}
            </div>
          ) : null}
          <div className="text-sm">
            <p className="font-medium text-ink">Seller</p>
            <p className="text-muted">
              {order.seller.displayName}
              {order.seller.phone ? ` · ${order.seller.phone}` : ''}
            </p>
            <div className="mt-2">
              <MessageButton about={{ orderId: order.id }} size="sm">
                Message seller
              </MessageButton>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
