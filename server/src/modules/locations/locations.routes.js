import { Router } from 'express';
import {
  addSavedLocation,
  listSavedLocations,
  removeSavedLocation,
  updateSavedLocation,
} from './locations.service.js';
import {
  placeSearchQuerySchema,
  reverseQuerySchema,
  savedLocationParamsSchema,
  savedLocationSchema,
  updateSavedLocationSchema,
} from './locations.validation.js';

/** `/me/locations`: the signed-in person's saved places. Only ever their own. */
export function createSavedLocationsRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth);

  router.get('/', async (req, res) => {
    res.json({ items: await listSavedLocations(deps, req.auth.userId) });
  });

  router.post('/', async (req, res) => {
    const input = savedLocationSchema.parse(req.body);
    res.status(201).json({ location: await addSavedLocation(deps, req.auth.userId, input) });
  });

  router.patch('/:id', async (req, res) => {
    const { id } = savedLocationParamsSchema.parse(req.params);
    const changes = updateSavedLocationSchema.parse(req.body);
    res.json({ location: await updateSavedLocation(deps, req.auth.userId, id, changes) });
  });

  router.delete('/:id', async (req, res) => {
    const { id } = savedLocationParamsSchema.parse(req.params);
    await removeSavedLocation(deps, req.auth.userId, id);
    res.status(204).end();
  });

  return router;
}

/** `/places`: place names and PIN codes to map points, and back. Rate limited. */
export function createPlacesRouter(deps) {
  const { limiters, placeLookup } = deps;
  const router = Router();

  router.get('/search', limiters.places, async (req, res) => {
    const { q } = placeSearchQuerySchema.parse(req.query);
    res.json({ items: await placeLookup.search(q) });
  });

  router.get('/reverse', limiters.places, async (req, res) => {
    const point = reverseQuerySchema.parse(req.query);
    res.json({ place: await placeLookup.reverse(point) });
  });

  return router;
}
