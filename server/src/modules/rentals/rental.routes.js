import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import {
  CLAIM_DESCRIPTION_MIN_LENGTH,
  CLAIM_ITEMS_MAX,
  HANDOVER_CODE_LENGTH,
  ISSUE_DESCRIPTION_MAX_LENGTH,
  LISTING_AMOUNT_MAX_PAISE,
  LISTING_IMAGE_MAX_BYTES,
  RENTAL_CONDITION_PHOTOS_MAX,
  RENTAL_PACKAGE_MAX_DAYS,
  REASON_MAX_LENGTH,
} from '../../config/policy.js';
import { requireAdmin, requireVerified } from '../../lib/auth.js';
import { AppError } from '../../lib/errors.js';
import { paginationQuery } from '../../lib/pagination.js';
import { uploadImages } from '../../lib/upload.js';
import { addDisputeEvidence, agreeToDispute } from '../disputes/disputes.service.js';
import { confirmPayment } from '../payments/payments.service.js';
import {
  addBlockedDates,
  adminCancel,
  adminVerifyHandover,
  adminVerifyReturn,
  approveBooking,
  availability,
  cancelByOwner,
  cancelByRenter,
  completeHandover,
  completeReturn,
  declineBooking,
  disputeLateFee,
  fileClaim,
  inspectionOk,
  listBlockedDates,
  listBookings,
  loadAs,
  loadBooking,
  removeBlockedDates,
  reportNonReturn,
  requestBooking,
  startPayment,
  toAdminBooking,
  toOwnerBooking,
  toRenterBooking,
} from './rental.service.js';

const BOOKING_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'CONFIRMED',
  'ACTIVE',
  'RETURNED',
  'CLAIM_OPEN',
  'ADMIN_REVIEW',
  'SETTLING',
  'COMPLETED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
];

/** A calendar date, `YYYY-MM-DD`, that exists. */
const dateSchema = z
  .string('Give a date')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the form YYYY-MM-DD')
  .refine((value) => new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value), {
    message: 'That date does not exist',
  });
const idParams = z.object({ id: z.uuid() });
const listingParams = z.object({ listingId: z.uuid() });
const listQuery = z.object({
  ...paginationQuery,
  status: z.enum(BOOKING_STATUSES).optional(),
  listingId: z.uuid().optional(),
});
const requestSchema = z.strictObject({
  listingId: z.uuid(),
  durationDays: z.number().int().min(1).max(RENTAL_PACKAGE_MAX_DAYS),
  startDate: dateSchema,
  fulfilment: z.enum(['DELIVERY', 'PICKUP']),
  addressId: z.uuid().optional(),
});
const optionalReason = z.strictObject({
  reason: z.string().trim().max(REASON_MAX_LENGTH).optional(),
});
const reasonText = z
  .string('Give a reason')
  .trim()
  .min(5, 'Give a reason of at least 5 characters')
  .max(REASON_MAX_LENGTH);
const requiredReason = z.strictObject({ reason: reasonText });
const codeSchema = z.strictObject({
  code: z.string().trim().length(HANDOVER_CODE_LENGTH, 'Enter the 6-digit code'),
});
const amount = z.number().int().min(0).max(LISTING_AMOUNT_MAX_PAISE);
const claimSchema = z.strictObject({
  description: z
    .string()
    .trim()
    .min(CLAIM_DESCRIPTION_MIN_LENGTH)
    .max(ISSUE_DESCRIPTION_MAX_LENGTH),
  items: z
    .array(
      z.strictObject({
        label: z.string().trim().min(2).max(80),
        amountPaise: amount.min(1),
      }),
    )
    .min(1, 'List at least one cost')
    .max(CLAIM_ITEMS_MAX),
});
const claimResponseSchema = z
  .strictObject({ accept: z.boolean(), reason: reasonText.optional() })
  .refine((value) => value.accept || value.reason, {
    message: 'Say why you dispute the claim',
    path: ['reason'],
  });
const blockSchema = z.strictObject({
  listingId: z.uuid(),
  startDate: dateSchema,
  endDate: dateSchema,
});
const blockQuery = z.object({ listingId: z.uuid() });
const verifySchema = z.strictObject({
  gatewayOrderId: z.string().min(1).max(100),
  gatewayPaymentId: z.string().min(1).max(100),
  signature: z.string().min(1).max(200),
});
const simulateSchema = z.strictObject({ outcome: z.enum(['success', 'failure']) });

const photos = uploadImages({
  fieldName: 'photos',
  maxFiles: RENTAL_CONDITION_PHOTOS_MAX,
  maxBytes: LISTING_IMAGE_MAX_BYTES,
});

