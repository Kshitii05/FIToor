const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'long', timeStyle: 'short' });
const monthYear = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });

export function formatDateTime(iso) {
  return dateTime.format(new Date(iso));
}

export function formatMonthYear(iso) {
  return monthYear.format(new Date(iso));
}
