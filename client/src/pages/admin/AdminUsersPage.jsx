import { Link } from 'react-router-dom';
import { AdminList } from '../../components/admin/AdminList.jsx';
import { AdminHeading } from '../../components/admin/AdminLayout.jsx';
import { StatusBadge } from '../../components/admin/StatusBadge.jsx';
import { BANK_STATUS, USER_STATUS } from '../../lib/dashboard.js';
import { when } from '../../lib/orders.js';

const options = (map) => Object.entries(map).map(([value, { label }]) => ({ value, label }));

export default function AdminUsersPage() {
  return (
    <>
      <AdminHeading
        title="Users"
        description="Find a person, see their history, warn, suspend or restore them."
      />
      <AdminList
        path="/admin/users"
        filename="users.csv"
        search="Name, email or phone"
        dates
        filters={[
          { name: 'status', label: 'Status', options: options(USER_STATUS) },
          {
            name: 'role',
            label: 'Role',
            options: [
              { value: 'USER', label: 'Member' },
              { value: 'ADMIN', label: 'Admin' },
            ],
          },
        ]}
        columns={[
          {
            header: 'Name',
            width: 'minmax(0,1.3fr)',
            cell: (u) => (
              <Link to={`/admin/users/${u.id}`} className="font-medium text-ink hover:underline">
                {u.displayName ?? 'Erased account'}
              </Link>
            ),
          },
          { header: 'Email', width: 'minmax(0,1.6fr)', cell: (u) => u.email },
          { header: 'Status', cell: (u) => <StatusBadge map={USER_STATUS} value={u.status} /> },
          {
            header: 'Bank',
            cell: (u) =>
              u.bankAccountStatus ? (
                <StatusBadge map={BANK_STATUS} value={u.bankAccountStatus} />
              ) : (
                '—'
              ),
          },
          { header: 'Joined', cell: (u) => when(u.createdAt) },
        ]}
      />
    </>
  );
}
