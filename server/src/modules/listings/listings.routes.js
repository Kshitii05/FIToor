import { Router } from 'express';
import { LISTING_IMAGE_MAX_BYTES, LISTING_IMAGES_MAX } from '../../config/policy.js';
import { requireVerified } from '../../lib/auth.js';
import { AppError } from '../../lib/errors.js';
import { uploadImages } from '../../lib/upload.js';
import {
  addListingImages,
  changeListingStatus,
  createListing,
  deleteListing,
  getListing,
  listOwnListings,
  listSellerListings,
  removeListingImage,
  reorderListingImages,
  updateListing,
} from './listings.service.js';
import {
  createListingSchema,
  listingIdParamsSchema,
  listingImageParamsSchema,
  myListingsQuerySchema,
  reorderImagesSchema,
  sellerIdParamsSchema,
  sellerListingsQuerySchema,
  updateListingSchemaFor,
} from './listings.validation.js';

const photos = uploadImages({
  fieldName: 'images',
  maxFiles: LISTING_IMAGES_MAX,
  maxBytes: LISTING_IMAGE_MAX_BYTES,
});

/** The listing details arrive as JSON in the `data` field, next to the photo files. */
function parseDataField(req) {
  if (typeof req.body?.data !== 'string') {
    throw AppError.badRequest('Send the listing details in a "data" field');
  }
  try {
    return JSON.parse(req.body.data);
  } catch {
    throw AppError.badRequest('The "data" field is not valid JSON');
  }
}

/**
 * `/listings`. Every change requires sign-in, and the service checks that the
 * listing belongs to the caller; creating one also requires a verified account.
 */
export function createListingsRouter(deps) {
  const { requireAuth, optionalAuth } = deps;
  const router = Router();

  router.post('/', requireAuth, requireVerified, photos, async (req, res) => {
    const input = createListingSchema.parse(parseDataField(req));
    const listing = await createListing(deps, req.auth.userId, input, req.files);
    res.status(201).json({ listing });
  });

  router.get('/:id', optionalAuth, async (req, res) => {
    const { id } = listingIdParamsSchema.parse(req.params);
    res.json({ listing: await getListing(deps, id, req.auth?.userId ?? null) });
  });

  router.patch('/:id', requireAuth, async (req, res) => {
    const { id } = listingIdParamsSchema.parse(req.params);
    const listing = await updateListing(deps, id, req.auth.userId, (mode) =>
      updateListingSchemaFor(mode).parse(req.body),
    );
    res.json({ listing });
  });

  router.post('/:id/pause', requireAuth, async (req, res) => {
    const { id } = listingIdParamsSchema.parse(req.params);
    res.json({ listing: await changeListingStatus(deps, id, req.auth.userId, 'PAUSE') });
  });

  router.post('/:id/activate', requireAuth, async (req, res) => {
    const { id } = listingIdParamsSchema.parse(req.params);
    res.json({ listing: await changeListingStatus(deps, id, req.auth.userId, 'ACTIVATE') });
  });

  router.delete('/:id', requireAuth, async (req, res) => {
    const { id } = listingIdParamsSchema.parse(req.params);
    await deleteListing(deps, id, req.auth.userId);
    res.status(204).end();
  });

  router.post('/:id/images', requireAuth, photos, async (req, res) => {
    const { id } = listingIdParamsSchema.parse(req.params);
    const listing = await addListingImages(deps, id, req.auth.userId, req.files);
    res.status(201).json({ listing });
  });

  router.put('/:id/images/order', requireAuth, async (req, res) => {
    const { id } = listingIdParamsSchema.parse(req.params);
    const { imageIds } = reorderImagesSchema.parse(req.body);
    res.json({ listing: await reorderListingImages(deps, id, req.auth.userId, imageIds) });
  });

  router.delete('/:id/images/:imageId', requireAuth, async (req, res) => {
    const { id, imageId } = listingImageParamsSchema.parse(req.params);
    res.json({ listing: await removeListingImage(deps, id, req.auth.userId, imageId) });
  });

  return router;
}

/** `/me/listings`: the signed-in seller's own listings, in every state. */
export function createMyListingsRouter(deps) {
  const router = Router();

  router.get('/', deps.requireAuth, async (req, res) => {
    const query = myListingsQuerySchema.parse(req.query);
    res.json(await listOwnListings(deps, req.auth.userId, query));
  });

  return router;
}

/** `/users/:id/listings`: a seller's active listings, for their public profile. */
export function createSellerListingsRouter(deps) {
  const router = Router();

  router.get('/:id/listings', deps.optionalAuth, async (req, res) => {
    const { id } = sellerIdParamsSchema.parse(req.params);
    const query = sellerListingsQuerySchema.parse(req.query);
    res.json(await listSellerListings(deps, id, query, req.auth?.userId ?? null));
  });

  return router;
}
