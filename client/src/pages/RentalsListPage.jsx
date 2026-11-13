import { useState } from 'react';
import { BookingRow } from '../components/rentals/BookingParts.jsx';
import {
  Alert,
  ButtonLink,
  EmptyState,
  FilterTabs,
  Loading,
  Pagination,
} from '../components/ui/index.js';
import { BOOKING_FILTERS } from '../lib/rentals.js';
import { useBookingList } from '../lib/useRentals.js';

/** "My rentals" (side="renter") or "Rented out" (side="owner"). */
export default function RentalsListPage({ side }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { loading, data, error } = useBookingList({ side, status, page });
  const renter = side === 'renter';

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
        {renter ? 'My rentals' : 'Rented out'}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {renter
          ? 'Things you have asked to rent.'
          : 'Requests and bookings for your rental listings.'}
      </p>
      <div className="mt-5">
        <FilterTabs
          label="Filter by status"
          options={BOOKING_FILTERS}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
      </div>
      <div className="mt-5" aria-busy={loading}>
        {error && !loading ? (
          <Alert tone="error">{error.message}</Alert>
        ) : !data ? (
          <Loading label="Loading" />
        ) : data.items.length === 0 ? (
          <EmptyState
            title={status ? 'Nothing here' : renter ? 'No rentals yet' : 'No bookings yet'}
            action={
              status ? null : renter ? (
                <ButtonLink to="/search?mode=RENT">Find something to rent</ButtonLink>
              ) : (
                <ButtonLink to="/listings/new">List an item for rent</ButtonLink>
              )
            }
          />
        ) : (
          <>
            <ul className={`space-y-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
              {data.items.map((booking) => (
                <BookingRow key={booking.id} booking={booking} side={side} />
              ))}
            </ul>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              disabled={loading}
              onChange={setPage}
            />
          </>
        )}
      </div>
    </div>
  );
}
