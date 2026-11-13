import { Router } from 'express';
import { listingIdParamsSchema } from '../listings/listings.validation.js';
import { likeListing, unlikeListing } from './activity.service.js';
import {
  likedListingsQuerySchema,
  searchQuerySchema,
  suggestionsQuerySchema,
} from './discovery.validation.js';
import { homeSections, listLikedListings } from './home.service.js';
import { clearSearchHistory, searchListings, suggest } from './search.service.js';

const viewer = (req) => req.auth?.userId ?? null;

/** `/listings`: search and browse (public), and liking a listing (signed in). */
export function createBrowseRouter(deps) {
  const { requireAuth, optionalAuth } = deps;
  const router = Router();

  router.get('/', optionalAuth, async (req, res) => {
    const query = searchQuerySchema.parse(req.query);
    res.json(await searchListings(deps, query, viewer(req)));
  });

  router.put('/:id/like', requireAuth, async (req, res) => {
    const { id } = listingIdParamsSchema.parse(req.params);
    res.json(await likeListing(deps, { userId: req.auth.userId, listingId: id }));
  });

  router.delete('/:id/like', requireAuth, async (req, res) => {
    const { id } = listingIdParamsSchema.parse(req.params);
    res.json(await unlikeListing(deps, { userId: req.auth.userId, listingId: id }));
  });

  return router;
}

/** `/search`: autocomplete. */
export function createSearchRouter(deps) {
  const router = Router();

  router.get('/suggestions', deps.optionalAuth, async (req, res) => {
    const { q } = suggestionsQuerySchema.parse(req.query);
    res.json(await suggest(deps, q, viewer(req)));
  });

  return router;
}

/** `/home`: the home page sections. */
export function createHomeRouter(deps) {
  const router = Router();

  router.get('/', deps.optionalAuth, async (req, res) => {
    res.json(await homeSections(deps, viewer(req)));
  });

  return router;
}

/** `/me`: the signed-in user's own likes and search history. */
export function createMyDiscoveryRouter(deps) {
  const { requireAuth } = deps;
  const router = Router();

  router.get('/likes', requireAuth, async (req, res) => {
    const query = likedListingsQuerySchema.parse(req.query);
    res.json(await listLikedListings(deps, req.auth.userId, query));
  });

  router.delete('/search-history', requireAuth, async (req, res) => {
    await clearSearchHistory(deps, req.auth.userId);
    res.status(204).end();
  });

  return router;
}
