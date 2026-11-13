import { createContext, useContext } from 'react';

export const OriginContext = createContext(null);

/**
 * Where searches measure distance from, for this browser tab:
 * `{ choice, setChoice, originQuery }`.
 *
 * `choice` is null (use the default saved place, if any), `{ kind: 'device', lat,
 * lng }` (rounded to ~100 m) or `{ kind: 'saved', id, label }`. `originQuery` is the
 * matching part of an API query string ("" for null). It is never put in the
 * address bar, so a shared link does not reveal where someone is.
 */
export function useOrigin() {
  const value = useContext(OriginContext);
  if (!value) throw new Error('useOrigin must be used inside OriginProvider');
  return value;
}
