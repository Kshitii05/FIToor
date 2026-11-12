import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loading } from '../components/ui/index.js';
import { useAuth } from './authContext.js';

// These only decide what to show. The server enforces access on every request.

/** Pages for signed-in users. Others are sent to sign in, then back. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Loading />;
  if (status === 'signedOut') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/** Pages that make no sense once signed in (sign in, register, password reset). */
export function GuestOnly() {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Loading />;
  if (status === 'signedIn') {
    // Back to the page that asked for sign-in; otherwise new accounts go on to verification.
    const verified = user.emailVerified && user.phoneVerified;
    const destination = location.state?.from ?? (verified ? '/profile' : '/verify');
    return <Navigate to={destination} replace />;
  }
  return <Outlet />;
}
