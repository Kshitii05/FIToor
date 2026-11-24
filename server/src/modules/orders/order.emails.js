import { APP_NAME } from '../../config/app.js';
import { BUSINESS_TIME_ZONE } from '../../config/policy.js';
import { deliver, plainTitle } from '../notifications/notifications.service.js';
import { formatPaise } from './order.format.js';

// Order notifications: shown in the app and emailed (Step 9). Each is keyed by the
// order, the event and the recipient, so it is sent once however often it is called.

const when = new Intl.DateTimeFormat('en-IN', {
  timeZone: BUSINESS_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});
const at = (date) => `${when.format(date)} (India time)`;

const messages = {
  orderPlacedBuyer: (o) => ({
    subject: `${APP_NAME}: order ${o.ref} is confirmed`,
    text: `Thank you. You paid ${formatPaise(o.totalPaise)} for order ${o.ref}. ${
      o.fulfilment === 'PICKUP'
        ? 'Show your handover code to the seller when you collect the item.'
        : `The seller has until ${at(o.dispatchDueAt)} to send it.`
    }`,
  }),
  orderPlacedSeller: (o) => ({
    subject: `${APP_NAME}: new order ${o.ref}`,
    text: `You have a new order (${o.ref}) worth ${formatPaise(o.itemsSubtotalPaise)} in items. ${
      o.fulfilment === 'PICKUP'
        ? 'The buyer will collect it; ask for their handover code.'
        : `Please send it by ${at(o.dispatchDueAt)}.`
    }`,
  }),
  dispatchReminderSeller: (o) => ({
    subject: `${APP_NAME}: send order ${o.ref} by ${at(o.dispatchDueAt)}`,
    text: `Order ${o.ref} must be sent by ${at(o.dispatchDueAt)}. If you need more time, ask the buyer for an extension.`,
  }),
  dispatchOverdueBuyer: (o) => ({
    subject: `${APP_NAME}: order ${o.ref} has not been sent yet`,
    text: `The seller did not send order ${o.ref} in time. You can cancel it for a full refund, or keep waiting.`,
  }),
  dispatchOverdueSeller: (o) => ({
    subject: `${APP_NAME}: order ${o.ref} is late`,
    text: `Order ${o.ref} was due to be sent by ${at(o.dispatchDueAt)}. The buyer can now cancel it for a full refund.`,
  }),
  extensionRequestedBuyer: (o) => ({
    subject: `${APP_NAME}: the seller asks for more time on ${o.ref}`,
    text: `The seller asks to send order ${o.ref} by ${at(o.extensionUntil)}. Accept or decline it in your orders.`,
  }),
  dispatchedBuyer: (o) => ({
    subject: `${APP_NAME}: order ${o.ref} is on its way`,
    text: `The seller has sent order ${o.ref}.${o.courierReference ? ` Tracking reference: ${o.courierReference}.` : ''}`,
  }),
  deliveryReportedBuyer: (o) => ({
    subject: `${APP_NAME}: did you receive order ${o.ref}?`,
    text: `The seller says order ${o.ref} was delivered. Please confirm, or tell us it did not arrive, by ${at(o.receiptDueAt)}.`,
  }),
  sentToReview: (o) => ({
    subject: `${APP_NAME}: order ${o.ref} is being reviewed`,
    text: `Delivery of order ${o.ref} was not confirmed, so our team will review it. We will be in touch.`,
  }),
  deliveredSeller: (o) => ({
    subject: `${APP_NAME}: order ${o.ref} was received`,
    text: `Order ${o.ref} has been received. The buyer can report a problem until ${at(o.issueWindowEndsAt)}; after that it is complete.`,
  }),
  issueOpenedSeller: (o) => ({
    subject: `${APP_NAME}: a problem was reported with ${o.ref}`,
    text: `The buyer reported a problem with order ${o.ref}. Our team will review it; payment for this order is on hold until then.`,
  }),
  cancelled: (o) => ({
    subject: `${APP_NAME}: order ${o.ref} was cancelled`,
    text: `Order ${o.ref} was cancelled. Any amount paid is being refunded to the original payment method.`,
  }),
  refunded: (o, amountPaise) => ({
    subject: `${APP_NAME}: refund for ${o.ref}`,
    text: `A refund of ${formatPaise(amountPaise)} for order ${o.ref} has been sent to your original payment method. It may take a few days to show.`,
  }),
  completedSeller: (o) => ({
    subject: `${APP_NAME}: order ${o.ref} is complete`,
    text: `Order ${o.ref} is complete and will be included in your next payout.`,
  }),
};

const LINKS = { buyer: (o) => `/orders/${o.id}`, seller: (o) => `/sales/${o.id}` };

/**
 * Notifies the order's buyer or seller of one of the events above. A refund passes
 * its id after the amount, so each refund is its own notification.
 */
export async function notify(deps, order, recipient, kind, ...args) {
  const { subject, text } = messages[kind](order, ...args);
  const refundId = kind === 'refunded' ? args[1] : null;
  await deliver(deps, {
    userId: recipient === 'buyer' ? order.buyerId : order.sellerId,
    key: `order:${order.id}:${kind}:${recipient}${refundId ? `:${refundId}` : ''}`,
    category: kind === 'refunded' ? 'PAYMENTS' : 'ORDERS',
    type: kind,
    title: plainTitle(subject),
    body: text,
    link: LINKS[recipient](order),
    email: { subject, text },
  });
}
