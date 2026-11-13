import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/authContext.js';
import { api } from '../../lib/api.js';
import { daysLabel } from '../../lib/listings.js';
import { formatPaise } from '../../lib/money.js';
import { addressLines } from '../../lib/orders.js';
import { addDays, longDayLabel } from '../../lib/rentals.js';
import { useAvailability } from '../../lib/useRentals.js';
import { AddressForm } from '../orders/Addresses.jsx';
import { Alert, Button, Card, ChoiceCards, Loading, SelectField } from '../ui/index.js';
import { AvailabilityCalendar } from './AvailabilityCalendar.jsx';

/** Delivery addresses of the signed-in renter, with a way to add one. */
function AddressChoice({ value, onChange, defaultName }) {
  const [addresses, setAddresses] = useState(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api('/me/addresses')
      .then((data) => {
        if (cancelled) return;
        setAddresses(data.items);
        const preferred = data.items.find((a) => a.isDefault) ?? data.items[0];
        if (preferred) onChange(preferred.id);
      })
      .catch(() => !cancelled && setAddresses([]));
    return () => {
      cancelled = true;
    };
    // Load once; onChange only records the first choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (addresses === null) return <Loading label="Loading your addresses" />;
  if (adding || addresses.length === 0) {
    return (
      <AddressForm
        defaultName={defaultName}
        onCancel={addresses.length ? () => setAdding(false) : undefined}
        onSaved={(address) => {
          setAddresses([...addresses, address]);
          onChange(address.id);
          setAdding(false);
        }}
      />
    );
  }
  const chosen = addresses.find((a) => a.id === value);
  return (
    <div className="space-y-2">
      <SelectField
        label="Deliver to"
        options={addresses.map((a) => ({ value: a.id, label: `${a.label}: ${a.line1}` }))}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
      {chosen ? (
        <p className="text-sm text-muted">{addressLines(chosen).slice(1, 3).join(', ')}</p>
      ) : null}
      <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
        Add another address
      </Button>
    </div>
  );
}

/** "Rent this": a package, a free start day, delivery or pickup, and the costs. */
export function RentPanel({ listing }) {
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const availability = useAvailability(listing.id);
  const packages = listing.rent.packages;
  const [days, setDays] = useState(String(packages[0].durationDays));
  const [start, setStart] = useState(null);
  const [fulfilment, setFulfilment] = useState(listing.pickup ? 'PICKUP' : 'DELIVERY');
  const [addressId, setAddressId] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  if (listing.status !== 'ACTIVE') return null;
  if (availability.loading) return <Loading label="Loading available dates" />;
  if (availability.error) return <Alert tone="error">{availability.error.message}</Alert>;

  const { firstStartDate, lastStartDate, blocked } = availability.data;
  const pkg = packages.find((p) => String(p.durationDays) === days);
  const end = start ? addDays(start, pkg.durationDays - 1) : null;
  const delivery = fulfilment === 'DELIVERY' ? (listing.delivery?.chargePaise ?? 0) : 0;
  const total = pkg.pricePaise + listing.rent.depositPaise + delivery;
  const signedIn = status === 'signedIn';
  const verified = user?.emailVerified && user?.phoneVerified;

  async function send() {
    if (!signedIn) {
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { booking } = await api('/rentals', {
        method: 'POST',
        body: {
          listingId: listing.id,
          durationDays: pkg.durationDays,
          startDate: start,
          fulfilment,
          ...(fulfilment === 'DELIVERY' ? { addressId } : {}),
        },
      });
      navigate(`/rentals/${booking.id}`, { state: { notice: 'Request sent to the owner.' } });
    } catch (failure) {
      setError(
        failure.code === 'DATES_UNAVAILABLE'
          ? 'Someone has just taken some of these days. Pick other dates.'
          : failure.message,
      );
      setSending(false);
    }
  }

  return (
    <Card className="border-accent/30">
      <h2 className="font-display text-xl font-semibold text-ink">Rent this</h2>
      <div className="mt-4 space-y-5">
        <SelectField
          label="How long?"
          options={packages.map((p) => ({
            value: String(p.durationDays),
            label: `${daysLabel(p.durationDays)} · ${formatPaise(p.pricePaise)}`,
          }))}
          value={days}
          onChange={(event) => {
            setDays(event.target.value);
            setStart(null);
          }}
        />

        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Pick the first day</p>
          <AvailabilityCalendar
            key={days}
            firstStartDate={firstStartDate}
            lastStartDate={lastStartDate}
            blocked={blocked}
            durationDays={pkg.durationDays}
            value={start}
            onChange={setStart}
          />
          {start ? (
            <p className="mt-2 text-sm text-ink">
              {longDayLabel(start)} to {longDayLabel(end)}. Return it by 8 pm on {longDayLabel(end)}
              .
            </p>
          ) : null}
        </div>

        {listing.pickup && listing.delivery ? (
          <ChoiceCards
            legend="Getting it"
            value={fulfilment}
            onChange={setFulfilment}
            options={[
              {
                value: 'PICKUP',
                label: 'Pick it up',
                description: 'You get the exact spot once the booking is paid.',
              },
              {
                value: 'DELIVERY',
                label: 'Home delivery',
                description: `${formatPaise(listing.delivery.chargePaise)}, within ${listing.delivery.radiusKm} km. You return it in person.`,
              },
            ]}
          />
        ) : null}
        {fulfilment === 'DELIVERY' && signedIn && verified ? (
          <AddressChoice
            value={addressId}
            onChange={setAddressId}
            defaultName={user.profile.displayName}
          />
        ) : null}

        <dl className="space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Rental ({daysLabel(pkg.durationDays)})</dt>
            <dd>{formatPaise(pkg.pricePaise)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Refundable deposit</dt>
            <dd>{formatPaise(listing.rent.depositPaise)}</dd>
          </div>
          {delivery > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">Delivery</dt>
              <dd>{formatPaise(delivery)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between font-semibold">
            <dt>To pay once approved</dt>
            <dd>{formatPaise(total)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted">
          Nothing is charged now. The owner has 24 hours to approve; then you have 12 hours to pay.
          The deposit comes back after the item is returned and checked.
          {listing.rent.lateFeePerDayPaise > 0
            ? ` Late returns cost ${formatPaise(listing.rent.lateFeePerDayPaise)} for each day started after a 24-hour grace period.`
            : ''}
        </p>

        {error ? <Alert tone="error">{error}</Alert> : null}
        {signedIn && !verified ? (
          <Alert tone="notice">
            Verify your email and phone to rent. <Link to="/verify">Verify now</Link>
          </Alert>
        ) : (
          <Button
            block
            loading={sending}
            disabled={!start || (fulfilment === 'DELIVERY' && signedIn && !addressId)}
            onClick={send}
          >
            {signedIn ? 'Request to rent' : 'Sign in to rent'}
          </Button>
        )}
      </div>
    </Card>
  );
}
