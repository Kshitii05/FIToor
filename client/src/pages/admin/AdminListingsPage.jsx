import { Link } from 'react-router-dom';
import { StatusBadge } from '../../components/admin/StatusBadge.jsx';
import { AdminList } from '../../components/admin/AdminList.jsx';
import { AdminHeading } from '../../components/admin/AdminLayout.jsx';
import { ReasonAction } from '../../components/admin/ReasonAction.jsx';
import { api } from '../../lib/api.js';
import { LISTING_STATUS } from '../../lib/dashboard.js';
import { CATEGORIES, categoryLabel } from '../../lib/listings.js';
import { formatPaise } from '../../lib/money.js';
import { when } from '../../lib/orders.js';

const options = (map) => Object.entries(map).map(([value, { label }]) => ({ value, label }));

export default function AdminListingsPage() {
  return (
    <>
      <AdminHeading
        title="Listings"
        description="Remove listings that break the rules, or restore them. Each needs a reason."
      />
      <AdminList
        path="/admin/listings"
        filename="listings.csv"
        search="Title, brand or seller email"
        dates
        filters={[
          {
            name: 'mode',
            label: 'Type',
            options: [
              { value: 'SALE', label: 'For sale' },
              { value: 'RENT', label: 'For rent' },
            ],
          },
          { name: 'status', label: 'Status', options: options(LISTING_STATUS) },
          { name: 'category', label: 'Category', options: CATEGORIES },
        ]}
        columns={[
          {
            header: 'Listing',
            width: 'minmax(0,1.8fr)',
            cell: (l) => (
              <Link to={`/listings/${l.id}`} className="font-medium text-ink hover:underline">
                {l.title}
              </Link>
            ),
          },
          {
            header: 'Seller',
            width: 'minmax(0,1.3fr)',
            cell: (l) => (
              <Link to={`/admin/users/${l.seller.id}`} className="hover:underline">
                {l.seller.displayName ?? l.seller.email}
              </Link>
            ),
          },
          {
            header: 'Type',
            cell: (l) => `${l.mode === 'RENT' ? 'Rent' : 'Sale'} · ${categoryLabel(l.category)}`,
          },
          { header: 'Price', cell: (l) => formatPaise(l.headlinePricePaise) },
          { header: 'Status', cell: (l) => <StatusBadge map={LISTING_STATUS} value={l.status} /> },
        ]}
        expand={(listing, reload) => (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted">
              {listing.locality ?? 'No area'} · listed {when(listing.createdAt)}
            </span>
            {listing.status === 'REMOVED' ? (
              <ReasonAction
                label="Restore listing"
                description="It goes back to the status it had before it was removed."
                onConfirm={async (body) => {
                  await api(`/admin/listings/${listing.id}/restore`, { method: 'POST', body });
                  reload();
                }}
              />
            ) : (
              <ReasonAction
                label="Remove listing"
                variant="danger"
                tone="danger"
                description="It disappears from the site at once. The seller cannot change it while removed."
                onConfirm={async (body) => {
                  await api(`/admin/listings/${listing.id}/remove`, { method: 'POST', body });
                  reload();
                }}
              />
            )}
          </div>
        )}
      />
    </>
  );
}
