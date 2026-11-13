import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AddressBlock } from '../components/orders/OrderParts.jsx';
import {
  BookingDates,
  BookingHeading,
  BookingMoney,
  BookingNotFound,
  ClaimDetails,
  CodeWithPhotos,
  ConditionPhotos,
  MoneyRow,
  PhotoPicker,
} from '../components/rentals/BookingParts.jsx';
import {
  Alert,
  Button,
  Card,
  Loading,
  SectionHeading,
  TextArea,
  TextField,
} from '../components/ui/index.js';
import { formatPaise, rupeesToPaise } from '../lib/money.js';
import { when } from '../lib/orders.js';
import { CLAIM_PHOTOS_MAX, photoForm } from '../lib/rentals.js';
import { useBooking, useBookingAction } from '../lib/useRentals.js';

function RequestPanel({ booking, act }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink">
        {booking.renter.displayName} wants to rent this for {booking.durationDays} days. Answer by{' '}
        {when(booking.holdExpiresAt)}; the dates are held until then. Once you approve, they have 12
        hours to pay.
      </p>
      {declining ? (
        <>
          <TextArea
            label="Reason (optional, shown to the renter)"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              variant="danger"
              loading={act.busy === 'decline'}
              onClick={() => act.run('decline', reason.trim() ? { reason: reason.trim() } : {})}
            >
              Decline
            </Button>
            <Button variant="secondary" onClick={() => setDeclining(false)}>
              Back
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button loading={act.busy === 'approve'} onClick={() => act.run('approve')}>
            Approve
          </Button>
          <Button
            variant="secondary"
            disabled={act.busy !== null}
            onClick={() => setDeclining(true)}
          >
            Decline…
          </Button>
        </div>
      )}
    </div>
  );
}

function CancelPanel({ booking, act }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Cancel booking…
      </Button>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink">
        {booking.paidAt
          ? `The renter gets everything back (${formatPaise(booking.totalPaise)}).`
          : 'Nothing has been paid yet.'}
      </p>
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
          loading={act.busy === 'cancel'}
          disabled={reason.trim().length < 5}
          onClick={() => act.run('cancel', { reason: reason.trim() })}
        >
          Cancel booking
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </div>
  );
}

const emptyItem = () => ({ label: '', amount: '' });

