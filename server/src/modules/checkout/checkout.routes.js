import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { requireVerified } from '../../lib/auth.js';
import { AppError } from '../../lib/errors.js';
import { confirmPayment, handleWebhook } from '../payments/payments.service.js';
import { checkoutInclude, createCheckout, toCheckout } from './checkout.service.js';

const createSchema = z.strictObject({
  groups: z
    .array(
      z.strictObject({
        sellerId: z.uuid(),
        fulfilment: z.enum(['DELIVERY', 'PICKUP']),
        addressId: z.uuid().optional(),
      }),
    )
    .min(1)
    .max(20),
});
const idParams = z.object({ id: z.uuid() });
const verifySchema = z.strictObject({
  gatewayOrderId: z.string().min(1).max(100),
  gatewayPaymentId: z.string().min(1).max(100),
  signature: z.string().min(1).max(200),
});
const simulateSchema = z.strictObject({ outcome: z.enum(['success', 'failure']) });

async function loadOwnCheckout(db, buyerId, id) {
  const checkout = await db.checkout.findFirst({
    where: { id, buyerId },
    include: checkoutInclude,
  });
  if (!checkout) throw AppError.notFound('Checkout not found');
  return checkout;
}

/** `/checkouts`: starting and paying a checkout. */
export function createCheckoutRouter(deps) {
  const { db, paymentGateway, requireAuth, limiters } = deps;
  const router = Router();

  router.post('/', limiters.checkout, requireAuth, requireVerified, async (req, res) => {
    const { groups } = createSchema.parse(req.body);
    try {
      res.status(201).json({ checkout: await createCheckout(deps, req.auth.userId, groups) });
    } catch (error) {
      // Two checkouts started at the same moment: the unique open-checkout index decided.
      if (error?.code === 'P2002') {
        throw new AppError(409, 'CHECKOUT_IN_PROGRESS', 'A checkout is already being started');
      }
      throw error;
    }
  });

  router.get('/:id', requireAuth, async (req, res) => {
    const { id } = idParams.parse(req.params);
    res.json({
      checkout: toCheckout(await loadOwnCheckout(db, req.auth.userId, id), paymentGateway),
    });
  });

  /**
   * The browser reports a payment the gateway's page completed. The signature
   * proves the gateway issued it; the amount comes from the gateway, not the browser.
   */
  router.post('/:id/verify', requireAuth, async (req, res) => {
    const { id } = idParams.parse(req.params);
    const input = verifySchema.parse(req.body);
    const checkout = await loadOwnCheckout(db, req.auth.userId, id);
    const genuine =
      checkout.gatewayOrderId === input.gatewayOrderId &&
      paymentGateway.verifyPaymentSignature({
        orderId: input.gatewayOrderId,
        paymentId: input.gatewayPaymentId,
        signature: input.signature,
      });
    if (!genuine) throw new AppError(400, 'INVALID_SIGNATURE', 'The payment could not be verified');

    const entity = await paymentGateway.fetchPayment(input.gatewayPaymentId);
    if (entity.order_id !== checkout.gatewayOrderId) {
      throw new AppError(400, 'INVALID_SIGNATURE', 'The payment could not be verified');
    }
    await confirmPayment(deps, entity);
    res.json({
      checkout: toCheckout(await loadOwnCheckout(db, req.auth.userId, id), paymentGateway),
    });
  });

  // Development without Razorpay keys: stands in for paying on the gateway's page.
  if (paymentGateway.mode === 'simulated' && env.NODE_ENV !== 'production') {
    router.post('/:id/simulate-payment', requireAuth, async (req, res) => {
      const { id } = idParams.parse(req.params);
      const { outcome } = simulateSchema.parse(req.body);
      const checkout = await loadOwnCheckout(db, req.auth.userId, id);
      if (!checkout.gatewayOrderId) throw AppError.conflict('This checkout has no payment to make');
      const entity = paymentGateway.pay(checkout.gatewayOrderId, {
        status: outcome === 'success' ? 'captured' : 'failed',
      });
      await confirmPayment(deps, entity);
      res.json({
        checkout: toCheckout(await loadOwnCheckout(db, req.auth.userId, id), paymentGateway),
      });
    });
  }

  return router;
}

/** `/payments/webhook`: events from the gateway. Signed; each processed once. */
export function createWebhookRouter(deps) {
  const router = Router();

  router.post('/webhook', async (req, res) => {
    const signature = req.get('x-razorpay-signature');
    if (!req.rawBody || !deps.paymentGateway.verifyWebhookSignature(req.rawBody, signature)) {
      throw new AppError(400, 'INVALID_SIGNATURE', 'Webhook signature does not match');
    }
    const eventId =
      req.get('x-razorpay-event-id') ??
      `body:${crypto.createHash('sha256').update(req.rawBody).digest('hex')}`;
    res.json(await handleWebhook(deps, { eventId, body: req.body }));
  });

  return router;
}
