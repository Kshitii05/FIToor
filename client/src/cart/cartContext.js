import { createContext, useContext } from 'react';

export const CartContext = createContext(null);

/**
 * The signed-in person's cart: `{ cart, count, refresh, setCart }`. `cart` is the
 * server's cart view (null until loaded or when signed out). Pages that change the
 * cart pass the server's reply to `setCart`, so the header count stays right.
 */
export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside CartProvider');
  return value;
}
