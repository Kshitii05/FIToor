import { APP_NAME } from '../../config/app.js';
import {
  NOTIFICATION_RETENTION_DAYS,
  REVIEW_REMINDER_DELAY_HOURS,
  REVIEW_WINDOW_DAYS,
} from '../../config/policy.js';
import { addDays, addHours } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { paged, pageWindow } from '../../lib/pagination.js';

// Notifications (SPEC Module 9; I91 to I99). Every notification goes through
// `deliver`: it is saved first, under a key that names the event, then shown live
// and emailed. The key is unique in the database and is the email job's id, so a
// retried job or a second run can never notify twice (I92). Orders, rentals,
// payments and disputes are critical and always sent (I94); messages, offers and
// reviews follow the person's settings (I95).

export const CRITICAL = ['ORDERS', 'RENTALS', 'PAYMENTS', 'DISPUTES'];
export const OPTIONAL = ['MESSAGES', 'OFFERS', 'REVIEWS'];
export const CATEGORIES = [...CRITICAL, ...OPTIONAL];

/** "FIToor: order ORD-1 is on its way" becomes "Order ORD-1 is on its way". */
export function plainTitle(subject) {
  const text = subject.startsWith(`${APP_NAME}: `) ? subject.slice(APP_NAME.length + 2) : subject;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function toNotification(row) {
  return {
    id: row.id,
    category: row.category,
    type: row.type,
    critical: row.critical,
    title: row.title,
    body: row.body,
    link: row.link,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

const visible = (userId) => ({ userId, inApp: true });

export const unreadCount = ({ db }, userId) =>
  db.notification.count({ where: { ...visible(userId), readAt: null } });

/** One person's setting for one category: critical ones are always on. */
async function channelsFor(db, userId, category) {
  if (CRITICAL.includes(category)) return { inApp: true, email: true };
  const row = await db.notificationPreference.findUnique({
    where: { userId_category: { userId, category } },
  });
  return { inApp: row?.inApp ?? true, email: row?.email ?? true };
}

/** BullMQ job ids may not contain ":". The notification id is unique per key. */
const emailJobId = (notification) => `notification-${notification.id}`;

/**
 * Saves, shows and emails one notification. Sending the same `key` again changes
 * nothing. A failure is logged and never undoes the change that caused it.
 * `email` ({ subject, text }) overrides the email built from title and body.
 */
export async function deliver(deps, input) {
  const { db, clock, realtime, emailQueue, logger } = deps;
  const { userId, key, category, type, title, body, link, data, email } = input;
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true, status: true },
    });
    if (!user || user.status === 'DELETED') return null;
    const channels = await channelsFor(db, userId, category);
    if (!channels.inApp && !channels.email) return null;

    const now = clock.now();
    const { count } = await db.notification.createMany({
      data: [
        {
          key,
          userId,
          category,
          type,
          critical: CRITICAL.includes(category),
          inApp: channels.inApp,
          title,
          body,
          link: link ?? null,
          data: data ?? undefined,
          createdAt: now,
        },
      ],
      skipDuplicates: true,
    });
    if (count !== 1) return null; // this event was notified before
    const row = await db.notification.findUniqueOrThrow({ where: { key } });

    if (channels.inApp) {
      realtime.toUsers([userId], 'notification:new', {
        notification: toNotification(row),
        unreadCount: await unreadCount(deps, userId),
      });
    }
    if (channels.email) {
      await emailQueue.add({
        jobId: emailJobId(row),
        to: user.email,
        subject: email?.subject ?? `${APP_NAME}: ${title}`,
        text: email?.text ?? body,
      });
      await db.notification.update({ where: { id: row.id }, data: { emailedAt: now } });
    }
    return row;
  } catch (error) {
    logger.error(error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The notification centre
// ---------------------------------------------------------------------------

export async function listNotifications({ db }, userId, query) {
  const where = { ...visible(userId), ...(query.unread ? { readAt: null } : {}) };
  const [rows, total, unread] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageWindow(query),
    }),
    db.notification.count({ where }),
    db.notification.count({ where: { ...visible(userId), readAt: null } }),
  ]);
  return { ...paged(rows.map(toNotification), total, query), unreadCount: unread };
}

