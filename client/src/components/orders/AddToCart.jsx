import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/authContext.js';
import { useCart } from '../../cart/cartContext.js';
import { api } from '../../lib/api.js';
import { Button, ButtonLink, SelectField } from '../ui/index.js';

/** Add a sale listing to the cart, or show that it is already there. */
export function AddToCart({ listing }) {
  const { status } = useAuth();
  const { cart, setCart } = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (listing.mode !== 'SALE' || !listing.available) return null;

  const inCart = cart?.groups.some((group) =>
    group.items.some((item) => item.listing.id === listing.id),
  );
  if (inCart) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-medium text-success">In your cart</p>
        <ButtonLink to="/cart" variant="secondary">
          View cart
        </ButtonLink>
      </div>
    );
  }

  async function add() {
    if (status !== 'signedIn') {
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { cart: updated } = await api('/cart/items', {
        method: 'POST',
        body: { listingId: listing.id, quantity: Number(quantity) },
      });
      setCart(updated);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  const stock = listing.sale.quantity;
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
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
        <Button loading={busy} onClick={add}>
          Add to cart
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
