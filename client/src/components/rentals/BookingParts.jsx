import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { photoProblem } from '../../lib/listingForm.js';
import { formatPaise } from '../../lib/money.js';
import { when } from '../../lib/orders.js';
import { ATTENTION, bookingStatus, rangeLabel } from '../../lib/rentals.js';
import { Alert, Badge, Button, ButtonLink, Card, SectionHeading, TextField } from '../ui/index.js';

export function BookingStatusBadge({ status, side }) {
  const { label, tone } = bookingStatus(status, side);
  return <Badge tone={tone}>{label}</Badge>;
}

export function BookingNotFound({ error, back }) {
  return (
    <div className="mx-auto max-w-md">
      <Alert tone={error.status === 404 ? 'notice' : 'error'}>
        {error.status === 404 ? 'This booking does not exist, or is not yours.' : error.message}
      </Alert>
      <ButtonLink to={back} variant="secondary" className="mt-5">
        Back
      </ButtonLink>
    </div>
  );
}

export function BookingHeading({ booking, side }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          Rental {booking.ref}
        </h1>
        <BookingStatusBadge status={booking.status} side={side} />
      </div>
      <p className="mt-1 text-sm text-muted">
        <Link
          to={`/listings/${booking.listingId}`}
          className="text-ink underline-offset-4 hover:underline"
        >
          {booking.title}
        </Link>{' '}
        · {rangeLabel(booking.startDate, booking.endDate)} ·{' '}
        {booking.fulfilment === 'DELIVERY' ? 'Home delivery' : 'Pickup'}
      </p>
    </div>
  );
}

function Row({ label, value, strong, tone }) {
  return (
    <div
      className={`flex justify-between gap-3 ${strong ? 'font-semibold' : ''} ${
        tone === 'success' ? 'text-success' : tone === 'muted' ? 'text-muted' : ''
      }`}
    >
      <dt className={strong || tone ? '' : 'text-muted'}>{label}</dt>
      <dd className="shrink-0">{value}</dd>
    </div>
  );
}

