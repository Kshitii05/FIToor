// Labels and small helpers for chat and offers. The server decides what is allowed;
// these only choose what to show.

export const OFFER_STATUS = {
  OPEN: { label: 'Waiting for an answer', tone: 'notice' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Declined', tone: 'neutral' },
  COUNTERED: { label: 'Countered', tone: 'neutral' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  USED: { label: 'Bought', tone: 'success' },
};

/** What the viewer may do with an offer, mirroring the server's rules. */
export function offerActions(offer, me, now = Date.now()) {
  const open = offer.status === 'OPEN' && new Date(offer.expiresAt).getTime() > now;
  if (open && offer.madeById !== me) return ['accept', 'reject', 'counter'];
  if (open && offer.madeById === me) return ['withdraw'];
  if (
    offer.status === 'ACCEPTED' &&
    offer.buyerId === me &&
    new Date(offer.useBy).getTime() > now
  ) {
    return ['buy'];
  }
  return [];
}

const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });
const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

/** "4:05 pm" today, "12 Nov" before that. */
export function messageTime(iso) {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString() ? time.format(date) : day.format(date);
}

export const fullTime = (iso) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/** Adds or replaces messages by id and keeps them in order. */
export function mergeMessages(current, incoming) {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** Puts an updated offer into every message that shows it. */
export const withOffer = (messages, offer) =>
  messages.map((m) => (m.offer?.id === offer.id ? { ...m, offer: { ...m.offer, ...offer } } : m));

export const MESSAGE_MAX_LENGTH = 2000;
export const MESSAGE_PHOTOS_MAX = 4;
