import { useCallback, useEffect, useState } from 'react';
import { api, fieldErrors } from '../../lib/api.js';
import { addressLines } from '../../lib/orders.js';
import { LocationPicker } from '../map/LocationPicker.jsx';
import { Alert, Badge, Button, Card, Loading, SectionHeading, TextField } from '../ui/index.js';

const EMPTY = {
  label: 'Home',
  recipientName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  pincode: '',
};

/** A new delivery address, with a map pin so the seller's delivery radius can be checked. */
export function AddressForm({ onSaved, onCancel, defaultName = '' }) {
  const [form, setForm] = useState({ ...EMPTY, recipientName: defaultName });
  const [place, setPlace] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const setLocation = useCallback((value) => setPlace(value), []);
  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  async function save() {
    const problems = {};
    for (const field of ['recipientName', 'phone', 'line1', 'city', 'state', 'pincode']) {
      if (!form[field].trim()) problems[field] = 'This is required';
    }
    if (!place) problems.location = 'Place the pin on your address';
    setErrors(problems);
    setFormError(null);
    if (Object.keys(problems).length > 0) return;

    setSaving(true);
    try {
      const { address } = await api('/me/addresses', {
        method: 'POST',
        body: {
          ...form,
          line2: form.line2.trim() || undefined,
          locality: place.locality,
          lat: place.lat,
          lng: place.lng,
        },
      });
      onSaved(address);
    } catch (error) {
      const fields = fieldErrors(error);
      setErrors({ ...fields, location: fields.lat ?? fields.lng ?? fields.locality });
      if (Object.keys(fields).length === 0) setFormError(error.message);
      setSaving(false);
    }
  }

  return (
    // A div, not a form: this is used inside the cart, which has its own buttons.
    <div className="space-y-4">
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name for this address"
          maxLength={30}
          value={form.label}
          onChange={update('label')}
          error={errors.label}
        />
        <TextField
          label="Recipient’s name"
          autoComplete="name"
          value={form.recipientName}
          onChange={update('recipientName')}
          error={errors.recipientName}
        />
        <TextField
          label="Phone"
          type="tel"
          prefix="+91"
          autoComplete="tel-national"
          value={form.phone}
          onChange={update('phone')}
          error={errors.phone}
        />
        <TextField
          label="PIN code"
          inputMode="numeric"
          maxLength={6}
          autoComplete="postal-code"
          value={form.pincode}
          onChange={update('pincode')}
          error={errors.pincode}
        />
      </div>
      <TextField
        label="House, building, street"
        autoComplete="address-line1"
        value={form.line1}
        onChange={update('line1')}
        error={errors.line1}
      />
      <TextField
        label="Landmark (optional)"
        autoComplete="address-line2"
        value={form.line2}
        onChange={update('line2')}
        error={errors.line2}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="City"
          autoComplete="address-level2"
          value={form.city}
          onChange={update('city')}
          error={errors.city}
        />
        <TextField
          label="State"
          autoComplete="address-level1"
          value={form.state}
          onChange={update('state')}
          error={errors.state}
        />
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-ink">Pin on the map</p>
        <LocationPicker
          value={place}
          onChange={setLocation}
          error={errors.location}
          note="Shown only to you, and to the seller of an order you place for delivery."
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <Button loading={saving} onClick={save}>
          Save address
        </Button>
        {onCancel ? (
          <Button variant="secondary" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Saved delivery addresses on the profile page. */
export function SavedAddresses() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(null);

  const reload = useCallback(async () => {
    try {
      setItems((await api('/me/addresses')).items);
    } catch (failure) {
      setError(failure.message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api('/me/addresses')
      .then((data) => {
        if (!cancelled) setItems(data.items);
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

  return (
    <Card>
      <SectionHeading
        title="Delivery addresses"
        description="Only you, and the seller of an order delivered to it, can see these."
      />
      {error ? (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      ) : null}
      {items === null ? (
        error ? null : (
          <Loading label="Loading addresses" />
        )
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">
          No addresses yet. You can also add one when you check out.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((address) => (
            <li key={address.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 text-sm">
                <p className="flex items-center gap-2 font-medium text-ink">
                  {address.label}
                  {address.isDefault ? <Badge tone="success">Default</Badge> : null}
                </p>
                {addressLines(address).map((line) => (
                  <p key={line} className="break-words text-muted">
                    {line}
                  </p>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {address.isDefault ? null : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null}
                    loading={busy === address.id}
                    onClick={() =>
                      act(address.id, () =>
                        api(`/me/addresses/${address.id}`, {
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
                  onClick={() =>
                    act(address.id, () => api(`/me/addresses/${address.id}`, { method: 'DELETE' }))
                  }
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="mt-5 border-t border-line pt-5">
          <AddressForm
            onSaved={async () => {
              setAdding(false);
              await reload();
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : items && items.length < 5 ? (
        <Button variant="secondary" className="mt-4" onClick={() => setAdding(true)}>
          Add an address
        </Button>
      ) : null}
    </Card>
  );
}
