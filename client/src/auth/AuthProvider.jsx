import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, refreshSession, setAccessToken, setSessionLostHandler } from '../lib/api.js';
import { AuthContext } from './authContext.js';

const SIGNED_OUT = { status: 'signedOut', user: null };

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null });

  // On load, restore the session from the refresh cookie if there is one.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        if (!(await refreshSession())) return SIGNED_OUT;
        const { user } = await api('/me');
        return { status: 'signedIn', user };
      } catch {
        return SIGNED_OUT;
      }
    }

    restore().then((next) => {
      if (!cancelled) setState(next);
    });
    setSessionLostHandler(() => setState(SIGNED_OUT));

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (path, body) => {
    const { user, accessToken } = await api(path, { method: 'POST', body, auth: false });
    setAccessToken(accessToken);
    setState({ status: 'signedIn', user });
    return user;
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      register: (details) => signIn('/auth/register', details),
      login: (credentials) => signIn('/auth/login', credentials),
      recover: (credentials) => signIn('/auth/recover', credentials),
      async logout() {
        try {
          await api('/auth/logout', { method: 'POST', auth: false });
        } finally {
          setAccessToken(null);
          setState(SIGNED_OUT);
        }
      },
      /** Replace the cached user after the server returns an updated one. */
      setUser: (user) => setState({ status: 'signedIn', user }),
      /**
       * Drop the local session without calling the server (it already ended there).
       * `notice` is shown on the sign-in page the user lands on.
       */
      clearSession(notice = null) {
        setAccessToken(null);
        setState({ ...SIGNED_OUT, notice });
      },
    }),
    [state, signIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
