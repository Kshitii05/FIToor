import { useCallback, useEffect, useState } from 'react';
import { useOrigin } from '../../location/originContext.js';
import { api, fieldErrors } from '../../lib/api.js';
import { Alert, Badge, Button, Card, Loading, SectionHeading, TextField } from '../ui/index.js';
import { LocationPicker } from './LocationPicker.jsx';

const MAX_PLACES = 5;

function AddPlace({ onAdded, onCancel }) {
  const [label, setLabel] = useState('');
  const [place, setPlace] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const setLocation = useCallback((value) => setPlace(value), []);

  async function handleSubmit(event) {
    event.preventDefault();
    const problems = {};
    if (!label.trim()) problems.label = 'Give this place a name, like Home or Work';
    if (!place) problems.location = 'Choose the place on the map';
    else if (!place.locality.trim()) problems.location = 'Enter the area name';
    setErrors(problems);
    setFormError(null);
    if (Object.keys(problems).length > 0) return;

    setSaving(true);
    try {
      const { location } = await api('/me/locations', {
        method: 'POST',
        body: {
          label: label.trim(),
          lat: place.lat,
          lng: place.lng,
          locality: place.locality.trim(),
        },
      });
      onAdded(location);
    } catch (error) {
      const fields = fieldErrors(error);
      setErrors({
        label: fields.label,
        location: fields.lat ?? fields.lng ?? fields.locality,
      });
      if (Object.keys(fields).length === 0) setFormError(error.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-5 border-t border-line pt-5">
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <TextField
        label="Name"
        placeholder="Home"
        maxLength={30}
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        error={errors.label}
      />
      <LocationPicker
        value={place}
        onChange={setLocation}
        error={errors.location}
        showSavedPlaces={false}
        note="Only you can see your saved places."
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={saving}>
          Save place
        </Button>
        <Button variant="secondary" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The signed-in person's saved places: used to search around, never shown to others. */
export function SavedPlaces() {
  const { choice, setChoice } = useOrigin();
  const [places, setPlaces] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(null);

  const reload = useCallback(async () => {
    try {
      setPlaces((await api('/me/locations')).items);
    } catch (failure) {
      setError(failure.message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api('/me/locations')
      .then((data) => {
        if (!cancelled) setPlaces(data.items);
      })
      .catch((failure) => {
        if (!cancelled) setError(failure.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function act(id, request) {
    setBusy(id);
    setError(null);
    try {
      await request();
      await reload();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(null);
    }
  }

  function remove(place) {
    act(place.id, async () => {
      await api(`/me/locations/${place.id}`, { method: 'DELETE' });
      // A search set to this place would otherwise point at nothing.
      if (choice?.kind === 'saved' && choice.id === place.id) setChoice(null);
    });
  }

  return (
    <Card>
      <div id="places" className="scroll-mt-24" />
      <SectionHeading
        title="Saved places"
        description="Places to search around, like Home or Work. Only you can see them."
      />
      {error ? (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      ) : null}
      {places === null ? (
        error ? null : (
          <Loading label="Loading places" />
        )
      ) : places.length === 0 ? (
        <p className="text-sm text-muted">
          No saved places yet. Your default place is used to show distances when you search.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {places.map((place) => (
            <li key={place.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  {place.label}
                  {place.isDefault ? <Badge tone="success">Default</Badge> : null}
                </p>
                <p className="text-sm text-muted">{place.locality}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {place.isDefault ? null : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null}
                    loading={busy === place.id}
                    onClick={() =>
                      act(place.id, () =>
                        api(`/me/locations/${place.id}`, {
                          method: 'PATCH',
                          body: { isDefault: true },
                        }),
                      )
                    }
                  >
                    Make default
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => remove(place)}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <AddPlace
          onAdded={async () => {
            setAdding(false);
            await reload();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : places && places.length < MAX_PLACES ? (
        <Button variant="secondary" className="mt-4" onClick={() => setAdding(true)}>
          Add a place
        </Button>
      ) : places ? (
        <p className="mt-4 text-sm text-muted">
          You have saved {MAX_PLACES} places, the most allowed. Remove one to add another.
        </p>
      ) : null}
    </Card>
  );
}
