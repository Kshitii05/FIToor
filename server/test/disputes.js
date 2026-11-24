import request from 'supertest';
import { runOrderJobs } from '../src/modules/orders/order.jobs.js';
import { db } from './helpers.js';
import { PNG } from './listings.js';
import { buyerView, paidOrder, sellerAction, signInAgain } from './orders.js';

const API = '/api/v1';

/** A pickup order the buyer has received (7-day issue window running). */
export async function deliveredOrder(ctx, options = {}) {
  const made = await paidOrder(ctx, { fulfilment: 'PICKUP', ...options });
  const { handoverCode } = await buyerView(ctx, made.buyer, made.order.id);
  const res = await sellerAction(ctx, made.seller, made.order.id, 'handover', {
    code: handoverCode,
  });
  if (res.status !== 200) throw new Error(`Handover failed: ${res.status}`);
  return made;
}

/** A completed order: received, then the 7-day window passed. Accounts are signed in again. */
export async function completedOrder(ctx) {
  const made = await deliveredOrder(ctx);
  ctx.clock.advance({ days: 7, minutes: 1 });
  await runOrderJobs(ctx.app.locals.deps);
  return {
    ...made,
    seller: await signInAgain(ctx, made.seller),
    buyer: await signInAgain(ctx, made.buyer),
  };
}

export function reportIssue(ctx, buyer, orderId, photos = 1) {
  const req = request(ctx.app)
    .post(`${API}/me/orders/${orderId}/issue`)
    .set(buyer.bearer)
    .field(
      'data',
      JSON.stringify({ kind: 'DAMAGED', description: 'The zip is broken and a seam is torn.' }),
    );
  for (let i = 0; i < photos; i += 1) req.attach('photos', PNG, `issue-${i}.png`);
  return req;
}

export const disputeFor = (where) =>
  db.dispute.findFirstOrThrow({ where, orderBy: { createdAt: 'desc' } });

export const disputeView = (ctx, account, id) =>
  request(ctx.app).get(`${API}/disputes/${id}`).set(account.bearer);

export const disputeAction = (ctx, account, id, action, body = {}) =>
  request(ctx.app).post(`${API}/disputes/${id}/${action}`).set(account.bearer).send(body);

export function addEvidence(ctx, account, id, text, photos = 0) {
  const req = request(ctx.app)
    .post(`${API}/disputes/${id}/evidence`)
    .set(account.bearer)
    .field('data', JSON.stringify({ text }));
  for (let i = 0; i < photos; i += 1) req.attach('photos', PNG, `evidence-${i}.png`);
  return req;
}

export const adminDispute = (ctx, admin, id, action, body = {}) =>
  request(ctx.app).post(`${API}/admin/disputes/${id}/${action}`).set(admin.bearer).send(body);

export async function runDisputeJobs(ctx) {
  const { runDisputeJobs: run } = await import('../src/modules/disputes/disputes.service.js');
  return run(ctx.app.locals.deps);
}
