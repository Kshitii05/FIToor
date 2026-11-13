import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/authContext.js';
import { APP_NAME } from '../../config/app.js';
import { Button, ButtonLink } from '../ui/index.js';

function navLinkClass({ isActive }) {
  return `rounded-field px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-accent-soft text-accent-strong' : 'text-ink hover:bg-accent-soft'
  }`;
}

function AccountNav() {
  const { status, user, logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  if (status === 'loading') return null;

  if (status === 'signedOut') {
    return (
      <>
        <NavLink to="/login" className={navLinkClass}>
          Sign in
        </NavLink>
        <ButtonLink to="/register" size="sm">
          Join
        </ButtonLink>
      </>
    );
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logout();
      navigate('/');
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <>
      <NavLink to="/my-listings" className={navLinkClass}>
        <span className="hidden sm:inline">My listings</span>
        <span className="sm:hidden">Listings</span>
      </NavLink>
      <NavLink to="/profile" className={navLinkClass}>
        <span className="hidden sm:inline">{user.profile.displayName}</span>
        <span className="sm:hidden">Profile</span>
      </NavLink>
      <ButtonLink to="/listings/new" size="sm">
        <span className="hidden sm:inline">List an item</span>
        <span className="sm:hidden">List</span>
      </ButtonLink>
      {/* On small screens signing out is on the profile page instead. */}
      <Button
        variant="secondary"
        size="sm"
        className="hidden sm:inline-flex"
        loading={signingOut}
        onClick={handleSignOut}
      >
        Sign out
      </Button>
    </>
  );
}

/** Page chrome shared by every route: header, content column, footer. */
export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-field focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <header className="border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="font-display text-2xl font-semibold tracking-tight text-ink">
            {APP_NAME}
          </Link>
          <nav aria-label="Account" className="flex items-center gap-2">
            <AccountNav />
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <Outlet />
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-muted sm:px-6">
          {APP_NAME} · Pre-loved fashion from people nearby
        </div>
      </footer>
    </div>
  );
}

/** Narrow centered column with a title, for sign-in style pages. */
export function FormPage({ title, intro, children, footer }) {
  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{title}</h1>
      {intro ? <p className="mt-2 text-muted">{intro}</p> : null}
      <div className="mt-7">{children}</div>
      {footer ? <div className="mt-6 text-sm text-muted">{footer}</div> : null}
    </div>
  );
}

export function TextLink({ to, children }) {
  return (
    <Link to={to} className="font-medium text-accent underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}
