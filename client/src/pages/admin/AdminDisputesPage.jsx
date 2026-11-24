import { Link, useParams } from 'react-router-dom';
import { AdminList } from '../../components/admin/AdminList.jsx';
import { AdminHeading } from '../../components/admin/AdminLayout.jsx';
import { ReasonAction } from '../../components/admin/ReasonAction.jsx';
import {
  Alert,
  Badge,
  Card,
  Loading,
  SectionHeading,
  SelectField,
  TextField,
} from '../../components/ui/index.js';
import { api } from '../../lib/api.js';
import { DISPUTE_KIND, DISPUTE_STATUS, ISSUE_CATEGORY, decisionText } from '../../lib/disputes.js';
import { formatPaise, rupeesToPaise } from '../../lib/money.js';
import { when } from '../../lib/orders.js';
import { useFetch } from '../../lib/useFetch.js';

const options = (map) =>
  Object.entries(map).map(([value, v]) => ({ value, label: typeof v === 'string' ? v : v.label }));

const statusBadge = (status) => {
  const info = DISPUTE_STATUS[status] ?? { label: status, tone: 'neutral' };
  return <Badge tone={info.tone}>{info.label}</Badge>;
};

export function AdminDisputesPage() {
  return (
    <>
      <AdminHeading
        title="Disputes"
        description="Answered or unanswered disputes come here. Target: a decision within 5 business days."
      />
      <AdminList
        path="/admin/disputes"
        csv={false}
        extraQuery={{}}
        filters={[
          { name: 'status', label: 'Status', options: options(DISPUTE_STATUS) },
          { name: 'kind', label: 'Kind', options: options(DISPUTE_KIND) },
        ]}
        columns={[
          {
            header: 'Dispute',
            cell: (d) => (
              <Link to={`/admin/disputes/${d.id}`} className="font-medium text-ink hover:underline">
                {d.ref}
              </Link>
            ),
          },
          { header: 'Kind', cell: (d) => DISPUTE_KIND[d.kind] ?? d.kind },
          { header: 'About', cell: (d) => d.subject?.ref ?? '—' },
          {
            header: 'Status',
            cell: (d) => (
              <span className="flex flex-wrap gap-1">
                {statusBadge(d.status)}
                {d.reviewOverdue ? <Badge tone="danger">Past target</Badge> : null}
              </span>
            ),
          },
          { header: 'Opened', cell: (d) => when(d.createdAt) },
        ]}
      />
    </>
  );
}

const OUTCOMES = {
  SALE_ISSUE: [
    ['FULL_REFUND', 'Full refund to the buyer'],
    ['PARTIAL_REFUND', 'Partial refund'],
    ['REJECTED', 'No refund'],
  ],
  NOT_DELIVERED: [
    ['DELIVERED', 'Treat as delivered'],
    ['REFUND', 'Cancel with a full refund'],
  ],
  RENTAL_DEPOSIT: [['SETTLE', 'Set the deductions from the deposit']],
  NOT_RETURNED: [
    ['RETURNED', 'Treat as returned'],
    ['SETTLE', 'Set the deductions from the deposit'],
  ],
};

/** Turns rupee inputs into paise for the request; refuses text that is not an amount. */
function decisionBody(values) {
  const body = { reason: values.reason };
  if (values.outcome) body.outcome = values.outcome;
  for (const field of ['refundPaise', 'damagePaise', 'lateFeePaise']) {
    const text = values[field];
    if (text === undefined || text === '') continue;
    const paise = rupeesToPaise(text);
    if (paise === null) throw new Error('Enter amounts in rupees, like 300 or 300.50');
    body[field] = paise;
  }
  return body;
}

function DecisionFields({ kind, values, setValues, allowUphold }) {
  const choices = OUTCOMES[kind] ?? [];
  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }));
  return (
    <div className="space-y-3">
      <SelectField
        label="Decision"
        value={values.outcome}
        onChange={set('outcome')}
        placeholder={allowUphold ? 'Uphold the first decision' : 'Choose'}
        options={choices.map(([value, label]) => ({ value, label }))}
      />
      {values.outcome === 'PARTIAL_REFUND' ? (
        <TextField
          label="Refund"
          prefix="₹"
          inputMode="decimal"
          value={values.refundPaise}
          onChange={set('refundPaise')}
        />
      ) : null}
      {values.outcome === 'SETTLE' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Damage"
            prefix="₹"
            inputMode="decimal"
            value={values.damagePaise}
            onChange={set('damagePaise')}
          />
          <TextField
            label="Late fee"
            prefix="₹"
            inputMode="decimal"
            value={values.lateFeePaise}
            onChange={set('lateFeePaise')}
          />
        </div>
      ) : null}
    </div>
  );
}

