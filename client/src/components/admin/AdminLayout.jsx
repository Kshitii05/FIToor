import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/authContext.js';
import { EmptyState, Loading } from '../ui/index.js';

const SECTIONS = [
  ['/admin', 'Overview', true],
  ['/admin/users', 'Users'],
  ['/admin/listings', 'Listings'],
  ['/admin/orders', 'Orders'],
  ['/admin/rentals', 'Rentals'],
  ['/admin/disputes', 'Disputes'],
  ['/admin/reports', 'Reports'],
  ['/admin/money', 'Money'],
  ['/admin/bank-accounts', 'Bank checks'],
  ['/admin/payouts', 'Payouts'],
  ['/admin/audit-log', 'Audit log'],
];

const tab = ({ isActive }) =>
  `shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-accent text-white' : 'text-ink hover:bg-accent-soft'
  }`;

/**
 * The admin console frame. It only decides what to show: every admin request is
 * checked for the admin role on the server.
 */
export function AdminLayout() {
  const { status, user } = useAuth();
  const nav = useRef(null);
  const { pathname } = useLocation();
  // On a phone the section tabs scroll sideways; keep the current one in view.
  useEffect(() => {
    nav.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);

  if (status === 'loading') return <Loading />;
  if (user?.role !== 'ADMIN') {
    return (
      <EmptyState title="Admins only">This part of the site is for the platform admin.</EmptyState>
    );
  }
  return (
    <div>
      <nav
        ref={nav}
        aria-label="Admin sections"
        className="-mx-4 mb-8 flex gap-1 overflow-x-auto border-b border-line px-4 pb-3 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {SECTIONS.map(([to, label, end]) => (
          <NavLink key={to} to={to} end={end} className={tab}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

export function AdminHeading({ title, description, action }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
