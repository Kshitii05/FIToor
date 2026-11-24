import { AdminList } from '../../components/admin/AdminList.jsx';
import { AdminHeading } from '../../components/admin/AdminLayout.jsx';
import { when } from '../../lib/orders.js';

const words = (value) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ');

const ACTIONS = [
  'SUSPEND_USER',
  'BAN_USER',
  'RESTORE_USER',
  'WARN_USER',
  'REMOVE_LISTING',
  'RESTORE_LISTING',
  'RESOLVE_REPORT',
  'RETRY_REFUND',
  'VERIFY_BANK_ACCOUNT',
  'REJECT_BANK_ACCOUNT',
  'BUILD_PAYOUT_BATCH',
  'DOWNLOAD_PAYOUT_BANK_FILE',
  'MARK_PAYOUT_PAID',
  'MARK_PAYOUT_FAILED',
  'RETRY_PAYOUT',
];

/** Every admin action with its reason. The log cannot be changed, even by an admin. */
export default function AdminAuditLogPage() {
  return (
    <>
      <AdminHeading
        title="Audit log"
        description="Every admin action, who took it and why. Rows can never be changed or deleted."
      />
      <AdminList
        path="/admin/audit-log"
        filename="audit-log.csv"
        search="Words in the reason"
        dates
        filters={[
          {
            name: 'action',
            label: 'Action',
            options: ACTIONS.map((value) => ({ value, label: words(value) })),
          },
          {
            name: 'targetType',
            label: 'About',
            options: [
              'user',
              'listing',
              'order',
              'booking',
              'dispute',
              'report',
              'review',
              'refund',
              'bankAccount',
              'payoutBatch',
              'payoutItem',
            ].map((value) => ({ value, label: value })),
          },
        ]}
        columns={[
          { header: 'When', cell: (r) => when(r.createdAt) },
          { header: 'Admin', width: 'minmax(0,1.3fr)', cell: (r) => r.admin.email },
          { header: 'Action', cell: (r) => words(r.action) },
          { header: 'Reason', width: 'minmax(0,2.2fr)', cell: (r) => r.reason },
        ]}
        expand={(row) => (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">About</dt>
              <dd className="break-all">
                {row.targetType} {row.targetId}
              </dd>
            </div>
            {row.details ? (
              <div>
                <dt className="text-muted">Details</dt>
                <dd className="break-all font-mono text-xs">{JSON.stringify(row.details)}</dd>
              </div>
            ) : null}
          </dl>
        )}
      />
    </>
  );
}
