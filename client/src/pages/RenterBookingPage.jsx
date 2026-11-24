import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../auth/authContext.js';
import { MessageButton } from '../components/chat/MessageButton.jsx';
import { DisputeLinks } from '../components/disputes/DisputeLink.jsx';
import { ReviewPrompt } from '../components/reviews/ReviewPrompt.jsx';
import { PointMap } from '../components/map/Maps.jsx';
import { AddressBlock } from '../components/orders/OrderParts.jsx';
import {
  BookingDates,
  BookingHeading,
  BookingMoney,
  BookingNotFound,
  ClaimDetails,
  CodeWithPhotos,
  ConditionPhotos,
} from '../components/rentals/BookingParts.jsx';
import { Alert, Button, Card, Loading, SectionHeading, TextArea } from '../components/ui/index.js';
import { APP_NAME } from '../config/app.js';
import { api } from '../lib/api.js';
import { formatPaise } from '../lib/money.js';
import { when } from '../lib/orders.js';
import { loadRazorpay } from '../lib/razorpay.js';
import { photoForm } from '../lib/rentals.js';
import { useBooking, useBookingAction } from '../lib/useRentals.js';

function PayPanel({ booking, act, setBooking }) {
  const { user } = useAuth();
  const [paying, setPaying] = useState(false);

  async function simulate(outcome) {
    setPaying(true);
    act.setError(null);
    try {
      const { booking: updated } = await api(`/me/rentals/${booking.id}/simulate-payment`, {
        method: 'POST',
        body: { outcome },
      });
      setBooking(updated);
      if (updated.status !== 'CONFIRMED') {
        act.setError('The payment did not go through. You can try again.');
      }
    } catch (failure) {
      act.setError(failure.message);
    } finally {
      setPaying(false);
    }
  }

  async function payWithRazorpay() {
    setPaying(true);
    act.setError(null);
    try {
      let current = booking;
      if (!current.payment) {
        current = (await api(`/me/rentals/${booking.id}/pay`, { method: 'POST' })).booking;
        setBooking(current);
      }
      const Razorpay = await loadRazorpay();
      const { payment } = current;
      const checkout = new Razorpay({
        key: payment.keyId,
        amount: payment.amountPaise,
        currency: payment.currency,
        order_id: payment.gatewayOrderId,
        name: APP_NAME,
        description: `Rental ${booking.ref}`,
        prefill: { name: user.profile.displayName, email: user.email, contact: user.phone },
        handler: async (response) => {
          try {
            const { booking: updated } = await api(`/me/rentals/${booking.id}/verify`, {
              method: 'POST',
              body: {
                gatewayOrderId: response.razorpay_order_id,
                gatewayPaymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              },
            });
            setBooking(updated);
          } catch (failure) {
            act.setError(failure.message);
          } finally {
            setPaying(false);
          }
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      checkout.on('payment.failed', () =>
        act.setError('The payment did not go through. You can try again.'),
      );
      checkout.open();
    } catch (failure) {
      act.setError(failure.message);
      setPaying(false);
    }
  }

  // Which gateway is known once the payment is started.
  const gateway = booking.payment?.gateway;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink">
        The owner approved your request. Pay {formatPaise(booking.totalPaise)} by{' '}
        {when(booking.paymentDueAt)} to book it; otherwise the dates are released.
      </p>
      {gateway === 'razorpay' ? (
        <>
          <Button loading={paying} onClick={payWithRazorpay}>
            Pay {formatPaise(booking.totalPaise)}
          </Button>
          <p className="text-xs text-muted">
            Test mode: no real money is taken. Use Razorpay’s test UPI or card details.
          </p>
        </>
      ) : gateway === 'simulated' ? (
        <>
          <p className="text-sm text-muted">
            Payments are not connected yet, so this is a simulation. No money moves.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button loading={paying} onClick={() => simulate('success')}>
              Pay {formatPaise(booking.totalPaise)} (test simulation)
            </Button>
            <Button variant="secondary" disabled={paying} onClick={() => simulate('failure')}>
              Simulate a failed payment
            </Button>
          </div>
        </>
      ) : (
        <Button loading={act.busy === 'pay'} onClick={() => act.run('pay')}>
          Go to payment
        </Button>
      )}
    </div>
  );
}

function CancelPanel({ booking, act }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {booking.paidAt ? 'Cancel booking…' : 'Cancel request…'}
      </Button>
    );
  }
  const refund = booking.cancelRefundPaise;
  const feeBack = refund !== null ? refund - booking.depositPaise - booking.deliveryChargePaise : 0;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink">
        {refund === null
          ? 'Nothing has been charged, so cancelling is free.'
          : `You get back ${formatPaise(refund)}: the deposit${
              booking.deliveryChargePaise ? ', the delivery charge' : ''
            } and ${
              feeBack > 0
                ? `${formatPaise(feeBack)} of the rental fee (half, as it is before the start day)`
                : 'none of the rental fee (it is the start day or later)'
            }.`}
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
          Yes, cancel
        </Button>
        <Button variant="secondary" disabled={act.busy !== null} onClick={() => setOpen(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

function ClaimAnswer({ booking, act }) {
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState('');
  const { claim } = booking;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink">
        The owner reports damage and asks for {formatPaise(claim.totalPaise)} from your deposit.
        Answer by {when(claim.respondDueAt)}; if you do not, our team decides.
      </p>
      {disputing ? (
        <>
          <TextArea
            label="Why do you disagree?"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              variant="danger"
              loading={act.busy === 'claim-response'}
              disabled={reason.trim().length < 5}
              onClick={() => act.run('claim-response', { accept: false, reason: reason.trim() })}
            >
              Send to review
            </Button>
            <Button variant="secondary" onClick={() => setDisputing(false)}>
              Back
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button
            loading={act.busy === 'claim-response'}
            onClick={() => act.run('claim-response', { accept: true })}
          >
            Accept {formatPaise(claim.totalPaise)}
          </Button>
          <Button variant="secondary" onClick={() => setDisputing(true)}>
            I disagree
          </Button>
        </div>
      )}
    </div>
  );
}

function LateFeeDispute({ booking, act }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <div>
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Dispute the late fee…
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <TextArea
        label={`Why should the late fee of ${formatPaise(booking.lateFeePaise)} not apply?`}
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="flex flex-wrap gap-3">
        <Button
          loading={act.busy === 'dispute-late-fee'}
          disabled={reason.trim().length < 5}
          onClick={() => act.run('dispute-late-fee', { reason: reason.trim() })}
        >
          Send
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </div>
  );
}

const STATUS_NOTES = {
  REQUESTED: (b) => [
    'info',
    'Request sent',
    `The owner has until ${when(b.holdExpiresAt)} to answer. The dates are held for you until then; nothing is charged.`,
  ],
  RETURNED: (b) => [
    'info',
    'Thank you for returning it',
    `The owner has until ${when(b.inspectionEndsAt)} to check it. If they report nothing, your deposit${
      b.lateFeePaise ? ' less the late fee' : ''
    } comes back automatically.`,
  ],
  ADMIN_REVIEW: () => [
    'notice',
    'Being reviewed',
    'Our team is deciding how the deposit is settled. We will email you.',
  ],
  SETTLING: (b) => [
    'info',
    'Deposit on its way',
    `${formatPaise(b.depositPaise - b.depositDeductedPaise)} of your deposit is being refunded.`,
  ],
  COMPLETED: () => ['success', 'All done', 'Thank you for renting.'],
  DECLINED: () => [
    'info',
    'Declined',
    'The owner could not rent it for these dates. Nothing was charged.',
  ],
  EXPIRED: (b) => [
    'info',
    'Expired',
    b.paidAt
      ? 'This booking expired.'
      : 'This request expired before it was approved or paid. Nothing was charged.',
  ],
};

export default function RenterBookingPage() {
  const { id } = useParams();
  const location = useLocation();
  const { loading, booking, error, setBooking } = useBooking('renter', id);
  const act = useBookingAction('renter', id, setBooking);

  if (loading) return <Loading label="Loading booking" />;
  if (error) return <BookingNotFound error={error} back="/rentals" />;
  const can = (action) => booking.actions.includes(action);
  const note = STATUS_NOTES[booking.status]?.(booking);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      {location.state?.notice ? <Alert tone="success">{location.state.notice}</Alert> : null}
      <BookingHeading booking={booking} side="renter" />
      <DisputeLinks disputes={booking.disputes} />
      {booking.status === 'COMPLETED' ? <ReviewPrompt about={{ bookingId: booking.id }} /> : null}
      {note ? (
        <Alert tone={note[0]} title={note[1]}>
          {note[2]}
        </Alert>
      ) : null}

      {booking.handoverCode ? (
        <Card className="border-accent/40">
          <SectionHeading
            title="Your handover code"
            description="Give it to the owner (or their delivery person) when you receive the item, not before."
          />
          <p className="font-mono text-4xl font-semibold tracking-[0.3em] text-ink">
            {booking.handoverCode}
          </p>
        </Card>
      ) : null}

      {act.error ? <Alert tone="error">{act.error}</Alert> : null}

      {booking.actions.length > 0 ? (
        <Card>
          <div className="space-y-6">
            {can('pay') ? <PayPanel booking={booking} act={act} setBooking={setBooking} /> : null}
            {can('return') ? (
              <CodeWithPhotos
                intro={`Return it by ${when(booking.returnDueAt)}. When you hand it back, ask the owner for their return code and photograph the item.`}
                codeLabel="Owner’s return code"
                button="Confirm return"
                busy={act.busy === 'return'}
                onSubmit={(code, files) => act.run('return', photoForm({ code }, files))}
              />
            ) : null}
            {can('claim-response') ? <ClaimAnswer booking={booking} act={act} /> : null}
            {booking.lateFeePaise > 0 && ['RETURNED', 'CLAIM_OPEN'].includes(booking.status) ? (
              <p className="text-sm text-ink">
                It came back late, so a late fee of {formatPaise(booking.lateFeePaise)} comes out of
                the deposit.
                {booking.lateFeeDisputed ? ' You disputed it; our team will decide.' : ''}
              </p>
            ) : null}
            {can('dispute-late-fee') ? <LateFeeDispute booking={booking} act={act} /> : null}
            {can('cancel') ? <CancelPanel booking={booking} act={act} /> : null}
          </div>
        </Card>
      ) : null}

      {booking.claim ? <ClaimDetails claim={booking.claim} /> : null}
      <BookingMoney booking={booking} />
      <ConditionPhotos booking={booking} />

      <Card>
        <div className="space-y-4">
          <BookingDates booking={booking} side="renter" />
          {booking.fulfilment === 'DELIVERY' ? (
            <AddressBlock address={booking.deliveryAddress} />
          ) : null}
          {booking.pickup ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">Pickup spot</p>
              <p className="text-sm text-muted">Around {booking.pickup.locality}</p>
              <PointMap point={booking.pickup} />
              <a
                href={`https://www.openstreetmap.org/?mlat=${booking.pickup.lat}&mlon=${booking.pickup.lng}#map=17/${booking.pickup.lat}/${booking.pickup.lng}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                Open in OpenStreetMap
              </a>
            </div>
          ) : booking.fulfilment === 'PICKUP' && !booking.paidAt ? (
            <p className="text-sm text-muted">
              Around {booking.locality}. The exact pickup spot is shown once you have paid.
            </p>
          ) : null}
          <div className="text-sm">
            <p className="font-medium text-ink">Owner</p>
            <p className="text-muted">
              {booking.owner.displayName}
              {booking.owner.phone ? ` · ${booking.owner.phone}` : ''}
            </p>
            <div className="mt-2">
              <MessageButton about={{ bookingId: booking.id }} size="sm">
                Message owner
              </MessageButton>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
