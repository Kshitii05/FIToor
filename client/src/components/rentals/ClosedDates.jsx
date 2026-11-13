import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { rangeLabel } from '../../lib/rentals.js';
import { useAvailability } from '../../lib/useRentals.js';
import { Alert, Button, ButtonLink, Card, SectionHeading, TextField } from '../ui/index.js';
import { AvailabilityCalendar } from './AvailabilityCalendar.jsx';

/** On the owner's own rental listing: the calendar, and days closed for renting. */
export function ClosedDates({ listing }) {
  const [version, setVersion] = useState(0);
  const availability = useAvailability(listing.id, version);
  const [items, setItems] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api(`/me/blocked-dates?listingId=${listing.id}`)
      .then((data) => !cancelled && setItems(data.items))
      .catch((failure) => !cancelled && setError(failure.message));
    return () => {
      cancelled = true;
    };
  }, [listing.id, version]);

  async function act(key, request) {
    setBusy(key);
    setError(null);
    try {
      await request();
      setVersion((v) => v + 1);
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add() {
    const done = await act('add', () =>
      api('/me/blocked-dates', {
        method: 'POST',
        body: { listingId: listing.id, startDate: from, endDate: to || from },
      }),
    );
    if (done) {
      setFrom('');
      setTo('');
    }
  }

  const window = availability.data;
  return (
    <Card>
      <SectionHeading
        title="Availability"
        description="Booked, requested and closed days are taken. Renters see only that a day is taken."
        action={
          <ButtonLink to="/rented-out" variant="secondary" size="sm">
            Bookings
          </ButtonLink>
        }
      />
      {window ? (
        <AvailabilityCalendar
          firstStartDate={window.firstStartDate}
          lastStartDate={window.lastStartDate}
          blocked={window.blocked}
        />
      ) : null}

      <h3 className="mt-5 text-sm font-medium text-ink">Close days for renting</h3>
      {error ? (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      ) : null}
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <div className="w-40">
          <TextField
            label="From"
            type="date"
            min={window?.firstStartDate}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="w-40">
          <TextField
            label="To (optional)"
            type="date"
            min={from || window?.firstStartDate}
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <Button variant="secondary" loading={busy === 'add'} disabled={!from} onClick={add}>
          Close these days
        </Button>
      </div>
      {items?.length ? (
        <ul className="mt-3 divide-y divide-line text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2">
              <span className="text-ink">{rangeLabel(item.startDate, item.endDate)}</span>
              <Button
                variant="ghost"
                size="sm"
                loading={busy === item.id}
                onClick={() =>
                  act(item.id, () => api(`/me/blocked-dates/${item.id}`, { method: 'DELETE' }))
                }
              >
                Open again
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
