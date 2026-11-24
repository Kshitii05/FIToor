import request from 'supertest';
import { db } from './helpers.js';

const API = '/api/v1';

export const BANK = {
  holderName: 'Riya Sharma',
  accountNumber: '123456789012',
  ifsc: 'HDFC0001234',
};

export const saveBank = (ctx, account, body = BANK) =>
  request(ctx.app).put(`${API}/me/bank-account`).set(account.bearer).send(body);

export const adminGet = (ctx, admin, path) =>
  request(ctx.app).get(`${API}/admin${path}`).set(admin.bearer);

export const adminPost = (ctx, admin, path, body = {}) =>
  request(ctx.app).post(`${API}/admin${path}`).set(admin.bearer).send(body);

/** Saves bank details for `seller` and has `admin` verify them. */
export async function verifiedBank(ctx, seller, admin, body = BANK) {
  const saved = await saveBank(ctx, seller, body);
  if (saved.status !== 200) throw new Error(`Bank save failed: ${saved.status}`);
  const account = await db.sellerBankAccount.findUniqueOrThrow({
    where: { userId: seller.user.id },
  });
  const res = await adminPost(ctx, admin, `/bank-accounts/${account.id}/verify`, {
    reason: 'Checked the name against a test transfer',
  });
  if (res.status !== 200)
    throw new Error(`Verify failed: ${res.status} ${JSON.stringify(res.body)}`);
  return account;
}

export async function buildBatch(ctx, admin) {
  return adminPost(ctx, admin, '/payout-batches');
}

/** Net seller payable in the ledger for one order or booking. */
export async function netPayable(where) {
  const rows = await db.ledgerEntry.findMany({
    where: { ...where, type: { in: ['SELLER_PAYABLE', 'SELLER_PAYABLE_REVERSAL'] } },
  });
  return rows.reduce(
    (t, r) => t + (r.type === 'SELLER_PAYABLE' ? r.amountPaise : -r.amountPaise),
    0,
  );
}

export async function runPayoutJobs(ctx) {
  const { runPayoutJobs: run } = await import('../src/modules/payouts/payouts.service.js');
  return run(ctx.app.locals.deps);
}
