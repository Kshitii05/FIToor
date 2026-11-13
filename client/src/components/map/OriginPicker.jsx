import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/authContext.js';
import { useOrigin } from '../../location/originContext.js';
import { api } from '../../lib/api.js';
import { currentPosition } from '../../lib/location.js';
import { Spinner } from '../ui/index.js';

function Chip({ pressed, onClick, disabled, children }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors disabled:opacity-60 ${
        pressed
          ? 'border-accent bg-accent text-white'
          : 'border-line-strong bg-surface text-ink hover:bg-paper'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Chooses where distances are measured from: the device's position or one of the
 * person's saved places. With no choice, the server uses their default place.
 * `active` is the origin the last response reported (`{ source, label }` or null).
 */
export function OriginPicker({ active }) {
  const { status } = useAuth();
  const { choice, setChoice } = useOrigin();
  const [places, setPlaces] = useState([]);
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState(null);
  const signedIn = status === 'signedIn';

  useEffect(() => {
    if (!signedIn) return undefined;
    let cancelled = false;
    api('/me/locations')
      .then((data) => {
        if (!cancelled) setPlaces(data.items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  async function useDevice() {
    setLocating(true);
    setProblem(null);
    try {
      setChoice({ kind: 'device', ...(await currentPosition()) });
    } catch (failure) {
      setProblem(failure.message);
    } finally {
      setLocating(false);
    }
  }

  const isActivePlace = (place) =>
    choice?.kind === 'saved'
      ? choice.id === place.id
      : choice === null && active?.source === 'saved' && place.isDefault;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Search near">
        <span className="text-sm text-muted">Near</span>
        <Chip pressed={choice?.kind === 'device'} disabled={locating} onClick={useDevice}>
          {locating ? <Spinner /> : null}
          {choice?.kind === 'device' ? 'Your location' : 'Use my location'}
        </Chip>
        {places.map((place) => (
          <Chip
            key={place.id}
            pressed={isActivePlace(place)}
            onClick={() => setChoice({ kind: 'saved', id: place.id, label: place.label })}
          >
            {place.label}
          </Chip>
        ))}
        {signedIn ? (
          <Link
            to="/profile#places"
            className="text-sm font-medium text-accent underline-offset-4 hover:underline"
          >
            {places.length ? 'Manage places' : 'Save a place'}
          </Link>
        ) : null}
      </div>
      {problem ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {problem}
        </p>
      ) : null}
      <p className="mt-1.5 text-xs text-muted">
        Your location is only used to measure distance. It is not saved or shared.
      </p>
    </div>
  );
}
