import { Router } from 'express';
import { z } from 'zod';
import {
  LISTING_AMOUNT_MAX_PAISE,
  LISTING_IMAGE_MAX_BYTES,
  LISTING_QUANTITY_MAX,
  MESSAGE_MAX_LENGTH,
  MESSAGE_PHOTOS_MAX,
  MESSAGES_PAGE_SIZE_MAX,
} from '../../config/policy.js';
import { requireVerified } from '../../lib/auth.js';
import { AppError } from '../../lib/errors.js';
import { paginationQuery } from '../../lib/pagination.js';
import { uploadImages } from '../../lib/upload.js';
import {
  blockUser,
  conversationView,
  listBlocks,
  listConversations,
  listMessages,
  loadOwnConversation,
  markReceipt,
  sendMessage,
  startConversation,
  unblockUser,
} from './messaging.service.js';
import {
  acceptOffer,
  counterOffer,
  makeOffer,
  offersOnListing,
  rejectOffer,
  withdrawOffer,
} from './offers.service.js';

const idParams = z.object({ id: z.uuid() });
const userParams = z.object({ userId: z.uuid() });
const startSchema = z
  .strictObject({
    listingId: z.uuid().optional(),
    orderId: z.uuid().optional(),
    bookingId: z.uuid().optional(),
  })
  .refine((v) => [v.listingId, v.orderId, v.bookingId].filter(Boolean).length === 1, {
    message: 'Say which listing, order or rental this is about',
  });
const messageSchema = z.strictObject({
  body: z.string().max(MESSAGE_MAX_LENGTH, `At most ${MESSAGE_MAX_LENGTH} characters`).optional(),
  listingId: z.uuid().optional(),
});
const pageQuery = z.object({
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MESSAGES_PAGE_SIZE_MAX).optional(),
});
const receiptSchema = z.strictObject({ upTo: z.number().int().min(0) });
const price = z.number().int().min(1).max(LISTING_AMOUNT_MAX_PAISE);
const offerSchema = z.strictObject({
  listingId: z.uuid(),
  quantity: z.number().int().min(1).max(LISTING_QUANTITY_MAX).default(1),
  unitPricePaise: price,
});
const counterSchema = z.strictObject({
  unitPricePaise: price,
  quantity: z.number().int().min(1).max(LISTING_QUANTITY_MAX).optional(),
});
const offersQuery = z.object({ listingId: z.uuid() });
const blockSchema = z.strictObject({ userId: z.uuid() });

const photos = uploadImages({
  fieldName: 'photos',
  maxFiles: MESSAGE_PHOTOS_MAX,
  maxBytes: LISTING_IMAGE_MAX_BYTES,
});

/** JSON, or multipart with the details as JSON in `data` and photos in `photos`. */
function messageInput(req) {
  if (!req.is('multipart/form-data')) return messageSchema.parse(req.body ?? {});
  try {
    return messageSchema.parse(JSON.parse(req.body?.data || '{}'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw AppError.badRequest('Send the details as JSON in a "data" field');
    }
    throw error;
  }
}

/** `/conversations`: chats between two people. */
export function createConversationsRouter(deps) {
  const { db, limiters } = deps;
  const router = Router();
  router.use(deps.requireAuth);
  const mine = (req) => loadOwnConversation(db, idParams.parse(req.params).id, req.auth.userId);

  router.get('/', async (req, res) => {
    const query = z.object(paginationQuery).parse(req.query);
    res.json(await listConversations(deps, req.auth.userId, query));
  });
  router.post(
    '/',
    limiters.conversation,
    limiters.conversationPerUser,
    requireVerified,
    async (req, res) => {
      const about = startSchema.parse(req.body ?? {});
      res.json({ conversation: await startConversation(deps, req.auth.userId, about) });
    },
  );
  router.get('/:id', async (req, res) => {
    res.json({ conversation: await conversationView(db, await mine(req), req.auth.userId) });
  });
  router.get('/:id/messages', async (req, res) => {
    const conversation = await mine(req);
    res.json(await listMessages(deps, req.auth.userId, conversation, pageQuery.parse(req.query)));
  });
  router.post(
    '/:id/messages',
    limiters.message,
    limiters.messagePerUser,
    requireVerified,
    photos,
    async (req, res) => {
      const conversation = await mine(req);
      const input = messageInput(req);
      res.status(201).json({
        message: await sendMessage(deps, req.auth.userId, conversation, input, req.files),
      });
    },
  );
  for (const kind of ['delivered', 'read']) {
    router.post(`/:id/${kind}`, async (req, res) => {
      const conversation = await mine(req);
      const { upTo } = receiptSchema.parse(req.body ?? {});
      await markReceipt(deps, req.auth.userId, conversation, kind, upTo);
      res.json({ conversation: await conversationView(db, conversation, req.auth.userId) });
    });
  }

  return router;
}

/** `/offers`: price offers on sale listings. */
export function createOffersRouter(deps) {
  const { limiters } = deps;
  const router = Router();
  router.use(deps.requireAuth);
  const id = (req) => idParams.parse(req.params).id;

  router.get('/', async (req, res) => {
    const { listingId } = offersQuery.parse(req.query);
    res.json(await offersOnListing(deps, req.auth.userId, listingId));
  });
  router.post('/', limiters.offer, limiters.offerPerUser, requireVerified, async (req, res) => {
    const input = offerSchema.parse(req.body ?? {});
    res.status(201).json(await makeOffer(deps, req.auth.userId, input));
  });
  router.post('/:id/accept', requireVerified, async (req, res) => {
    res.json({ offer: await acceptOffer(deps, req.auth.userId, id(req)) });
  });
  router.post('/:id/reject', async (req, res) => {
    res.json({ offer: await rejectOffer(deps, req.auth.userId, id(req)) });
  });
  router.post(
    '/:id/counter',
    limiters.offer,
    limiters.offerPerUser,
    requireVerified,
    async (req, res) => {
      const input = counterSchema.parse(req.body ?? {});
      res.status(201).json({ offer: await counterOffer(deps, req.auth.userId, id(req), input) });
    },
  );
  router.post('/:id/withdraw', async (req, res) => {
    res.json({ offer: await withdrawOffer(deps, req.auth.userId, id(req)) });
  });

  return router;
}

/** `/blocks`: people the signed-in person has blocked. */
export function createBlocksRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth);

  router.get('/', async (req, res) => {
    res.json({ items: await listBlocks(deps, req.auth.userId) });
  });
  router.post('/', deps.limiters.block, deps.limiters.blockPerUser, async (req, res) => {
    const { userId } = blockSchema.parse(req.body ?? {});
    await blockUser(deps, req.auth.userId, userId);
    res.status(201).json({ items: await listBlocks(deps, req.auth.userId) });
  });
  router.delete('/:userId', async (req, res) => {
    await unblockUser(deps, req.auth.userId, userParams.parse(req.params).userId);
    res.status(204).end();
  });

  return router;
}
