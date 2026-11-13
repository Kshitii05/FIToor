import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Loads one listing. Returns `{ loading, listing, error, setListing }`.
 * The result is keyed by id, so a listing loaded for a previous id is never shown
 * for the current one. `setListing` stores an updated copy returned by the API.
 */
export function useListing(id, originQuery = '') {
  // Keyed by the request, so a reply for another listing or origin never shows.
  const key = `${id}?${originQuery}`;
  const [state, setState] = useState({ key: null });

  useEffect(() => {
    let cancelled = false;
    api(`/listings/${encodeURIComponent(id)}${originQuery ? `?${originQuery}` : ''}`)
      .then((data) => {
        if (!cancelled) setState({ key, listing: data.listing });
      })
      .catch((error) => {
        if (!cancelled) setState({ key, error });
      });
    return () => {
      cancelled = true;
    };
  }, [id, originQuery, key]);

  const setListing = useCallback((listing) => setState({ key, listing }), [key]);
  const current = state.key === key ? state : {};

  return {
    loading: state.key !== key,
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
