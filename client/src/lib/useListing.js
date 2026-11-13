import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Loads one listing. Returns `{ loading, listing, error, setListing }`.
 * The result is keyed by id, so a listing loaded for a previous id is never shown
 * for the current one. `setListing` stores an updated copy returned by the API.
 */
export function useListing(id) {
  const [state, setState] = useState({ id: null });

  useEffect(() => {
    let cancelled = false;
    api(`/listings/${encodeURIComponent(id)}`)
      .then((data) => {
        if (!cancelled) setState({ id, listing: data.listing });
      })
      .catch((error) => {
        if (!cancelled) setState({ id, error });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const setListing = useCallback((listing) => setState({ id, listing }), [id]);
  const current = state.id === id ? state : {};

  return {
    loading: state.id !== id,
    listing: current.listing ?? null,
    error: current.error ?? null,
    setListing,
  };
}

/** A copy of `list` with the item at `index` moved one place earlier (-1) or later (1). */
export function moveItem(list, index, direction) {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
