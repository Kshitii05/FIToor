import { Link } from 'react-router-dom';
import { DISPUTE_KIND, DISPUTE_STATUS, UNFINISHED } from '../../lib/disputes.js';
import { Badge } from '../ui/index.js';

/** On an order or rental page: its disputes, the unfinished one first, each linked. */
export function DisputeLinks({ disputes = [] }) {
  const shown = disputes.filter((d) => d.status !== 'WITHDRAWN');
  if (shown.length === 0) return null;
  const ordered = [...shown].sort(
    (a, b) => Number(UNFINISHED.includes(b.status)) - Number(UNFINISHED.includes(a.status)),
  );
  return (
    <ul className="space-y-2">
      {ordered.map((dispute) => {
        const status = DISPUTE_STATUS[dispute.status];
        return (
          <li key={dispute.id}>
            <Link
              to={`/disputes/${dispute.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-surface px-4 py-3 text-sm shadow-card hover:shadow-lg"
            >
              <span className="font-medium text-ink">
                Dispute: {DISPUTE_KIND[dispute.kind]} · {dispute.ref}
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={status.tone}>{status.label}</Badge>
                <span className="text-accent" aria-hidden="true">
                  ›
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
