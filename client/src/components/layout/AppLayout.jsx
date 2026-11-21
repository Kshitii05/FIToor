import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/authContext.js';
import { useCart } from '../../cart/cartContext.js';
import { useChat } from '../../chat/chatContext.js';
import { APP_NAME, APP_TAGLINE } from '../../config/app.js';
import { SearchBox } from '../search/SearchBox.jsx';
import { ButtonLink, Loading } from '../ui/index.js';

function navLinkClass({ isActive }) {
  return `rounded-field px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-accent-soft text-accent-strong' : 'text-ink hover:bg-accent-soft'
  }`;
}

const CART_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
    <path
      d="M3.5 4.5h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h7.9a1.5 1.5 0 0 0 1.5-1.1l1.6-6.3H6.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="9.5" cy="19.5" r="1.3" fill="currentColor" />
    <circle cx="17" cy="19.5" r="1.3" fill="currentColor" />
  </svg>
);

function CartLink() {
  const { count } = useCart();
  return (
    <NavLink
      to="/cart"
      className={(state) => `relative ${navLinkClass(state)}`}
      aria-label={count ? `Cart, ${count} ${count === 1 ? 'item' : 'items'}` : 'Cart'}
      title="Cart"
    >
      {CART_ICON}
      {count ? (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-semibold leading-5 text-white">
          {count}
        </span>
      ) : null}
    </NavLink>
  );
}

const CHAT_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
    <path
      d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5v-3.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

function MessagesLink() {
  const { unread } = useChat();
  return (
    <NavLink
      to="/messages"
      className={(state) => `relative ${navLinkClass(state)}`}
      aria-label={unread ? `Messages, ${unread} unread` : 'Messages'}
      title="Messages"
    >
      {CHAT_ICON}
      {unread ? (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-semibold leading-5 text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </NavLink>
  );
}

const MENU_LINKS = [
  ['/messages', 'Messages'],
  ['/orders', 'My orders'],
  ['/sales', 'My sales'],
  ['/rentals', 'My rentals'],
  ['/rented-out', 'Rented out'],
  ['/my-listings', 'My listings'],
  ['/liked', 'Liked'],
  ['/profile', 'Profile'],
];

/** The account menu: one button, so the header fits on a phone. */
function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuId = useId();
  const wrapper = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (
        event.type === 'keydown' ? event.key === 'Escape' : !wrapper.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logout();
      navigate('/');
    } finally {
      setSigningOut(false);
      setOpen(false);
    }
  }

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        aria-label={`Account menu for ${user.profile.displayName}`}
        className="flex min-h-9 max-w-40 items-center gap-1 rounded-field px-1.5 text-sm font-medium text-ink hover:bg-accent-soft sm:px-2.5"
      >
        {/* Phones show the initial so the header fits; wider screens show the name. */}
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-full bg-accent-soft font-display font-semibold text-accent-strong sm:hidden"
        >
          {user.profile.displayName[0]?.toUpperCase()}
        </span>
        <span className="hidden truncate sm:inline">{user.profile.displayName}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div
          id={menuId}
          className="absolute right-0 top-full z-30 mt-2 w-48 overflow-hidden rounded-card border border-line bg-surface py-1 shadow-card"
        >
          <nav aria-label="Your account">
            {MENU_LINKS.map(([to, label]) => (
              <Link
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm text-ink hover:bg-accent-soft"
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-line">
            <button
              type="button"
              disabled={signingOut}
              onClick={handleSignOut}
              className="block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-accent-soft disabled:opacity-60"
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AccountNav() {
  const { status } = useAuth();

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

  return (
    <>
      <MessagesLink />
      <CartLink />
      <ButtonLink to="/listings/new" size="sm">
        <span className="hidden sm:inline">List an item</span>
        <span className="sm:hidden">List</span>
      </ButtonLink>
      <AccountMenu />
    </>
  );
}

/** Page chrome shared by every route: header, content column, footer. */
export function AppLayout() {
  const { status } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  // On the search page the box shows the current search; elsewhere it starts empty.
  const currentSearch = location.pathname === '/search' ? (params.get('q') ?? '') : '';

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-field focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <header className="border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
          <Link
            to="/"
            className="shrink-0 font-display text-2xl font-semibold tracking-tight text-ink"
          >
            {APP_NAME}
          </Link>
          {/* Remounted when the search changes, so the box always shows the current one. */}
          <SearchBox
            key={`wide-${currentSearch}`}
            initialText={currentSearch}
            className="hidden max-w-md flex-1 md:block"
          />
          <nav aria-label="Account" className="flex items-center gap-1 sm:gap-2">
            <AccountNav />
          </nav>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-3 sm:px-6 md:hidden">
          <SearchBox key={`narrow-${currentSearch}`} initialText={currentSearch} />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {/*
          Pages wait until the saved sign-in is restored: many show more to signed-in
          people (likes, recommendations), and a request sent too early would be
          answered as if for a visitor.
        */}
        {status === 'loading' ? <Loading /> : <Outlet />}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-muted sm:px-6">
          {APP_NAME}
          {APP_TAGLINE ? ` · ${APP_TAGLINE}` : ''} · Pre-loved fashion from people nearby
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