/** What was paid, and what became of the deposit. `extra` adds rows for one side. */
export function BookingMoney({ booking, extra }) {
  const deductions = [
    booking.lateFeePaise ? ['Late fee', booking.lateFeePaise] : null,
    booking.damagePaise ? ['Damage', booking.damagePaise] : null,
  ].filter(Boolean);
  return (
    <Card>
      <dl className="space-y-1 text-sm">
        <Row
          label={`Rental (${booking.durationDays} days)`}
          value={formatPaise(booking.feePaise)}
        />
        {booking.deliveryChargePaise > 0 ? (
          <Row label="Delivery" value={formatPaise(booking.deliveryChargePaise)} />
        ) : null}
        <Row label="Refundable deposit" value={formatPaise(booking.depositPaise)} />
        <Row
          strong
          label={booking.paidAt ? 'Paid' : 'To pay once approved'}
          value={formatPaise(booking.totalPaise)}
        />
        {booking.refundedPaise > 0 ? (
          <Row
            tone="success"
            label="Rental and delivery refunded"
            value={formatPaise(booking.refundedPaise)}
          />
        ) : null}
      </dl>

      {booking.lateFeePaise > 0 || booking.settledAt ? (
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <p className="mb-1 font-medium text-ink">Deposit</p>
          {deductions.map(([label, value]) => (
            <Row key={label} label={label} value={`−${formatPaise(value)}`} />
          ))}
          {booking.settledAt ? (
            <>
              <Row
                label="Taken from the deposit"
                value={formatPaise(booking.depositDeductedPaise)}
              />
              {booking.owedPaise > 0 ? (
                <Row label="Owed beyond the deposit" value={formatPaise(booking.owedPaise)} />
              ) : null}
              <Row
                strong
                label="Deposit back"
                value={formatPaise(booking.depositPaise - booking.depositDeductedPaise)}
              />
            </>
          ) : null}
        </dl>
      ) : null}
      {booking.depositRefundedPaise > 0 && !booking.settledAt ? (
        <p className="mt-2 text-sm text-success">
          Deposit of {formatPaise(booking.depositRefundedPaise)} refunded.
        </p>
      ) : null}
      {extra ? <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">{extra}</dl> : null}
      <p className="mt-3 text-xs text-muted">
        {booking.lateFeePerDayPaise > 0
          ? `Late returns: ${formatPaise(booking.lateFeePerDayPaise)} for each day started after a ${booking.lateFeeGraceHours}-hour grace period.`
          : 'No late fee on this rental.'}
      </p>
    </Card>
  );
}

export { Row as MoneyRow };

export function BookingDates({ booking, side }) {
  const rows = [
    [
      side === 'owner' ? 'Answer by' : 'Owner answers by',
      booking.status === 'REQUESTED' ? booking.holdExpiresAt : null,
    ],
    ['Pay by', booking.status === 'APPROVED' ? booking.paymentDueAt : null],
    ['Paid', booking.paidAt],
    ['Handed over', booking.handedOverAt],
    ['Due back by', ['CONFIRMED', 'ACTIVE'].includes(booking.status) ? booking.returnDueAt : null],
    ['Returned', booking.returnedAt],
    ['Inspection ends', booking.status === 'RETURNED' ? booking.inspectionEndsAt : null],
    ['Completed', booking.completedAt],
    ['Cancelled', booking.cancelledAt],
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

/** Condition photos taken at handover and return, with when they were taken. */
export function ConditionPhotos({ booking }) {
  const sets = [
    ['At handover', booking.handoverPhotos],
    ['At return', booking.returnPhotos],
    ['Damage claim', booking.claim?.photos ?? []],
  ].filter(([, photos]) => photos.length > 0);
  if (sets.length === 0) return null;
  return (
    <Card>
      <div className="space-y-4">
        {sets.map(([label, photos]) => (
          <div key={label}>
            <p className="text-sm font-medium text-ink">
              {label}
              <span className="ml-2 font-normal text-muted">{when(photos[0].takenAt)}</span>
            </p>
            <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {photos.map((photo) => (
                <li key={photo.url}>
                  <a href={photo.url} target="_blank" rel="noreferrer">
                    <img
                      src={photo.url}
                      alt={`${label} photo`}
                      className="aspect-square w-full rounded-field border border-line object-cover"
                    />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Choose photos from the device: checked for type and size before sending. */
export function PhotoPicker({ files, onChange, min, max, hint }) {
  const input = useRef(null);
  const [problem, setProblem] = useState(null);

  function choose(event) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = '';
    setProblem(chosen.map(photoProblem).find(Boolean) ?? null);
    onChange([...files, ...chosen.filter((file) => !photoProblem(file))].slice(0, max));
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={choose}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={files.length >= max}
          onClick={() => input.current?.click()}
        >
          Add photos
        </Button>
        {files.length ? (
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            Clear
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted">
        {files.length
          ? `${files.length} chosen: ${files.map((file) => file.name).join(', ')}`
          : (hint ?? `At least ${min}, up to ${max}.`)}
      </p>
      {problem ? (
        <p role="alert" className="mt-1 text-sm text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** The other side's 6-digit code plus condition photos: handover or return. */
export function CodeWithPhotos({ intro, codeLabel, button, busy, attemptsLeft, onSubmit }) {
  const [code, setCode] = useState('');
  const [files, setFiles] = useState([]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink">{intro}</p>
      <div className="w-40">
        <TextField
          label={codeLabel}
          inputMode="numeric"
          maxLength={6}
          className="font-mono tracking-[0.3em]"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        />
      </div>
      <PhotoPicker
        files={files}
        onChange={setFiles}
        min={2}
        max={8}
        hint="At least 2 photos of the item's condition, up to 8. They are kept with the time."
      />
      <Button
        loading={busy}
        disabled={code.length !== 6 || files.length < 2}
        onClick={() => onSubmit(code, files)}
      >
        {button}
      </Button>
      {attemptsLeft !== null && attemptsLeft !== undefined ? (
        <p className="text-xs text-muted">{attemptsLeft} tries left.</p>
      ) : null}
    </div>
  );
}

export function ClaimDetails({ claim }) {
  return (
    <Card>
      <SectionHeading title="Damage claim" description={claim.description} />
      <dl className="space-y-1 text-sm">
        {claim.items.map((item) => (
          <div key={item.label} className="flex justify-between gap-3">
            <dt className="text-muted">{item.label}</dt>
            <dd>{formatPaise(item.amountPaise)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 font-semibold">
          <dt>Claimed</dt>
          <dd>{formatPaise(claim.totalPaise)}</dd>
        </div>
      </dl>
      {claim.renterResponse ? (
        <p className="mt-3 text-sm text-muted">Renter’s answer: {claim.renterResponse}</p>
      ) : null}
      {claim.decisionReason ? (
        <p className="mt-2 text-sm text-muted">
          Decision: {formatPaise(claim.decidedPaise ?? 0)}. {claim.decisionReason}
        </p>
      ) : null}
    </Card>
  );
}

export function BookingRow({ booking, side }) {
  const to = side === 'renter' ? `/rentals/${booking.id}` : `/rented-out/${booking.id}`;
  const other = side === 'renter' ? booking.owner : booking.renter;
  const attention = booking.actions.some((action) => ATTENTION[side].includes(action));
  return (
    <li>
      <Link
        to={to}
        className="block rounded-card border border-line bg-surface p-4 shadow-card transition-shadow hover:shadow-lg"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 truncate font-medium text-ink">{booking.title}</p>
          <BookingStatusBadge status={booking.status} side={side} />
        </div>
        <p className="mt-1 text-sm text-muted">
          {booking.ref} · {rangeLabel(booking.startDate, booking.endDate)} ·{' '}
          {side === 'renter' ? 'from' : 'to'} {other.displayName}
        </p>
        <p className="mt-1 text-sm text-muted">{formatPaise(booking.totalPaise)}</p>
        {attention ? (
          <p className="mt-1 text-sm font-medium text-notice">Needs your attention</p>
        ) : null}
      </Link>
    </li>
  );
}
