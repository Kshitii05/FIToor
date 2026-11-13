// Names for order states, as buyers and sellers see them. The server decides what
// may happen next and sends it as `actions`; the pages only show those.

const STATUS = {
  AWAITING_DISPATCH: { buyer: 'Waiting to be sent', seller: 'To send', tone: 'notice' },
  AWAITING_PICKUP: { buyer: 'Ready for pickup', seller: 'Waiting for pickup', tone: 'notice' },
  DISPATCHED: { buyer: 'On its way', seller: 'Sent', tone: 'neutral' },
  DELIVERY_REPORTED: {
    buyer: 'Delivered? Please confirm',
    seller: 'Waiting for buyer to confirm',
    tone: 'notice',
  },
  ADMIN_REVIEW: { buyer: 'Being reviewed', seller: 'Being reviewed', tone: 'notice' },
  DELIVERED: { buyer: 'Received', seller: 'Received by buyer', tone: 'success' },
  ISSUE_OPEN: { buyer: 'Problem reported', seller: 'Problem reported', tone: 'danger' },
  COMPLETED: { buyer: 'Completed', seller: 'Completed', tone: 'success' },
  CANCELLED: { buyer: 'Cancelled', seller: 'Cancelled', tone: 'neutral' },
  REFUNDED: { buyer: 'Refunded', seller: 'Refunded', tone: 'neutral' },
};

export function orderStatus(status, side) {
  const info = STATUS[status] ?? { buyer: status, seller: status, tone: 'neutral' };
  return { label: info[side], tone: info.tone };
}

export const ORDER_FILTERS = [
  { value: '', label: 'All' },
  { value: 'AWAITING_DISPATCH', label: 'To send' },
  { value: 'AWAITING_PICKUP', label: 'Pickup' },
  { value: 'DELIVERY_REPORTED', label: 'To confirm' },
  { value: 'ISSUE_OPEN', label: 'Problems' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const ISSUE_KINDS = [
  { value: 'WRONG_ITEM', label: 'I got the wrong item' },
  { value: 'DAMAGED', label: 'It arrived damaged' },
  { value: 'NOT_AS_DESCRIBED', label: 'It is not as described' },
];

const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
export const when = (iso) => (iso ? dateTime.format(new Date(iso)) : null);

/** An address as lines of text, for display. */
export function addressLines(address) {
  return [
    address.recipientName,
    [address.line1, address.line2].filter(Boolean).join(', '),
    `${address.locality}, ${address.city}, ${address.state} ${address.pincode}`,
    address.phone,
  ];
}
