// Labels for notifications.

export const CATEGORY = {
  ORDERS: {
    label: 'Orders',
    description: 'Purchases and sales: placed, sent, delivered, deadlines.',
  },
  RENTALS: {
    label: 'Rentals',
    description: 'Requests, bookings, return reminders, inspection, deposit.',
  },
  PAYMENTS: { label: 'Payments', description: 'Refunds and deposits coming back.' },
  DISPUTES: {
    label: 'Disputes',
    description: 'Problems reported, answers, decisions and appeals.',
  },
  MESSAGES: {
    label: 'Messages',
    description: 'New chat messages (at most one per chat every 30 minutes).',
  },
  OFFERS: { label: 'Offers', description: 'Offers on your items, counter-offers and answers.' },
  REVIEWS: {
    label: 'Reviews',
    description: 'Reminders that you can review a completed order or rental.',
  },
};

const minute = 60 * 1000;
const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

/** "just now", "5 min ago", "3 h ago", or the date. */
export function ago(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < minute) return 'just now';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} min ago`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} h ago`;
  return dateFormat.format(new Date(iso));
}
