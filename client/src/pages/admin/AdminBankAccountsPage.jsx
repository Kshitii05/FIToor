import { useState } from 'react';
import { StatusBadge } from '../../components/admin/StatusBadge.jsx';
import { Link } from 'react-router-dom';
import { AdminList } from '../../components/admin/AdminList.jsx';
import { AdminHeading } from '../../components/admin/AdminLayout.jsx';
import { ReasonAction } from '../../components/admin/ReasonAction.jsx';
import { FilterTabs } from '../../components/ui/index.js';
import { api } from '../../lib/api.js';
import { BANK_STATUS } from '../../lib/dashboard.js';
import { when } from '../../lib/orders.js';

const TABS = [
  { value: 'PENDING', label: 'Waiting for a check' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'REJECTED', label: 'Rejected' },
];

/** The queue of seller bank details to check before any payout uses them (I14, I105). */
export default function AdminBankAccountsPage() {
  const [status, setStatus] = useState('PENDING');
  return (
    <>
      <AdminHeading
        title="Bank checks"
        description="Confirm the account belongs to the seller (for example with a small test transfer) before verifying. Numbers are masked here; the full number is only in a payout batch's bank file."
      />
      <div className="mb-6">
        <FilterTabs label="Show" options={TABS} value={status} onChange={setStatus} />
      </div>
      <AdminList
        key={status}
        path="/admin/bank-accounts"
        csv={false}
        extraQuery={{ status }}
        columns={[
          {
            header: 'Seller',
            width: 'minmax(0,1.5fr)',
            cell: (a) => (
              <Link to={`/admin/users/${a.user.id}`} className="font-medium hover:underline">
                {a.user.displayName ?? a.user.email}
              </Link>
            ),
          },
          { header: 'Holder', width: 'minmax(0,1.3fr)', cell: (a) => a.holderName },
          { header: 'Account', cell: (a) => `${a.accountNumber} · ${a.ifsc}` },
          { header: 'Status', cell: (a) => <StatusBadge map={BANK_STATUS} value={a.status} /> },
          { header: 'Sent', cell: (a) => when(a.submittedAt) },
        ]}
        expand={(account, reload) => (
          <div className="space-y-3 text-sm">
            {account.note ? <p className="text-muted">{account.note}</p> : null}
            <p className="text-muted">
              Profile name: {account.user.displayName ?? '—'} · compare it with the holder name.
            </p>
            {account.status === 'PENDING' ? (
              <div className="flex flex-wrap gap-2">
                <ReasonAction
                  label="Verify"
                  variant="primary"
                  title="Verify these bank details"
                  description="Payouts will go to this account from the next batch."
                  reasonLabel="How you checked (kept in the audit log)"
                  onConfirm={async (body) => {
                    await api(`/admin/bank-accounts/${account.id}/verify`, {
                      method: 'POST',
                      body,
                    });
                    reload();
                  }}
                />
                <ReasonAction
                  label="Reject"
                  variant="danger"
                  tone="danger"
                  title="Reject these bank details"
                  reasonLabel="What is wrong (the seller sees this)"
                  onConfirm={async (body) => {
                    await api(`/admin/bank-accounts/${account.id}/reject`, {
                      method: 'POST',
                      body,
                    });
                    reload();
                  }}
                />
              </div>
            ) : null}
          </div>
        )}
      />
    </>
  );
}
