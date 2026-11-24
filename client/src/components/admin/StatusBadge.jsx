import { Badge } from '../ui/index.js';

/** A status shown as a badge, from a map of `{ label, tone }` (lib/dashboard.js). */
export function StatusBadge({ map, value }) {
  const info = map[value] ?? { label: value, tone: 'neutral' };
  return <Badge tone={info.tone}>{info.label}</Badge>;
}
