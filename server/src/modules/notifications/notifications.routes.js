import { Router } from 'express';
import { z } from 'zod';
import { NOTIFICATIONS_PAGE_SIZE_MAX } from '../../config/policy.js';
import { paginationQuery } from '../../lib/pagination.js';
import {
  CATEGORIES,
  getPreferences,
  listNotifications,
  markAllRead,
  markRead,
  setPreferences,
  unreadCount,
} from './notifications.service.js';

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({
  ...paginationQuery,
  pageSize: z.coerce.number().int().min(1).max(NOTIFICATIONS_PAGE_SIZE_MAX).default(20),
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
const preferencesSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        category: z.enum(CATEGORIES),
        inApp: z.boolean(),
        email: z.boolean(),
      }),
    )
    .min(1)
    .max(CATEGORIES.length),
});

/** `/notifications`: the signed-in person's notification centre. */
export function createNotificationsRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth);

  router.get('/', async (req, res) => {
    res.json(await listNotifications(deps, req.auth.userId, listQuery.parse(req.query)));
  });
  router.get('/unread-count', async (req, res) => {
    res.json({ count: await unreadCount(deps, req.auth.userId) });
  });
  router.post('/read-all', async (req, res) => {
    await markAllRead(deps, req.auth.userId);
    res.json({ count: 0 });
  });
  router.post('/:id/read', async (req, res) => {
    const { id } = idParams.parse(req.params);
    res.json({ notification: await markRead(deps, req.auth.userId, id) });
  });

  return router;
}

/** `/me/notification-preferences`: which optional notifications to get, and how. */
export function createNotificationPreferencesRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth);
  router.get('/', async (req, res) => {
    res.json({ items: await getPreferences(deps, req.auth.userId) });
  });
  router.put('/', async (req, res) => {
    const { items } = preferencesSchema.parse(req.body ?? {});
    res.json({ items: await setPreferences(deps, req.auth.userId, items) });
  });
  return router;
}
