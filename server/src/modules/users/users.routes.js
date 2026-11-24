import { Router } from 'express';
import { clearRefreshCookie } from '../auth/session.service.js';
import { requestDeletion } from './deletion.service.js';
import { getOwnAccount, getPublicProfile, updateOwnProfile } from './users.service.js';
import {
  requestDeletionSchema,
  updateProfileSchema,
  userIdParamsSchema,
} from './users.validation.js';

/** `/me`: the signed-in user's own account. Every route acts only on `req.auth.userId`. */
export function createMeRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth);

  router.get('/', async (req, res) => {
    res.json({ user: await getOwnAccount(deps, req.auth.userId) });
  });

  router.patch('/profile', async (req, res) => {
    const changes = updateProfileSchema.parse(req.body);
    res.json({ user: await updateOwnProfile(deps, req.auth.userId, changes) });
  });

  router.post('/deletion', async (req, res) => {
    const { password } = requestDeletionSchema.parse(req.body);
    const result = await requestDeletion(deps, { userId: req.auth.userId, password });
    clearRefreshCookie(res);
    res.json(result);
  });

  return router;
}

/** `/users`: what anyone may see about another user. */
export function createUsersRouter(deps) {
  const router = Router();

  router.get('/:id', async (req, res) => {
    const { id } = userIdParamsSchema.parse(req.params);
    res.json({ user: await getPublicProfile(deps, id) });
  });

  return router;
}
