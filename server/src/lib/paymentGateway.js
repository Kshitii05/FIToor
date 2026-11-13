import crypto from 'node:crypto';
import { env } from '../config/env.js';

// The payment gateway, behind one interface:
//
//   mode, keyId
//   createOrder({ amountPaise, receipt, notes }) -> { id }
//   verifyPaymentSignature({ orderId, paymentId, signature }) -> boolean
//   verifyWebhookSignature(rawBody, signature) -> boolean
//   fetchPayment(paymentId) -> payment entity
//   createRefund({ paymentId, amountPaise, reference }) -> { id, status }
//   findRefund({ paymentId, reference }) -> { id, status } | null
//
// A payment entity is { id, order_id, amount, status, method, fee } as Razorpay
// sends it (amounts in paise). Only Razorpay test mode is used; env.js refuses live
// keys. Without keys, development uses the simulated gateway, which signs and
// verifies the same way, so every payment still goes through the verified path.

const hmac = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('hex');

function safeEqual(expected, received) {
  if (typeof received !== 'string' || received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export class GatewayError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
  }
}

function signatureMethods({ keySecret, webhookSecret }) {
  return {
    paymentSignature: (orderId, paymentId) => hmac(keySecret, `${orderId}|${paymentId}`),
    verifyPaymentSignature({ orderId, paymentId, signature }) {
      return safeEqual(hmac(keySecret, `${orderId}|${paymentId}`), signature);
    },
    webhookSignature: (rawBody) => hmac(webhookSecret, rawBody),
    verifyWebhookSignature(rawBody, signature) {
      if (!rawBody) return false;
      return safeEqual(hmac(webhookSecret, rawBody), signature);
    },
  };
}

// ---------------------------------------------------------------------------
// Razorpay (test mode)
// ---------------------------------------------------------------------------

export function createRazorpayGateway({
  keyId = env.RAZORPAY_KEY_ID,
  keySecret = env.RAZORPAY_KEY_SECRET,
  webhookSecret = env.RAZORPAY_WEBHOOK_SECRET,
  fetchFn = globalThis.fetch,
} = {}) {
  const authorization = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

  async function call(method, path, body) {
    let response;
    try {
      response = await fetchFn(`https://api.razorpay.com/v1${path}`, {
        method,
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      throw new GatewayError(`Payment gateway unreachable: ${error.message}`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new GatewayError(data?.error?.description ?? `Gateway error ${response.status}`, {
        status: response.status,
      });
    }
    return data;
  }

  return {
    mode: 'razorpay',
    keyId,
    ...signatureMethods({ keySecret, webhookSecret }),

    async createOrder({ amountPaise, receipt, notes }) {
      const order = await call('POST', '/orders', {
        amount: amountPaise,
        currency: 'INR',
        receipt,
        notes,
      });
      return { id: order.id };
    },

    fetchPayment(paymentId) {
      return call('GET', `/payments/${encodeURIComponent(paymentId)}`);
    },

    async createRefund({ paymentId, amountPaise, reference }) {
      const refund = await call('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, {
        amount: amountPaise,
        receipt: reference,
        notes: { reference },
      });
      return { id: refund.id, status: refund.status };
    },

    async findRefund({ paymentId, reference }) {
      const list = await call(
        'GET',
        `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`,
      );
      const match = (list.items ?? []).find((refund) => refund.notes?.reference === reference);
      return match ? { id: match.id, status: match.status } : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Simulated gateway: development without keys, and tests
// ---------------------------------------------------------------------------

/**
 * Behaves like the gateway from the server's point of view. `pay(orderId)` stands in
 * for a buyer paying on the gateway's page; `webhookBody` builds what the gateway
 * would post. `refundOutcome` ('processed', 'pending' or 'error') lets tests choose.
 */
export function createSimulatedGateway({
  keySecret = `${env.OTP_SECRET}:simulated-key`,
  webhookSecret = `${env.OTP_SECRET}:simulated-webhook`,
} = {}) {
  const orders = new Map();
  const payments = new Map();
  const refunds = [];
  const id = (prefix) => `${prefix}_sim${crypto.randomBytes(7).toString('hex')}`;

  const gateway = {
    mode: 'simulated',
    keyId: 'simulated',
    refundOutcome: 'processed',
    refunds,
    ...signatureMethods({ keySecret, webhookSecret }),

    async createOrder({ amountPaise, receipt }) {
      const order = { id: id('order'), amount: amountPaise, receipt };
      orders.set(order.id, order);
      return { id: order.id };
    },

    /** A buyer paying for a gateway order. Returns the payment entity. */
    pay(orderId, { status = 'captured', amountPaise } = {}) {
      const order = orders.get(orderId);
      if (!order) throw new Error(`No simulated order ${orderId}`);
      const payment = {
        id: id('pay'),
        entity: 'payment',
        order_id: orderId,
        amount: amountPaise ?? order.amount,
        currency: 'INR',
        status,
        method: 'upi',
        fee: status === 'captured' ? Math.round((amountPaise ?? order.amount) * 0.02) : null,
      };
      payments.set(payment.id, payment);
      return payment;
    },

    webhookBody(event, entity) {
      const kind = entity.entity === 'refund' ? 'refund' : 'payment';
      return {
        entity: 'event',
        event,
        payload: { [kind]: { entity } },
        created_at: Math.floor(Date.now() / 1000),
      };
    },

    async fetchPayment(paymentId) {
      const payment = payments.get(paymentId);
      if (!payment) throw new GatewayError('Payment not found', { status: 404 });
      return payment;
    },

    async createRefund({ paymentId, amountPaise, reference }) {
      if (gateway.refundOutcome === 'error') throw new GatewayError('Simulated refund failure');
      const refund = {
        id: id('rfnd'),
        entity: 'refund',
        payment_id: paymentId,
        amount: amountPaise,
        notes: { reference },
        status: gateway.refundOutcome === 'pending' ? 'pending' : 'processed',
      };
      refunds.push(refund);
      return { id: refund.id, status: refund.status };
    },

    async findRefund({ paymentId, reference }) {
      const match = refunds.find(
        (refund) => refund.payment_id === paymentId && refund.notes.reference === reference,
      );
      return match ? { id: match.id, status: match.status } : null;
    },
  };
  return gateway;
}

/**
 * The gateway for this environment: Razorpay test mode when keys are set; the
 * simulated gateway in development without keys. Production without keys cannot
 * take payments.
 */
export function createPaymentGateway() {
  if (env.RAZORPAY_KEY_ID) return createRazorpayGateway();
  if (env.NODE_ENV === 'production') {
    const unavailable = async () => {
      throw new GatewayError('Payments are not configured: set the RAZORPAY_* values');
    };
    return {
      mode: 'unavailable',
      keyId: null,
      createOrder: unavailable,
      fetchPayment: unavailable,
      createRefund: unavailable,
      findRefund: unavailable,
      verifyPaymentSignature: () => false,
      verifyWebhookSignature: () => false,
    };
  }
  return createSimulatedGateway();
}
