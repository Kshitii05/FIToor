import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../../cart/cartContext.js';
import { api } from '../../lib/api.js';
import { fullTime, OFFER_STATUS, offerActions } from '../../lib/chat.js';
import { formatPaise, rupeesToPaise } from '../../lib/money.js';
import { Badge, Button, TextField } from '../ui/index.js';

/** A price offer inside a chat, with the buttons the viewer may use. */
export function OfferCard({ offer, me, onChange }) {
  const navigate = useNavigate();
  const { setCart } = useCart();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [countering, setCountering] = useState(false);
  const [price, setPrice] = useState('');
  const status = OFFER_STATUS[offer.status] ?? { label: offer.status, tone: 'neutral' };
  const actions = offerActions(offer, me);
  const fromMe = offer.madeById === me;

  async function act(action, body) {
    setBusy(action);
    setError(null);
    try {
      const data = await api(`/offers/${offer.id}/${action}`, { method: 'POST', body });
      onChange?.(data.offer);
      setCountering(false);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(null);
    }
  }

  async function buy() {
    setBusy('buy');
    setError(null);
    try {
      const { cart } = await api('/cart/items', {
        method: 'POST',
        body: { listingId: offer.listingId, quantity: offer.quantity },
      });
      setCart(cart);
      navigate('/cart');
    } catch (failure) {
      setError(failure.message);
      setBusy(null);
    }
  }

  const counterPaise = rupeesToPaise(price);
  return (
    <div className="w-full max-w-sm rounded-card border border-accent/40 bg-surface p-4 text-sm shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-ink">{fromMe ? 'Your offer' : 'Offer'}</p>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      {offer.listing ? (
        <Link
          to={`/listings/${offer.listingId}`}
          className="mt-1 block truncate text-muted underline-offset-4 hover:underline"
        >
          {offer.listing.title}
        </Link>
      ) : null}
      <p className="mt-2 font-display text-2xl font-semibold text-ink">
        {formatPaise(offer.unitPricePaise)}
        {offer.quantity > 1 ? (
          <span className="text-base font-normal"> each × {offer.quantity}</span>
        ) : null}
      </p>
      <p className="text-xs text-muted">Listed at {formatPaise(offer.listPricePaise)}</p>
      {offer.status === 'OPEN' ? (
        <p className="mt-1 text-xs text-muted">Open until {fullTime(offer.expiresAt)}</p>
      ) : null}
      {offer.status === 'ACCEPTED' && offer.useBy ? (
        <p className="mt-1 text-xs text-muted">
          The buyer can check out at this price until {fullTime(offer.useBy)}. It does not hold the
          item for them.
        </p>
      ) : null}

      {actions.length ? (
        <div className="mt-3 space-y-2">
          {countering ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-32">
                <TextField
                  label="Your price"
                  prefix="₹"
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                />
              </div>
              <Button
                size="sm"
                loading={busy === 'counter'}
                disabled={!counterPaise}
                onClick={() => act('counter', { unitPricePaise: counterPaise })}
              >
                Send
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCountering(false)}>
                Back
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {actions.includes('accept') ? (
                <Button size="sm" loading={busy === 'accept'} onClick={() => act('accept')}>
                  Accept
                </Button>
              ) : null}
              {actions.includes('counter') ? (
                <Button size="sm" variant="secondary" onClick={() => setCountering(true)}>
                  Counter
                </Button>
              ) : null}
              {actions.includes('reject') ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === 'reject'}
                  onClick={() => act('reject')}
                >
                  Decline
                </Button>
              ) : null}
              {actions.includes('withdraw') ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === 'withdraw'}
                  onClick={() => act('withdraw')}
                >
                  Withdraw
                </Button>
              ) : null}
              {actions.includes('buy') ? (
                <Button size="sm" loading={busy === 'buy'} onClick={buy}>
                  Buy at this price
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
