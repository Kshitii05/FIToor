import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { CATEGORY } from '../../lib/notifications.js';
import { Alert, Card, Loading, SectionHeading, Switch } from '../ui/index.js';

/**
 * On the profile: what to hear about, in the app and by email. Orders, rentals,
 * payments and disputes are always on (the server refuses to turn them off).
 */
export function NotificationSettings() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api('/me/notification-preferences')
      .then((data) => !cancelled && setItems(data.items))
      .catch((failure) => !cancelled && setError(failure.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function change(category, field, value) {
    const previous = items;
    const current = items.find((item) => item.category === category);
    const next = { category, inApp: current.inApp, email: current.email, [field]: value };
    setItems(items.map((item) => (item.category === category ? { ...item, ...next } : item)));
    setSaving(category);
    setError(null);
    try {
      setItems(
        (await api('/me/notification-preferences', { method: 'PUT', body: { items: [next] } }))
          .items,
      );
    } catch (failure) {
      setItems(previous);
      setError(`Could not save that change. ${failure.message}`);
    } finally {
      setSaving(null);
    }
  }

  const critical = items?.filter((item) => item.critical) ?? [];
  const optional = items?.filter((item) => !item.critical) ?? [];
  return (
    <Card>
      <SectionHeading
        title="Notifications"
        description="Choose what you hear about, in the app and by email."
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!items ? (
        error ? null : (
          <Loading label="Loading settings" />
        )
      ) : (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-medium text-ink">Always on</p>
            <p className="mt-0.5 text-sm text-muted">
              {critical.map((item) => CATEGORY[item.category].label).join(', ')}: these affect your
              money and your transactions, so they always arrive in the app and by email.
            </p>
          </div>
          <ul className="divide-y divide-line">
            {optional.map((item) => (
              <li key={item.category} className="py-3">
                <p className="text-sm font-medium text-ink">{CATEGORY[item.category].label}</p>
                <p className="text-sm text-muted">{CATEGORY[item.category].description}</p>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  <Switch
                    label="In the app"
                    checked={item.inApp}
                    disabled={saving === item.category}
                    onChange={(value) => change(item.category, 'inApp', value)}
                  />
                  <Switch
                    label="By email"
                    checked={item.email}
                    disabled={saving === item.category}
                    onChange={(value) => change(item.category, 'email', value)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
