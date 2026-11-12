import { createContext, useContext } from 'react';

export const AuthContext = createContext(null);

/**
 * `{ status, user, notice, register, login, recover, logout, setUser, clearSession }`
 * where status is 'loading', 'signedIn' or 'signedOut'.
 */
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