export async function markRead({ db, clock }, userId, id) {
  const row = await db.notification.findFirst({ where: { id, ...visible(userId) } });
  if (!row) throw AppError.notFound('Notification not found');
  if (!row.readAt) {
    await db.notification.updateMany({
      where: { id, readAt: null },
      data: { readAt: clock.now() },
    });
  }
  return toNotification(await db.notification.findUniqueOrThrow({ where: { id } }));
}

export async function markAllRead({ db, clock }, userId) {
  const { count } = await db.notification.updateMany({
    where: { ...visible(userId), readAt: null },
    data: { readAt: clock.now() },
  });
  return count;
}

// ---------------------------------------------------------------------------
// Settings (I94, I95)
// ---------------------------------------------------------------------------

export async function getPreferences({ db }, userId) {
  const rows = await db.notificationPreference.findMany({ where: { userId } });
  return CATEGORIES.map((category) => {
    const critical = CRITICAL.includes(category);
    const row = rows.find((r) => r.category === category);
    return {
      category,
      critical,
      inApp: critical ? true : (row?.inApp ?? true),
      email: critical ? true : (row?.email ?? true),
    };
  });
}

export async function setPreferences(deps, userId, items) {
  const critical = items.find((item) => CRITICAL.includes(item.category));
  if (critical) {
    throw new AppError(
      400,
      'CRITICAL_NOTIFICATIONS',
      'Order, rental, payment and dispute notifications cannot be turned off',
    );
  }
  await deps.db.$transaction(
    items.map(({ category, inApp, email }) =>
      deps.db.notificationPreference.upsert({
        where: { userId_category: { userId, category } },
        create: { userId, category, inApp, email },
        update: { inApp, email },
      }),
    ),
  );
  return getPreferences(deps, userId);
}

// ---------------------------------------------------------------------------
// Jobs, run every minute
// ---------------------------------------------------------------------------

const person = { select: { id: true, profile: { select: { displayName: true } } } };

/** A day after completion, both sides are reminded they can review, once (key). */
async function remindReviews(deps, now) {
  const { db } = deps;
  const window = {
    status: 'COMPLETED',
    completedAt: {
      lte: addHours(now, -REVIEW_REMINDER_DELAY_HOURS),
      gt: addDays(now, -REVIEW_WINDOW_DAYS),
    },
  };
  const [orders, bookings] = await Promise.all([
    db.order.findMany({
      where: window,
      include: { reviews: { select: { authorId: true } }, buyer: person, seller: person },
    }),
    db.rentalBooking.findMany({
      where: window,
      include: { reviews: { select: { authorId: true } }, renter: person, owner: person },
    }),
  ]);
  let sent = 0;
  const remind = async (subjectKey, link, author, other) => {
    const row = await deliver(deps, {
      userId: author.id,
      key: `review:${subjectKey}:${author.id}`,
      category: 'REVIEWS',
      type: 'reviewReminder',
      title: `How was it with ${other.profile.displayName}?`,
      body: `You can review ${other.profile.displayName} for ${REVIEW_WINDOW_DAYS} days after completion. Reviews help others trade with confidence.`,
      link,
    });
    if (row) sent += 1;
  };
  for (const order of orders) {
    const done = new Set(order.reviews.map((r) => r.authorId));
    if (!done.has(order.buyerId))
      await remind(`order:${order.id}`, `/orders/${order.id}`, order.buyer, order.seller);
    if (!done.has(order.sellerId))
      await remind(`order:${order.id}`, `/sales/${order.id}`, order.seller, order.buyer);
  }
  for (const booking of bookings) {
    const done = new Set(booking.reviews.map((r) => r.authorId));
    if (!done.has(booking.renterId))
      await remind(
        `booking:${booking.id}`,
        `/rentals/${booking.id}`,
        booking.renter,
        booking.owner,
      );
    if (!done.has(booking.ownerId))
      await remind(
        `booking:${booking.id}`,
        `/rented-out/${booking.id}`,
        booking.owner,
        booking.renter,
      );
  }
  return sent;
}

export async function runNotificationJobs(deps) {
  const now = deps.clock.now();
  const reviewReminders = await remindReviews(deps, now);
  // Read notifications are kept 90 days (I98); unread ones stay until read.
  const { count: deleted } = await deps.db.notification.deleteMany({
    where: { readAt: { lte: addDays(now, -NOTIFICATION_RETENTION_DAYS) } },
  });
  return { reviewReminders, deleted };
}
