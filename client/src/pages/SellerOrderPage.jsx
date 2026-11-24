import { useState } from 'react';
import { MessageButton } from '../components/chat/MessageButton.jsx';
import { DisputeLinks } from '../components/disputes/DisputeLink.jsx';
import { ReviewPrompt } from '../components/reviews/ReviewPrompt.jsx';
import { useParams } from 'react-router-dom';
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
  SelectField,
  TextArea,
  TextField,
} from '../components/ui/index.js';
import { api } from '../lib/api.js';
import { useOrder } from '../lib/useOrders.js';
import { formatPaise } from '../lib/money.js';
import { when } from '../lib/orders.js';

export default function SellerOrderPage() {
  const { id } = useParams();
  const { loading, order, error, setOrder } = useOrder('seller', id);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [courier, setCourier] = useState('');
  const [code, setCode] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('2');

  if (loading) return <Loading label="Loading order" />;
  if (error) return <OrderNotFound error={error} back="/sales" />;
  const can = (action) => order.actions.includes(action);

  async function run(action, body) {
    setBusy(action);
    setActionError(null);
    try {
      setOrder((await api(`/me/sales/${id}/${action}`, { method: 'POST', body })).order);
      setCode('');
    } catch (failure) {
      setActionError(
        failure.code === 'WRONG_HANDOVER_CODE'
          ? `${failure.message}. ${failure.details?.attemptsLeft ?? 0} tries left.`
          : failure.message,
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <OrderHeading order={order} side="seller" />
      <DisputeLinks disputes={order.disputes} />
      {order.status === 'COMPLETED' ? <ReviewPrompt about={{ orderId: order.id }} /> : null}

      {order.dispatchOverdue && order.status === 'AWAITING_DISPATCH' ? (
        <Alert tone="notice" title="This order is late">
          It was due to be sent by {when(order.dispatchDueAt)}. The buyer can now cancel it for a
          full refund.
        </Alert>
      ) : null}
      {order.issue?.status === 'OPEN' ? (
        <Alert tone="notice" title="The buyer reported a problem">
          {order.issue.description} Our team is reviewing it; payment for this order is on hold.
        </Alert>
      ) : null}
      {actionError ? <Alert tone="error">{actionError}</Alert> : null}

      {order.actions.length > 0 ? (
        <Card>
          <div className="space-y-5">
            {can('handover') ? (
              <div className="space-y-3">
                <p className="text-sm text-ink">
                  When the buyer collects the item, ask for their 6-digit pickup code and enter it
                  here.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-40">
                    <TextField
                      label="Pickup code"
                      inputMode="numeric"
                      maxLength={6}
                      className="font-mono tracking-[0.3em]"
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                    />
                  </div>
                  <Button
                    loading={busy === 'handover'}
                    disabled={code.length !== 6}
                    onClick={() => run('handover', { code })}
                  >
                    Confirm handover
                  </Button>
                </div>
                <p className="text-xs text-muted">{order.handoverAttemptsLeft} tries left.</p>
              </div>
            ) : null}

            {can('dispatch') ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-0 flex-1">
                    <TextField
                      label="Courier and tracking reference (optional)"
                      maxLength={100}
                      value={courier}
                      onChange={(event) => setCourier(event.target.value)}
                    />
                  </div>
                  <Button
                    loading={busy === 'dispatch'}
                    onClick={() =>
                      run('dispatch', courier.trim() ? { courierReference: courier.trim() } : {})
                    }
                  >
                    Mark as sent
                  </Button>
                </div>
              </div>
            ) : null}

            {can('deliver') ? (
              <div>
                <Button
                  variant="secondary"
                  loading={busy === 'deliver'}
                  onClick={() => run('deliver')}
                >
                  Mark as delivered
                </Button>
                <p className="mt-2 text-sm text-muted">The buyer then confirms they received it.</p>
              </div>
            ) : null}

            {can('extension') ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-48">
                  <SelectField
                    label="Need more time to send?"
                    options={[1, 2, 3].map((n) => ({
                      value: String(n),
                      label: `${n} more business day${n > 1 ? 's' : ''}`,
                    }))}
                    value={days}
                    onChange={(event) => setDays(event.target.value)}
                  />
                </div>
                <Button
                  variant="secondary"
                  loading={busy === 'extension'}
                  onClick={() => run('extension', { businessDays: Number(days) })}
                >
                  Ask the buyer
                </Button>
              </div>
            ) : null}
            {order.extension.status === 'REQUESTED' ? (
              <p className="text-sm text-muted">
                You asked for more time (until {when(order.extension.until)}). Waiting for the
                buyer.
              </p>
            ) : null}

            {can('cancel') ? (
              cancelling ? (
                <div className="space-y-3">
                  <TextArea
                    label="Why are you cancelling?"
                    rows={2}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="danger"
                      loading={busy === 'cancel'}
                      disabled={reason.trim().length < 5}
                      onClick={() => run('cancel', { reason: reason.trim() })}
                    >
                      Cancel and refund the buyer
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => setCancelling(false)}
                    >
                      Back
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => setCancelling(true)}>
                  Cancel order…
                </Button>
              )
            ) : null}
          </div>
        </Card>
      ) : null}

      <OrderItems
        order={order}
        extra={
          <>
            <div className="flex justify-between text-muted">
              <dt>Platform commission (10% of items)</dt>
              <dd>−{formatPaise(order.commissionPaise)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>You receive</dt>
              <dd>{formatPaise(order.sellerPayablePaise)}</dd>
            </div>
            <p className="text-xs text-muted">
              {order.payoutEligible
                ? 'Complete: included in your next payout.'
                : 'Paid out once the buyer has it and the 7-day problem window has passed.'}
            </p>
          </>
        }
      />

      <Card>
        <div className="space-y-4">
          <KeyDates order={order} />
          <AddressBlock address={order.deliveryAddress} />
          <div className="text-sm">
            <p className="font-medium text-ink">Buyer</p>
            <p className="text-muted">
              {order.buyer.displayName}
              {order.buyer.phone ? ` · ${order.buyer.phone}` : ''}
            </p>
            <div className="mt-2">
              <MessageButton about={{ orderId: order.id }} size="sm">
                Message buyer
              </MessageButton>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
