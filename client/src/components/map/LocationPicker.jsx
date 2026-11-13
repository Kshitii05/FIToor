import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { currentPosition, insideAllowedArea } from '../../lib/location.js';
import { Button, TextField } from '../ui/index.js';
import { PinMap } from './Maps.jsx';

const round6 = (value) => Math.round(value * 1e6) / 1e6;

/**
 * Chooses a spot and its area name. `value` is `{ lat, lng, locality }` or null;
 * `onChange` receives the new value. Offers the person's saved places, their current
 * position, a place or PIN code search, and a map to click or drag.
 * `note` explains who will see what.
 */
export function LocationPicker({ value, onChange, error, note, showSavedPlaces = true }) {
  const [saved, setSaved] = useState([]);
  const [focus, setFocus] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null);
  // Each pick gets a number, so a slow area-name lookup never overwrites a newer pick.
  const pickNumber = useRef(0);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!showSavedPlaces) return undefined;
    let cancelled = false;
    api('/me/locations')
      .then((data) => {
        if (cancelled) return;
        setSaved(data.items);
        const preferred = data.items.find((place) => place.isDefault);
        if (preferred && !valueRef.current) setFocus({ lat: preferred.lat, lng: preferred.lng });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showSavedPlaces]);

  /** Sets the spot, then looks up its area name. */
  const pick = useCallback(
    async (point, knownLocality) => {
      const spot = { lat: round6(point.lat), lng: round6(point.lng) };
      if (!insideAllowedArea(spot)) {
        setProblem('Choose a place in India.');
        return;
      }
      setProblem(null);
      const number = ++pickNumber.current;
      onChange({ ...spot, locality: knownLocality ?? valueRef.current?.locality ?? '' });
      if (knownLocality) return;
      try {
        const { place } = await api(`/places/reverse?lat=${spot.lat}&lng=${spot.lng}`, {
          auth: false,
        });
        if (place && number === pickNumber.current) onChange({ ...spot, locality: place.locality });
      } catch {
        // No area name found: the person can type one.
      }
    },
    [onChange],
  );

  const pickFromMap = useCallback((point) => pick(point), [pick]);

  async function useCurrentPosition() {
    setBusy('position');
    setProblem(null);
    try {
      const position = await currentPosition();
      setFocus(position);
      await pick(position);
    } catch (failure) {
      setProblem(failure.message);
    } finally {
      setBusy(null);
    }
  }

  async function searchPlaces(event) {
    event.preventDefault();
    if (query.trim().length < 2) {
      setProblem('Type at least 2 characters of a place or PIN code.');
      return;
    }
    setBusy('search');
    setProblem(null);
    try {
      const { items } = await api(`/places/search?q=${encodeURIComponent(query.trim())}`, {
        auth: false,
      });
      setResults(items);
    } catch (failure) {
      setResults(null);
      setProblem(failure.message);
    } finally {
      setBusy(null);
    }
  }

  function choosePlace(place) {
    setResults(null);
    setFocus({ lat: place.lat, lng: place.lng });
    pick(place, place.locality);
  }

  return (
    <div className="space-y-4">
      {saved.length > 0 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Your saved places">
          {saved.map((place) => (
            <Button key={place.id} variant="secondary" size="sm" onClick={() => choosePlace(place)}>
              {place.label}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          loading={busy === 'position'}
          disabled={busy !== null}
          onClick={useCurrentPosition}
        >
          Use my current location
        </Button>
      </div>

      {/* A div, not a form: this sits inside other forms. Enter still searches. */}
      <div>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              label="Search for an area or PIN code"
              placeholder="Indiranagar, or 560038"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') searchPlaces(event);
              }}
            />
          </div>
          <Button
            variant="secondary"
            className="mt-7"
            loading={busy === 'search'}
            disabled={busy !== null}
            onClick={searchPlaces}
          >
            Search
          </Button>
        </div>
        {results ? (
          results.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              No places found. Try another name, or use the map.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-field border border-line">
              {results.map((place) => (
                <li key={`${place.lat},${place.lng}`}>
                  <button
                    type="button"
                    onClick={() => choosePlace(place)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent-soft"
                  >
                    <span className="text-ink">{place.label}</span>
                    {place.pincode ? <span className="text-muted">{place.pincode}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      <PinMap pin={value} focus={focus} onPick={pickFromMap} />
      <p className="text-sm text-muted">
        Click the map to place the pin, or drag it to adjust. Map search uses OpenStreetMap.
      </p>

      <TextField
        label="Area name"
        hint={note}
        placeholder="Indiranagar"
        maxLength={80}
        disabled={!value}
        value={value?.locality ?? ''}
        onChange={(event) => onChange({ ...value, locality: event.target.value })}
        error={value ? error : undefined}
      />

      {problem || (error && !value) ? (
        <p role="alert" className="text-sm text-danger">
          {problem ?? error}
        </p>
      ) : null}
    </div>
  );
}
