import { useEffect, useState } from 'react';
import { api } from './api.js';

/** Loads one order from the buyer's or seller's side. Returns `{ order, error, loading, setOrder }`. */
export function useOrder(side, id) {
  const [result, setResult] = useState({ id: null });
  const base = side === 'buyer' ? '/me/orders' : '/me/sales';

  useEffect(() => {
    let cancelled = false;
    api(`${base}/${encodeURIComponent(id)}`)
      .then((data) => {
        if (!cancelled) setResult({ id, order: data.order });
      })
      .catch((error) => {
        if (!cancelled) setResult({ id, error });
      });
    return () => {
      cancelled = true;
    };
  }, [base, id]);

  const current = result.id === id ? result : {};
  return {
    loading: result.id !== id,
    order: current.order ?? null,
    error: current.error ?? null,
    setOrder: (order) => setResult({ id, order }),
  };
}

/** The list of orders from one side, with status filter and paging. */
export function useOrderList({ side, status, page }) {
  const [result, setResult] = useState({ key: null });
  const base = side === 'buyer' ? '/me/orders' : '/me/sales';
  const query = new URLSearchParams({ page: String(page) });
  if (status) query.set('status', status);
  const key = `${base}?${query}`;

  useEffect(() => {
    let cancelled = false;
    api(key)
      .then((data) => {
        if (!cancelled) setResult({ key, data });
      })
      .catch((error) => {
        if (!cancelled) setResult({ key, error });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { loading: result.key !== key, data: result.data, error: result.error };
}
