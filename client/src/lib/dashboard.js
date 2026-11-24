// Labels and date ranges for the seller and admin dashboards.

const indiaDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in India, as YYYY-MM-DD (the server counts whole days in India time). */
export const todayInIndia = () => indiaDate.format(new Date());

/** The calendar date `days` before `date`, both YYYY-MM-DD. */
export function daysBefore(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

export const RANGE_PRESETS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '12 months' },
];

/** The starting value of a date range filter: the last `preset` days. */
export const initialRange = (preset = '30') => ({ preset, ...presetRange(preset) });

/** `{ from, to }` for a preset of the last N days, ending today. */
export function presetRange(days) {
  const to = todayInIndia();
  return { from: daysBefore(to, Number(days) - 1), to };
}

const shortDate = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const monthName = new Intl.DateTimeFormat('en-IN', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A chart's x-axis label for a bucket starting on `date`. */
export function bucketLabel(date, bucket) {
  const instant = new Date(`${date}T00:00:00Z`);
  return bucket === 'month' ? monthName.format(instant) : shortDate.format(instant);
}

/** Whole rupees for chart axes: 1234500 paise -> 12345. Display only; amounts stay paise. */
export const axisRupees = (paise) => Math.trunc(paise / 100);

/** "₹12.3k", "₹4.5L" for chart axes. */
export function compactRupees(rupees) {
  if (rupees >= 100000) return `₹${Math.round(rupees / 10000) / 10}L`;
  if (rupees >= 1000) return `₹${Math.round(rupees / 100) / 10}k`;
  return `₹${rupees}`;
}

export const HOLD_REASON = {
  NO_BANK_ACCOUNT: 'Add your bank details to be paid',
  BANK_NOT_VERIFIED: 'Waiting for your bank details to be checked',
  SELLER_NOT_ACTIVE: 'Account not active',
  DISPUTE_OPEN: 'A dispute is still open',
};

export const ADMIN_HOLD_REASON = {
  NO_BANK_ACCOUNT: 'No bank details',
  BANK_NOT_VERIFIED: 'Bank details not checked',
  SELLER_NOT_ACTIVE: 'Seller not active',
  DISPUTE_OPEN: 'Dispute open',
};

export const PAYOUT_STATUS = {
  PENDING: { label: 'Being sent', tone: 'notice' },
  PAID: { label: 'Paid', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
};

export const BANK_STATUS = {
  PENDING: { label: 'Being checked', tone: 'notice' },
  VERIFIED: { label: 'Verified', tone: 'success' },
  REJECTED: { label: 'Needs fixing', tone: 'danger' },
};

export const USER_STATUS = {
  ACTIVE: { label: 'Active', tone: 'success' },
  SUSPENDED: { label: 'Suspended', tone: 'danger' },
  PENDING_DELETION: { label: 'Deletion requested', tone: 'notice' },
  DELETED: { label: 'Erased', tone: 'neutral' },
};

export const LISTING_STATUS = {
  ACTIVE: { label: 'Live', tone: 'success' },
  PAUSED: { label: 'Paused', tone: 'neutral' },
  UNDER_REVIEW: { label: 'Under review', tone: 'notice' },
  REMOVED: { label: 'Removed', tone: 'danger' },
};

/** "50%" from 0.5; "—" when there is nothing to divide by. */
export const percent = (rate) =>
  rate === null || rate === undefined ? '—' : `${Math.round(rate * 1000) / 10}%`;
