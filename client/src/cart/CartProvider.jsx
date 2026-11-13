import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/authContext.js';
import { api } from '../lib/api.js';
import { CartContext } from './cartContext.js';

export function CartProvider({ children }) {
  const { status, user } = useAuth();
  // Keyed by the signed-in user, so one person's cart is never shown to another.
  const [state, setState] = useState({ userId: null, cart: null });
  const userId = status === 'signedIn' ? user.id : null;

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const { cart } = await api('/cart');
      setState({ userId, cart });
    } catch {
      // The count is a convenience; the cart page shows any real problem.
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    api('/cart')
      .then(({ cart }) => {
        if (!cancelled) setState({ userId, cart });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setCart = useCallback((cart) => setState({ userId, cart }), [userId]);
  const cart = state.userId === userId ? state.cart : null;

  const value = useMemo(
    () => ({ cart, count: cart?.itemCount ?? 0, refresh, setCart }),
    [cart, refresh, setCart],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