function parseData(req) {
  try {
    return JSON.parse(req.body?.data ?? '');
  } catch {
    throw AppError.badRequest('Send the details as JSON in a "data" field');
  }
}

/** `/rentals`: availability (public) and asking to rent. */
export function createRentalsRouter(deps) {
  const { clock, paymentGateway, requireAuth, limiters } = deps;
  const router = Router();

  router.get('/availability/:listingId', async (req, res) => {
    const { listingId } = listingParams.parse(req.params);
    res.json(await availability(deps, listingId));
  });

  router.post('/', limiters.rental, requireAuth, requireVerified, async (req, res) => {
    const input = requestSchema.parse(req.body);
    const booking = await requestBooking(deps, req.auth.userId, input);
    res.status(201).json({ booking: toRenterBooking(booking, clock.now(), paymentGateway) });
  });

  return router;
}

/** `/me/rentals`: what the signed-in person rents. */
export function createRenterBookingsRouter(deps) {
  const { db, clock, paymentGateway } = deps;
  const router = Router();
  router.use(deps.requireAuth);
  const view = (booking) => toRenterBooking(booking, clock.now(), paymentGateway);
  const mine = (req) =>
    loadAs(db, idParams.parse(req.params).id, { userId: req.auth.userId, side: 'renter' });
  const reply = (res, booking, status = 200) => res.status(status).json({ booking: view(booking) });

  router.get('/', async (req, res) => {
    const query = listQuery.parse(req.query);
    const where = { renterId: req.auth.userId, status: query.status, listingId: query.listingId };
    res.json(await listBookings(deps, where, query, view));
  });
  router.get('/:id', async (req, res) => reply(res, await mine(req)));
  router.post('/:id/cancel', async (req, res) => {
    const { reason } = optionalReason.parse(req.body ?? {});
    reply(res, await cancelByRenter(deps, await mine(req), reason));
  });
  router.post('/:id/pay', deps.limiters.checkout, async (req, res) =>
    reply(res, await startPayment(deps, await mine(req))),
  );

  /** The browser reports a payment the gateway's page completed; the gateway is asked. */
  router.post('/:id/verify', async (req, res) => {
    const input = verifySchema.parse(req.body);
    const booking = await mine(req);
    const genuine =
      booking.gatewayOrderId === input.gatewayOrderId &&
      paymentGateway.verifyPaymentSignature({
        orderId: input.gatewayOrderId,
        paymentId: input.gatewayPaymentId,
        signature: input.signature,
      });
    if (!genuine) throw new AppError(400, 'INVALID_SIGNATURE', 'The payment could not be verified');
    const entity = await paymentGateway.fetchPayment(input.gatewayPaymentId);
    if (entity.order_id !== booking.gatewayOrderId) {
      throw new AppError(400, 'INVALID_SIGNATURE', 'The payment could not be verified');
    }
    await confirmPayment(deps, entity);
    reply(res, await loadBooking(db, booking.id));
  });

  // Development without Razorpay keys: stands in for paying on the gateway's page.
  if (paymentGateway.mode === 'simulated' && env.NODE_ENV !== 'production') {
    router.post('/:id/simulate-payment', async (req, res) => {
      const { outcome } = simulateSchema.parse(req.body);
      const booking = await mine(req);
      if (!booking.gatewayOrderId) throw AppError.conflict('Start the payment first');
      const entity = paymentGateway.pay(booking.gatewayOrderId, {
        status: outcome === 'success' ? 'captured' : 'failed',
      });
      await confirmPayment(deps, entity);
      reply(res, await loadBooking(db, booking.id));
    });
  }

  router.post('/:id/return', deps.limiters.checkout, photos, async (req, res) => {
    const booking = await mine(req);
    const { code } = codeSchema.parse(parseData(req));
    reply(res, await completeReturn(deps, booking, code, req.files));
  });
  router.post('/:id/claim-response', async (req, res) => {
    const input = claimResponseSchema.parse(req.body ?? {});
    // Kept for the rental pages: accepting agrees to the claim; disputing it adds the
    // renter's answer to the dispute, which then goes to an admin (I79).
    const booking = await mine(req);
    const dispute = await db.dispute.findFirst({
      where: { bookingId: booking.id, kind: 'RENTAL_DEPOSIT', status: 'OPEN' },
    });
    if (!dispute || dispute.claimantId !== booking.ownerId) {
      throw new AppError(409, 'NO_OPEN_CLAIM', 'There is no claim to answer');
    }
    if (input.accept) await agreeToDispute(deps, req.auth.userId, dispute);
    else await addDisputeEvidence(deps, req.auth.userId, dispute, { text: input.reason }, []);
    reply(res, await loadBooking(db, booking.id));
  });
  router.post('/:id/dispute-late-fee', async (req, res) => {
    const { reason } = requiredReason.parse(req.body ?? {});
    reply(res, await disputeLateFee(deps, await mine(req), reason));
  });

  return router;
}

