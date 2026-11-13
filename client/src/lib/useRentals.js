import { useEffect, useState } from 'react';
import { api } from './api.js';

const base = (side) => (side === 'renter' ? '/me/rentals' : '/me/rented-out');

/** Loads `path` and keeps the last answer for it: `{ loading, data, error, setData }`. */
function useFetch(path) {
  const [result, setResult] = useState({ path: null });

  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    api(path)
      .then((data) => {
        if (!cancelled) setResult({ path, data });
      })
      .catch((error) => {
        if (!cancelled) setResult({ path, error });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const current = result.path === path ? result : {};
  return {
    loading: result.path !== path,
    data: current.data ?? null,
    error: current.error ?? null,
    setData: (data) => setResult({ path, data }),
  };
}

/** One booking from the renter's or the owner's side. */
export function useBooking(side, id) {
  const { loading, data, error, setData } = useFetch(`${base(side)}/${encodeURIComponent(id)}`);
  return {
    loading,
    booking: data?.booking ?? null,
    error,
    setBooking: (booking) => setData({ booking }),
  };
}

/** A page of bookings from one side, optionally filtered by status. */
export function useBookingList({ side, status, page }) {
  const query = new URLSearchParams({ page: String(page) });
  if (status) query.set('status', status);
  return useFetch(`${base(side)}?${query}`);
}

/** Public availability of a rental listing. */
export function useAvailability(listingId, version = 0) {
  return useFetch(listingId ? `/rentals/availability/${listingId}?v=${version}` : null);
}

/** Runs a booking action (`POST .../:id/:action`) and shows the updated booking. */
export function useBookingAction(side, id, setBooking) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  async function run(action, body) {
    setBusy(action);
    setError(null);
    try {
      const data = await api(`${base(side)}/${id}/${action}`, { method: 'POST', body });
      setBooking(data.booking);
      return true;
    } catch (failure) {
      setError(
        failure.code === 'WRONG_CODE'
          ? `${failure.message}. ${failure.details?.attemptsLeft ?? 0} tries left.`
          : failure.message,
      );
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, setError, run };
}
