import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Loads `path` (null to load nothing) and reloads when it changes. Returns
 * `{ data, error, loading, reload, setData }`. While a new path loads, the previous
 * data stays on screen so lists do not flash empty.
 */
export function useFetch(path) {
  const [version, setVersion] = useState(0);
  const key = path ? `${path}#${version}` : null;
  const [result, setResult] = useState({ key: null });

  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    api(path)
      .then((data) => !cancelled && setResult({ key, data }))
      .catch((error) => !cancelled && setResult((current) => ({ ...current, key, error })));
    return () => {
      cancelled = true;
    };
  }, [path, key]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const setData = useCallback((data) => setResult((current) => ({ ...current, data })), []);
  const fresh = result.key === key;
  return {
    data: result.data ?? null,
    error: fresh ? (result.error ?? null) : null,
    loading: Boolean(path) && !fresh,
    reload,
    setData,
  };
}
