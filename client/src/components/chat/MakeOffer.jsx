import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/authContext.js';
import { api } from '../../lib/api.js';
import { fullTime } from '../../lib/chat.js';
import { formatPaise, rupeesToPaise } from '../../lib/money.js';
import { Alert, Button, Card, SelectField, TextField } from '../ui/index.js';
import { MessageButton } from './MessageButton.jsx';

/** On a listing someone else owns: message them, and on sale items, make an offer. */
export function ContactSeller({ listing }) {
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const signedIn = status === 'signedIn';
  const verified = user?.emailVerified && user?.phoneVerified;
  const sale = listing.mode === 'SALE' && listing.available && listing.status === 'ACTIVE';
  const [offers, setOffers] = useState({ loaded: !signedIn || !sale });
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!signedIn || !sale) return undefined;
    let cancelled = false;
    api(`/offers?listingId=${listing.id}`)
      .then((data) => !cancelled && setOffers({ loaded: true, live: data.live }))
      .catch(() => !cancelled && setOffers({ loaded: true, live: null }));
    return () => {
      cancelled = true;
    };
  }, [signedIn, sale, listing.id]);

  async function send() {
    const unitPricePaise = rupeesToPaise(price);
    if (!unitPricePaise) {
      setError('Enter an amount in rupees');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { conversationId } = await api('/offers', {
        method: 'POST',
        body: { listingId: listing.id, unitPricePaise, quantity: Number(quantity) },
      });
      navigate(`/messages/${conversationId}`);
    } catch (failure) {
      setError(failure.message);
      setSending(false);
    }
  }

  const live = offers.live;
  const stock = listing.sale?.quantity ?? 1;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <MessageButton about={{ listingId: listing.id }}>
          Message {listing.mode === 'SALE' ? 'seller' : 'owner'}
        </MessageButton>
        {sale && !live && !open ? (
          <Button
            variant="secondary"
            onClick={() =>
              signedIn ? setOpen(true) : navigate('/login', { state: { from: location.pathname } })
            }
          >
            Make an offer
          </Button>
        ) : null}
      </div>

      {live?.status === 'ACCEPTED' ? (
        <Alert tone="success" title="Your offer was accepted">
          You can buy {live.quantity > 1 ? `up to ${live.quantity} ` : ''}at{' '}
          {formatPaise(live.unitPricePaise)} {live.quantity > 1 ? 'each ' : ''}until{' '}
          {fullTime(live.useBy)}. Your cart uses this price. It does not hold the item, so buy soon.
        </Alert>
      ) : null}
      {live?.status === 'OPEN' ? (
        <p className="text-sm text-muted">
          You have an open offer of {formatPaise(live.unitPricePaise)}.{' '}
          <Link
            to={`/messages/${live.conversationId}`}
            className="text-accent underline-offset-4 hover:underline"
          >
            See the chat
          </Link>
        </p>
      ) : null}

      {open ? (
        <Card>
          {!verified ? (
            <Alert tone="notice">
              Verify your email and phone to make offers. <Link to="/verify">Verify now</Link>
            </Alert>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink">
                Listed at {formatPaise(listing.sale.pricePaise)}. Offer a lower price per item; the
                seller can accept, decline or reply with their own price.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-36">
                  <TextField
                    label="Your price"
                    prefix="₹"
                    inputMode="decimal"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                  />
                </div>
                {stock > 1 ? (
                  <div className="w-24">
                    <SelectField
                      label="Quantity"
                      options={Array.from({ length: Math.min(stock, 10) }, (_, i) => ({
                        value: String(i + 1),
                        label: String(i + 1),
                      }))}
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                    />
                  </div>
                ) : null}
              </div>
              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button loading={sending} onClick={send}>
                  Send offer
                </Button>
                <Button variant="ghost" disabled={sending} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
