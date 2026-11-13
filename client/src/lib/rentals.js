// Names for booking states as renters and owners see them, and date helpers.
// The server decides what may happen next and sends it as `actions`.

const STATUS = {
  REQUESTED: { renter: 'Waiting for the owner', owner: 'New request', tone: 'notice' },
  APPROVED: { renter: 'Approved: please pay', owner: 'Waiting for payment', tone: 'notice' },
  CONFIRMED: { renter: 'Booked', owner: 'Booked: hand it over', tone: 'success' },
  ACTIVE: { renter: 'With you', owner: 'With the renter', tone: 'neutral' },
  RETURNED: { renter: 'Returned: being checked', owner: 'Returned: check it', tone: 'notice' },
  CLAIM_OPEN: { renter: 'Damage reported', owner: 'Claim sent', tone: 'danger' },
  ADMIN_REVIEW: { renter: 'Being reviewed', owner: 'Being reviewed', tone: 'notice' },
  SETTLING: { renter: 'Deposit on its way', owner: 'Settling deposit', tone: 'neutral' },
  COMPLETED: { renter: 'Completed', owner: 'Completed', tone: 'success' },
  DECLINED: { renter: 'Declined', owner: 'Declined', tone: 'neutral' },
  EXPIRED: { renter: 'Expired', owner: 'Expired', tone: 'neutral' },
  CANCELLED: { renter: 'Cancelled', owner: 'Cancelled', tone: 'neutral' },
};

export function bookingStatus(status, side) {
  const info = STATUS[status] ?? { renter: status, owner: status, tone: 'neutral' };
  return { label: info[side], tone: info.tone };
}

export const BOOKING_FILTERS = [
  { value: '', label: 'All' },
  { value: 'REQUESTED', label: 'Requests' },
  { value: 'APPROVED', label: 'To pay' },
  { value: 'CONFIRMED', label: 'Booked' },
  { value: 'ACTIVE', label: 'Out now' },
  { value: 'RETURNED', label: 'Returned' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/** Actions that mean the person should do something now. */
export const ATTENTION = {
  renter: ['pay', 'return', 'claim-response'],
  owner: ['approve', 'handover', 'inspection-ok'],
};

// Dates are calendar days written YYYY-MM-DD; arithmetic is done in UTC so no time
// zone can shift them.
const toUtc = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const addDays = (date, days) =>
  new Date(toUtc(date) + days * 86400000).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((toUtc(to) - toUtc(from)) / 86400000);
export const overlaps = (a, b) => a.startDate <= b.endDate && b.startDate <= a.endDate;

const dayFormat = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const longDay = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
export const dayLabel = (date) => dayFormat.format(new Date(toUtc(date)));
export const longDayLabel = (date) => longDay.format(new Date(toUtc(date)));
export const rangeLabel = (start, end) =>
  start === end ? dayLabel(start) : `${dayLabel(start)} – ${dayLabel(end)}`;

export const CLAIM_PHOTOS_MAX = 8;
export const CONDITION_PHOTOS_MIN = 2;

/** Sends `data` as JSON with photos, the way the server reads uploads. */
export function photoForm(data, files) {
  const body = new FormData();
  body.append('data', JSON.stringify(data));
  files.forEach((file) => body.append('photos', file));
  return body;
}