function InspectionPanel({ booking, act }) {
  const [claiming, setClaiming] = useState(false);
  const [description, setDescription] = useState('');
  const [items, setItems] = useState([emptyItem()]);
  const [files, setFiles] = useState([]);
  const [problem, setProblem] = useState(null);
  const total = items.reduce((sum, item) => sum + (rupeesToPaise(item.amount) ?? 0), 0);

  function send() {
    const parsed = items
      .filter((item) => item.label.trim() || item.amount.trim())
      .map((item) => ({ label: item.label.trim(), amountPaise: rupeesToPaise(item.amount) }));
    if (description.trim().length < 10)
      return setProblem('Describe the damage in at least 10 characters.');
    if (parsed.length === 0 || parsed.some((item) => item.label.length < 2 || !item.amountPaise)) {
      return setProblem('Give each cost a name and an amount in rupees.');
    }
    if (files.length < 1) return setProblem('Add at least one photo of the damage.');
    setProblem(null);
    return act.run('claim', photoForm({ description: description.trim(), items: parsed }, files));
  }

  const update = (index, field) => (event) =>
    setItems(
      items.map((item, i) => (i === index ? { ...item, [field]: event.target.value } : item)),
    );

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink">
        It came back {when(booking.returnedAt)}. Check it by {when(booking.inspectionEndsAt)}. If
        you do nothing, the deposit
        {booking.lateFeePaise > 0
          ? ` less the late fee of ${formatPaise(booking.lateFeePaise)}`
          : ''}{' '}
        goes back to the renter automatically.
      </p>
      {claiming ? (
        <div className="space-y-3">
          <TextArea
            label="What is damaged?"
            rows={3}
            maxLength={1000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-ink">Costs</legend>
            {items.map((item, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <TextField
                    label="For"
                    placeholder="Repairing the torn hem"
                    maxLength={80}
                    value={item.label}
                    onChange={update(index, 'label')}
                  />
                </div>
                <div className="w-32">
                  <TextField
                    label="Amount"
                    prefix="₹"
                    inputMode="decimal"
                    value={item.amount}
                    onChange={update(index, 'amount')}
                  />
                </div>
              </div>
            ))}
            {items.length < 10 ? (
              <Button variant="ghost" size="sm" onClick={() => setItems([...items, emptyItem()])}>
                Add a cost
              </Button>
            ) : null}
          </fieldset>
          <p className="text-sm text-ink">
            Total {formatPaise(total)}
            {total > booking.depositPaise
              ? `. Only ${formatPaise(booking.depositPaise)} (the deposit) can be taken through us; the rest is recorded as owed.`
              : ''}
          </p>
          <PhotoPicker
            files={files}
            onChange={setFiles}
            min={1}
            max={CLAIM_PHOTOS_MAX}
            hint="Photos of the damage: at least 1, up to 8. The handover photos are kept for comparison."
          />
          {problem ? (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button variant="danger" loading={act.busy === 'claim'} onClick={send}>
              Send claim
            </Button>
            <Button variant="secondary" onClick={() => setClaiming(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button loading={act.busy === 'inspection-ok'} onClick={() => act.run('inspection-ok')}>
            It is fine
          </Button>
          <Button
            variant="secondary"
            disabled={act.busy !== null}
            onClick={() => setClaiming(true)}
          >
            Report damage…
          </Button>
        </div>
      )}
    </div>
  );
}

const STATUS_NOTES = {
  APPROVED: (b) => [
    'info',
    'Approved',
    `Waiting for the renter to pay by ${when(b.paymentDueAt)}.`,
  ],
  CLAIM_OPEN: (b) => [
    'notice',
    'Claim sent',
    `The renter has until ${when(b.claim.respondDueAt)} to accept or dispute it.`,
  ],
  ADMIN_REVIEW: () => [
    'notice',
    'Being reviewed',
    'Our team is deciding how the deposit is settled. We will email you.',
  ],
  SETTLING: () => ['info', 'Settling', 'The deposit is being settled.'],
  COMPLETED: () => ['success', 'Completed', 'Your earnings are included in your next payout.'],
};

export default function OwnerBookingPage() {
  const { id } = useParams();
  const { loading, booking, error, setBooking } = useBooking('owner', id);
  const act = useBookingAction('owner', id, setBooking);

  if (loading) return <Loading label="Loading booking" />;
  if (error) return <BookingNotFound error={error} back="/rented-out" />;
  const can = (action) => booking.actions.includes(action);
  const note = STATUS_NOTES[booking.status]?.(booking);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <BookingHeading booking={booking} side="owner" />
      {note ? (
        <Alert tone={note[0]} title={note[1]}>
          {note[2]}
        </Alert>
      ) : null}
      {booking.lateFeeDisputed && ['RETURNED', 'CLAIM_OPEN'].includes(booking.status) ? (
        <Alert tone="notice" title="The renter disputes the late fee">
          Our team will decide it when the deposit is settled.
        </Alert>
      ) : null}

      {booking.returnCode ? (
        <Card className="border-accent/40">
          <SectionHeading
            title="Your return code"
            description="Give it to the renter when they bring the item back, not before."
          />
          <p className="font-mono text-4xl font-semibold tracking-[0.3em] text-ink">
            {booking.returnCode}
          </p>
          <p className="mt-2 text-sm text-muted">Due back by {when(booking.returnDueAt)}.</p>
        </Card>
      ) : null}

      {act.error ? <Alert tone="error">{act.error}</Alert> : null}

      {booking.actions.length > 0 ? (
        <Card>
          <div className="space-y-6">
            {can('approve') ? <RequestPanel booking={booking} act={act} /> : null}
            {can('handover') ? (
              <CodeWithPhotos
                intro={`Hand it over from ${booking.startDate}. Ask the renter for their 6-digit code and photograph the item's condition first.`}
                codeLabel="Renter’s code"
                button="Confirm handover"
                busy={act.busy === 'handover'}
                attemptsLeft={booking.handoverAttemptsLeft}
                onSubmit={(code, files) => act.run('handover', photoForm({ code }, files))}
              />
            ) : null}
            {can('inspection-ok') ? <InspectionPanel booking={booking} act={act} /> : null}
            {can('report-non-return') ? (
              <div className="space-y-2">
                <p className="text-sm text-ink">
                  It was due back {when(booking.returnDueAt)} and has not come back.
                </p>
                <Button
                  variant="danger"
                  loading={act.busy === 'report-non-return'}
                  onClick={() => act.run('report-non-return')}
                >
                  Report it to our team
                </Button>
              </div>
            ) : null}
            {can('cancel') ? <CancelPanel booking={booking} act={act} /> : null}
          </div>
        </Card>
      ) : null}

      {booking.claim ? <ClaimDetails claim={booking.claim} /> : null}
      <BookingMoney
        booking={booking}
        extra={
          <>
            <MoneyRow
              label="Platform commission (10% of the rental)"
              value={`−${formatPaise(booking.commissionKeptPaise)}`}
            />
            <MoneyRow strong label="You receive" value={formatPaise(booking.ownerEarningsPaise)} />
            <p className="text-xs text-muted">
              {booking.payoutEligible
                ? 'Complete: included in your next payout.'
                : 'The deposit is never yours to keep; only agreed late fees or damage come out of it. Paid out once the deposit is settled.'}
            </p>
          </>
        }
      />
      <ConditionPhotos booking={booking} />

      <Card>
        <div className="space-y-4">
          <BookingDates booking={booking} side="owner" />
          {booking.fulfilment === 'DELIVERY' ? (
            booking.deliveryAddress ? (
              <AddressBlock address={booking.deliveryAddress} />
            ) : (
              <p className="text-sm text-muted">
                Home delivery. The address is shown once the booking is paid.
              </p>
            )
          ) : null}
          <div className="text-sm">
            <p className="font-medium text-ink">Renter</p>
            <p className="text-muted">
              {booking.renter.displayName}
              {booking.renter.phone ? ` · ${booking.renter.phone}` : ''}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
