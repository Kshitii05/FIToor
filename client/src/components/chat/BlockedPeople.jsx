import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Alert, Button, Card, SectionHeading } from '../ui/index.js';

/** On the profile: people the signed-in person has blocked, with Unblock. */
export function BlockedPeople() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api('/blocks')
      .then((data) => !cancelled && setItems(data.items))
      .catch((failure) => !cancelled && setError(failure.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function unblock(userId) {
    setBusy(userId);
    setError(null);
    try {
      await api(`/blocks/${userId}`, { method: 'DELETE' });
      setItems((current) => current.filter((item) => item.user.id !== userId));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <SectionHeading
        title="Blocked people"
        description="They cannot message you or send offers, and you cannot message them."
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {items === null ? null : items.length === 0 ? (
        <p className="text-sm text-muted">
          You have not blocked anyone. You can block someone from a chat.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.user.id} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-ink">{item.user.displayName}</span>
              <Button
                variant="secondary"
                size="sm"
                loading={busy === item.user.id}
                onClick={() => unblock(item.user.id)}
              >
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