/** `/me/rented-out`: bookings of the signed-in owner's rental listings. */
export function createOwnerBookingsRouter(deps) {
  const { db, clock } = deps;
  const router = Router();
  router.use(deps.requireAuth);
  const view = (booking) => toOwnerBooking(booking, clock.now());
  const mine = (req) =>
    loadAs(db, idParams.parse(req.params).id, { userId: req.auth.userId, side: 'owner' });
  const reply = (res, booking, status = 200) => res.status(status).json({ booking: view(booking) });

  router.get('/', async (req, res) => {
    const query = listQuery.parse(req.query);
    const where = { ownerId: req.auth.userId, status: query.status, listingId: query.listingId };
    res.json(await listBookings(deps, where, query, view));
  });
  router.get('/:id', async (req, res) => reply(res, await mine(req)));
  router.post('/:id/approve', async (req, res) =>
    reply(res, await approveBooking(deps, await mine(req))),
  );
  router.post('/:id/decline', async (req, res) => {
    const { reason } = optionalReason.parse(req.body ?? {});
    reply(res, await declineBooking(deps, await mine(req), reason));
  });
  router.post('/:id/cancel', async (req, res) => {
    const { reason } = requiredReason.parse(req.body ?? {});
    reply(res, await cancelByOwner(deps, await mine(req), reason));
  });
  router.post('/:id/handover', deps.limiters.checkout, photos, async (req, res) => {
    const booking = await mine(req);
    const { code } = codeSchema.parse(parseData(req));
    reply(res, await completeHandover(deps, booking, code, req.files));
  });
  router.post('/:id/inspection-ok', async (req, res) =>
    reply(res, await inspectionOk(deps, await mine(req))),
  );
  router.post('/:id/claim', photos, async (req, res) => {
    const booking = await mine(req);
    const input = claimSchema.parse(parseData(req));
    reply(res, await fileClaim(deps, booking, input, req.files), 201);
  });
  router.post('/:id/report-non-return', async (req, res) => {
    const { reason } = optionalReason.parse(req.body ?? {});
    reply(res, await reportNonReturn(deps, await mine(req), reason));
  });

  return router;
}

/** `/me/blocked-dates`: days an owner closes a rental listing for. */
export function createBlockedDatesRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth);

  router.get('/', async (req, res) => {
    const { listingId } = blockQuery.parse(req.query);
    res.json({ items: await listBlockedDates(deps, req.auth.userId, listingId) });
  });
  router.post('/', async (req, res) => {
    const input = blockSchema.parse(req.body);
    res.status(201).json({ blocked: await addBlockedDates(deps, req.auth.userId, input) });
  });
  router.delete('/:id', async (req, res) => {
    await removeBlockedDates(deps, req.auth.userId, idParams.parse(req.params).id);
    res.status(204).end();
  });

  return router;
}

/** `/admin/rentals`: admin-only; every action needs a reason and is audited. */
export function createAdminRentalsRouter(deps) {
  const { db, clock, paymentGateway } = deps;
  const router = Router();
  router.use(deps.requireAuth, requireAdmin);
  const view = (booking) => toAdminBooking(booking, clock.now(), paymentGateway);
  const load = (req) => loadBooking(db, idParams.parse(req.params).id);
  const reply = (res, booking) => res.json({ booking: view(booking) });

  router.get('/', async (req, res) => {
    const query = listQuery.parse(req.query);
    res.json(
      await listBookings(deps, { status: query.status, listingId: query.listingId }, query, view),
    );
  });
  router.get('/:id', async (req, res) => reply(res, await load(req)));
  router.post('/:id/verify-handover', async (req, res) => {
    const { reason } = requiredReason.parse(req.body ?? {});
    reply(res, await adminVerifyHandover(deps, await load(req), req.auth.userId, reason));
  });
  router.post('/:id/verify-return', async (req, res) => {
    const { reason } = requiredReason.parse(req.body ?? {});
    reply(res, await adminVerifyReturn(deps, await load(req), req.auth.userId, reason));
  });
  router.post('/:id/cancel', async (req, res) => {
    const { reason } = requiredReason.parse(req.body ?? {});
    reply(res, await adminCancel(deps, await load(req), req.auth.userId, reason));
  });

  return router;
}
