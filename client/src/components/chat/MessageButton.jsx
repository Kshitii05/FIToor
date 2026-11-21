import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/authContext.js';
import { api } from '../../lib/api.js';
import { Button } from '../ui/index.js';

/**
 * Opens the chat with the other person about a listing, order or rental
 * (`about` is { listingId } or { orderId } or { bookingId }).
 */
export function MessageButton({ about, children = 'Message', variant = 'secondary', size }) {
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function open() {
    if (status !== 'signedIn') {
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { conversation } = await api('/conversations', { method: 'POST', body: about });
      navigate(`/messages/${conversation.id}`);
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  }

  return (
    <div>
      <Button variant={variant} size={size} loading={busy} onClick={open}>
        {children}
      </Button>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