export function AdminDisputePage() {
  const { id } = useParams();
  const { data, error, setData } = useFetch(`/admin/disputes/${id}`);
  if (error && !data) return <Alert tone="error">{error.message}</Alert>;
  if (!data) return <Loading />;
  const { dispute } = data;
  const decide = (path) => async (values) =>
    setData(
      await api(`/admin/disputes/${id}/${path}`, { method: 'POST', body: decisionBody(values) }),
    );
  const blank = { outcome: '', refundPaise: '', damagePaise: '', lateFeePaise: '' };
  const subjectLink =
    dispute.subject?.type === 'order'
      ? `/admin/orders?q=${dispute.subject.ref}`
      : dispute.subject
        ? `/admin/rentals?q=${dispute.subject.ref}`
        : null;

  return (
    <div className="space-y-6">
      <AdminHeading
        title={`${DISPUTE_KIND[dispute.kind] ?? dispute.kind} · ${dispute.ref}`}
        description={`Opened ${when(dispute.createdAt)}${dispute.openedByClaimant ? '' : ' by the system'}`}
        action={
          <div className="flex flex-wrap gap-2">
            {dispute.status === 'UNDER_REVIEW' || dispute.status === 'OPEN' ? (
              <ReasonAction
                label="Decide"
                variant="primary"
                title="Decide this dispute"
                description="It takes effect when the 3-day appeal window ends."
                initial={blank}
                fields={([values, setValues]) => (
                  <DecisionFields kind={dispute.kind} values={values} setValues={setValues} />
                )}
                onConfirm={decide('decide')}
              />
            ) : null}
            {dispute.status === 'APPEALED' ? (
              <ReasonAction
                label="Decide the appeal"
                variant="primary"
                description="This decision is final and takes effect at once. Leave the decision empty to uphold the first one."
                initial={blank}
                fields={([values, setValues]) => (
                  <DecisionFields
                    kind={dispute.kind}
                    values={values}
                    setValues={setValues}
                    allowUphold
                  />
                )}
                onConfirm={decide('decide-appeal')}
              />
            ) : null}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        {statusBadge(dispute.status)}
        {dispute.reviewOverdue ? <Badge tone="danger">Past the 5-business-day target</Badge> : null}
        {subjectLink ? (
          <Link to={subjectLink} className="text-sm text-accent hover:underline">
            {dispute.subject.type === 'order' ? 'Order' : 'Booking'} {dispute.subject.ref}
          </Link>
        ) : null}
      </div>

      <Card>
        <SectionHeading title="The claim" />
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Raised by</dt>
            <dd>{dispute.claimant?.displayName}</dd>
          </div>
          <div>
            <dt className="text-muted">Against</dt>
            <dd>{dispute.respondent?.displayName}</dd>
          </div>
          {dispute.category ? (
            <div>
              <dt className="text-muted">Problem</dt>
              <dd>{ISSUE_CATEGORY[dispute.category]}</dd>
            </div>
          ) : null}
          {dispute.claimedDamagePaise ? (
            <div>
              <dt className="text-muted">Damage claimed</dt>
              <dd>{formatPaise(dispute.claimedDamagePaise)}</dd>
            </div>
          ) : null}
        </dl>
        <p className="mt-3 whitespace-pre-line text-sm">{dispute.description}</p>
        {dispute.claimItems?.length ? (
          <ul className="mt-3 list-disc pl-5 text-sm">
            {dispute.claimItems.map((item) => (
              <li key={item.label}>
                {item.label}: {formatPaise(item.amountPaise)}
              </li>
            ))}
          </ul>
        ) : null}
        {dispute.lateFeeDisputed ? (
          <p className="mt-2 text-sm">The renter disputes the late fee.</p>
        ) : null}
      </Card>

      {dispute.decision ? (
        <Card>
          <SectionHeading title="Decision" />
          <p className="text-sm font-medium">{decisionText(dispute.decision)}</p>
          <p className="mt-1 text-sm text-muted">
            {dispute.decisionReason} · {when(dispute.decidedAt)}
            {dispute.appealDueAt ? ` · appeals until ${when(dispute.appealDueAt)}` : ''}
          </p>
          {dispute.appealReason ? (
            <p className="mt-3 text-sm">
              Appealed by the {dispute.appealedBy}: {dispute.appealReason}
            </p>
          ) : null}
          {dispute.finalDecision ? (
            <p className="mt-3 text-sm">
              Final: {decisionText(dispute.finalDecision)} · {dispute.finalReason}
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <SectionHeading title="Evidence" />
        {dispute.evidencePurged ? (
          <p className="text-sm text-muted">
            Photos were deleted 180 days after the dispute closed.
          </p>
        ) : null}
        {dispute.evidence.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="space-y-4">
            {dispute.evidence.map((entry) => (
              <li key={entry.id} className="text-sm">
                <p className="font-medium">
                  {entry.author ?? 'System'}{' '}
                  <span className="font-normal text-muted">
                    ({entry.role.toLowerCase()}) · {when(entry.createdAt)}
                  </span>
                </p>
                {entry.text ? <p className="mt-1 whitespace-pre-line">{entry.text}</p> : null}
                {entry.photos.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {entry.photos.map((photo) => (
                      <a key={photo.url} href={photo.url} target="_blank" rel="noreferrer">
                        <img
                          src={photo.url}
                          alt="Evidence"
                          className="size-24 rounded-field object-cover"
                        />
                      </a>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const REPORT_REASON = (value) =>
  value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ');

export function AdminReportsPage() {
  return (
    <>
      <AdminHeading
        title="Reports"
        description="What people reported. Dismiss, hide the review or remove the listing; acting on one resolves every open report about the same thing."
      />
      <AdminList
        path="/admin/reports"
        csv={false}
        filters={[
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: 'OPEN', label: 'Open' },
              { value: 'ACTIONED', label: 'Actioned' },
              { value: 'DISMISSED', label: 'Dismissed' },
            ],
          },
          {
            name: 'targetType',
            label: 'About',
            options: ['USER', 'LISTING', 'MESSAGE', 'REVIEW'].map((value) => ({
              value,
              label: REPORT_REASON(value),
            })),
          },
        ]}
        columns={[
          { header: 'About', cell: (r) => REPORT_REASON(r.targetType) },
          { header: 'Reason', cell: (r) => REPORT_REASON(r.reason) },
          {
            header: 'Target',
            width: 'minmax(0,1.6fr)',
            cell: (r) => <ReportTarget report={r} />,
          },
          {
            header: 'Status',
            cell: (r) => (
              <Badge tone={r.status === 'OPEN' ? 'notice' : 'neutral'}>
                {REPORT_REASON(r.status)}
              </Badge>
            ),
          },
          { header: 'Reported', cell: (r) => when(r.createdAt) },
        ]}
        expand={(report, reload) => (
          <div className="space-y-3 text-sm">
            {report.details ? <p>{report.details}</p> : null}
            {report.resolutionReason ? (
              <p className="text-muted">
                {REPORT_REASON(report.resolution)}: {report.resolutionReason}
              </p>
            ) : null}
            {report.status === 'OPEN' ? (
              <div className="flex flex-wrap gap-2">
                {[
                  ['DISMISS', 'Dismiss', null],
                  ['HIDE_REVIEW', 'Hide the review', 'REVIEW'],
                  ['REMOVE_LISTING', 'Remove the listing', 'LISTING'],
                ]
                  .filter(([, , type]) => !type || type === report.targetType)
                  .map(([action, label]) => (
                    <ReasonAction
                      key={action}
                      label={label}
                      variant={action === 'DISMISS' ? 'secondary' : 'danger'}
                      tone={action === 'DISMISS' ? 'primary' : 'danger'}
                      onConfirm={async ({ reason }) => {
                        await api(`/admin/reports/${report.id}/resolve`, {
                          method: 'POST',
                          body: { action, reason },
                        });
                        reload();
                      }}
                    />
                  ))}
                {report.targetType === 'USER' ? (
                  <Link
                    to={`/admin/users/${report.targetId}`}
                    className="self-center text-accent hover:underline"
                  >
                    Open the user to warn or suspend
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      />
    </>
  );
}

function ReportTarget({ report }) {
  const t = report.target;
  if (!t) return <span className="text-muted">Gone</span>;
  switch (report.targetType) {
    case 'USER':
      return (
        <Link to={`/admin/users/${report.targetId}`} className="hover:underline">
          {t.displayName ?? 'Erased account'}
        </Link>
      );
    case 'LISTING':
      return (
        <Link to={`/listings/${report.targetId}`} className="hover:underline">
          {t.title}
        </Link>
      );
    case 'MESSAGE':
      return <span className="line-clamp-2">“{t.body}”</span>;
    default:
      return (
        <span className="line-clamp-2">
          {t.overall}★ “{t.text ?? ''}”{t.status === 'HIDDEN' ? ' (hidden)' : ''}
        </span>
      );
  }
}
