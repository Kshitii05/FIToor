import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../auth/authContext.js';
import { roundPosition } from '../lib/location.js';
import { OriginContext } from './originContext.js';

// Kept for the tab only (sessionStorage): a closed tab forgets the position.
const STORAGE_KEY = 'search-origin';

function readStored() {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    if (value?.kind === 'device' && Number.isFinite(value.lat) && Number.isFinite(value.lng)) {
      return { kind: 'device', ...roundPosition(value) };
    }
    if (value?.kind === 'saved' && typeof value.id === 'string') {
      return { kind: 'saved', id: value.id, label: String(value.label ?? '') };
    }
  } catch {
    // Unreadable or unavailable storage: start without a choice.
  }
  return null;
}

function store(choice) {
  try {
    if (choice) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: the choice lasts until the page is reloaded.
  }
}

export function OriginProvider({ children }) {
  const { status } = useAuth();
  const [stored, setStored] = useState(readStored);

  const setChoice = useCallback((next) => {
    const value = next?.kind === 'device' ? { kind: 'device', ...roundPosition(next) } : next;
    store(value);
    setStored(value);
  }, []);

  // A saved place belongs to the signed-in person; signed out, it does not apply.
  const choice = stored?.kind === 'saved' && status !== 'signedIn' ? null : stored;

  const value = useMemo(() => {
    let originQuery = '';
    if (choice?.kind === 'device') originQuery = `lat=${choice.lat}&lng=${choice.lng}`;
    if (choice?.kind === 'saved') originQuery = `locationId=${encodeURIComponent(choice.id)}`;
    return { choice, setChoice, originQuery };
  }, [choice, setChoice]);

  return <OriginContext.Provider value={value}>{children}</OriginContext.Provider>;
}
