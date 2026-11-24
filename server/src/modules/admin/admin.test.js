import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  db,
  registerUser,
  registerVerifiedUser,
  resetDb,
} from '../../../test/helpers.js';
import { insertListing } from '../../../test/listings.js';
import { buyerAction, paidOrder, registerAdmin } from '../../../test/orders.js';
import { adminGet, adminPost } from '../../../test/payouts.js';
import { markRefundFailed } from '../payments/refunds.service.js';

const API = '/api/v1';
const BOM = String.fromCharCode(0xfeff);
const ID = '00000000-0000-4000-8000-000000000000';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

// Every admin endpoint added in this step, with a body where it needs one.
const ADMIN_ROUTES = [
  ['get', '/admin/users'],
  ['get', `/admin/users/${ID}`],
  ['post', `/admin/users/${ID}/suspend`],
  ['post', `/admin/users/${ID}/restore`],
  ['post', `/admin/users/${ID}/warn`],
  ['get', '/admin/listings'],
  ['post', `/admin/listings/${ID}/remove`],
  ['post', `/admin/listings/${ID}/restore`],
  ['get', '/admin/orders?format=csv'],
  ['get', '/admin/rentals?format=csv'],
  ['get', '/admin/payments'],
  ['get', '/admin/refunds'],
  ['post', `/admin/refunds/${ID}/retry`],
  ['get', '/admin/deposits'],
  ['get', '/admin/audit-log'],
  ['get', '/admin/bank-accounts'],
  ['post', `/admin/bank-accounts/${ID}/verify`],
  ['post', `/admin/bank-accounts/${ID}/reject`],
  ['get', '/admin/payouts/eligible'],
  ['get', '/admin/payout-batches'],
  ['post', '/admin/payout-batches'],
  ['get', `/admin/payout-batches/${ID}`],
  ['get', `/admin/payout-batches/${ID}/bank-file.csv`],
  ['get', '/admin/payout-items'],
  ['post', `/admin/payout-items/${ID}/paid`],
  ['post', `/admin/payout-items/${ID}/failed`],
  ['post', `/admin/payout-items/${ID}/retry`],
  ['get', '/admin/analytics'],
];

const reason = { reason: 'Checked the reports and evidence' };

describe('admin authorization', () => {
  it('every admin route refuses signed-out visitors and regular users', async () => {
    const ctx = createTestContext();
    const user = await registerVerifiedUser(ctx);
    for (const [method, path] of ADMIN_ROUTES) {
      const anonymous = await request(ctx.app)[method](`${API}${path}`).send(reason);
      expect(anonymous.status, `${method} ${path}`).toBe(401);
      const regular = await request(ctx.app)[method](`${API}${path}`).set(user.bearer).send(reason);
      expect(regular.status, `${method} ${path}`).toBe(403);
    }
  });

  it('an admin action without a reason is refused and nothing is logged', async () => {
    const ctx = createTestContext();
    const admin = await registerAdmin(ctx);
    const user = await registerVerifiedUser(ctx);
    const res = await adminPost(ctx, admin, `/users/${user.user.id}/suspend`, {});
    expect(res.status).toBe(400);
    expect(await db.adminAuditLog.count()).toBe(0);
    expect((await db.user.findUnique({ where: { id: user.user.id } })).status).toBe('ACTIVE');
  });
});

describe('user management', () => {
  it('finds users by name, email or phone and filters by status', async () => {
    const ctx = createTestContext();
    const admin = await registerAdmin(ctx);
    const riya = await registerUser(ctx, { displayName: 'Riya Kapoor' });
    await registerUser(ctx, { displayName: 'Aman Gill' });
    const byName = await adminGet(ctx, admin, '/users?q=kapoor');
    expect(byName.body.items.map((u) => u.id)).toEqual([riya.user.id]);
    const byEmail = await adminGet(ctx, admin, `/users?q=${riya.details.email}`);
    expect(byEmail.body.total).toBe(1);
    const admins = await adminGet(ctx, admin, '/users?role=ADMIN');
    expect(admins.body.items.map((u) => u.id)).toEqual([admin.user.id]);
    const detail = await adminGet(ctx, admin, `/users/${riya.user.id}`);
    expect(detail.body).toMatchObject({
      user: { displayName: 'Riya Kapoor', status: 'ACTIVE' },
      counts: { purchases: 0, sales: 0 },
    });
  });

  it('suspending ends sign-in and sessions and hides listings; restoring brings them back', async () => {
    const ctx = createTestContext();
    const admin = await registerAdmin(ctx);
    const seller = await registerVerifiedUser(ctx);
    const listing = await insertListing(seller, { title: 'Mustard silk saree' });
    const visible = await request(ctx.app).get(`${API}/listings/${listing.id}`);
    expect(visible.status).toBe(200);

    const res = await adminPost(ctx, admin, `/users/${seller.user.id}/suspend`, {
      reason: 'Repeated counterfeit listings',
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      status: 'SUSPENDED',
      suspensionReason: 'Repeated counterfeit listings',
    });

    // The current access token stops working, the refresh session is gone, sign-in is refused.
    expect((await request(ctx.app).get(`${API}/me`).set(seller.bearer)).status).toBe(401);
    const refresh = await request(ctx.app)
      .post(`${API}/auth/refresh`)
      .set('Cookie', seller.refreshCookie);
    expect(refresh.status).toBe(401);
    const login = await request(ctx.app)
      .post(`${API}/auth/login`)
      .send({ email: seller.details.email, password: seller.details.password });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('ACCOUNT_SUSPENDED');

    expect((await request(ctx.app).get(`${API}/listings/${listing.id}`)).status).toBe(404);
    const search = await request(ctx.app).get(`${API}/listings?q=saree`);
    expect(search.body.items.map((l) => l.id)).not.toContain(listing.id);
    expect(
      await db.notification.count({ where: { userId: seller.user.id, type: 'accountSuspended' } }),
    ).toBe(1);

    const restored = await adminPost(ctx, admin, `/users/${seller.user.id}/restore`, {
      reason: 'Appeal accepted after review',
    });
    expect(restored.body.user.status).toBe('ACTIVE');
    expect((await request(ctx.app).get(`${API}/listings/${listing.id}`)).status).toBe(200);
    const again = await request(ctx.app)
      .post(`${API}/auth/login`)
      .send({ email: seller.details.email, password: seller.details.password });
    expect(again.status).toBe(200);

    const audit = await db.adminAuditLog.findMany({
      where: { targetId: seller.user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => [a.action, a.reason])).toEqual([
      ['SUSPEND_USER', 'Repeated counterfeit listings'],
      ['RESTORE_USER', 'Appeal accepted after review'],
    ]);
  });

  it('a ban also removes every listing, and they stay removed after a restore', async () => {
    const ctx = createTestContext();
    const admin = await registerAdmin(ctx);
    const seller = await registerVerifiedUser(ctx);
    const one = await insertListing(seller);
    const two = await insertListing(seller, { status: 'PAUSED' });
    const res = await adminPost(ctx, admin, `/users/${seller.user.id}/suspend`, {
      reason: 'Stolen goods confirmed by police',
      removeListings: true,
    });
    expect(res.body.removedListings).toBe(2);
    const rows = await db.listing.findMany({ where: { id: { in: [one.id, two.id] } } });
    expect(rows.every((l) => l.status === 'REMOVED')).toBe(true);
    expect((await db.adminAuditLog.findFirst()).action).toBe('BAN_USER');

    await adminPost(ctx, admin, `/users/${seller.user.id}/restore`, reason);
    expect((await db.listing.findUnique({ where: { id: one.id } })).status).toBe('REMOVED');
  });

  it('admins cannot suspend themselves or other admins; a warning notifies the user', async () => {
    const ctx = createTestContext();
    const admin = await registerAdmin(ctx);
    const other = await registerAdmin(ctx);
    expect((await adminPost(ctx, admin, `/users/${admin.user.id}/suspend`, reason)).status).toBe(
      403,
    );
    expect((await adminPost(ctx, admin, `/users/${other.user.id}/suspend`, reason)).status).toBe(
      403,
    );

    const user = await registerVerifiedUser(ctx);
    const warned = await adminPost(ctx, admin, `/users/${user.user.id}/warn`, {
      reason: 'Please describe item condition honestly.',
    });
    expect(warned.status).toBe(200);
    const note = await db.notification.findFirstOrThrow({ where: { userId: user.user.id } });
    expect(note).toMatchObject({ category: 'ACCOUNT', critical: true, type: 'accountWarning' });
  });
});

describe('listing moderation', () => {
  it('removes and restores a listing to the status it had, with reasons in the audit log', async () => {
    const ctx = createTestContext();
    const admin = await registerAdmin(ctx);
    const seller = await registerVerifiedUser(ctx);
    const listing = await insertListing(seller, { status: 'PAUSED' });

    const removed = await adminPost(ctx, admin, `/listings/${listing.id}/remove`, {
      reason: 'Counterfeit brand label',
    });
    expect(removed.body.listing.status).toBe('REMOVED');
    expect((await adminPost(ctx, admin, `/listings/${listing.id}/remove`, reason)).status).toBe(
      409,
    );

    const restored = await adminPost(ctx, admin, `/listings/${listing.id}/restore`, {
      reason: 'Seller proved it is genuine',
    });
    expect(restored.body.listing.status).toBe('PAUSED');

    const log = await adminGet(ctx, admin, `/audit-log?targetId=${listing.id}`);
    expect(log.body.items.map((r) => [r.action, r.reason])).toEqual([
      ['RESTORE_LISTING', 'Seller proved it is genuine'],
      ['REMOVE_LISTING', 'Counterfeit brand label'],
    ]);
    const filtered = await adminGet(ctx, admin, '/listings?status=PAUSED');
    expect(filtered.body.items.map((l) => l.id)).toEqual([listing.id]);
  });
});

describe('CSV export', () => {
  it('downloads every matching row and neutralises cells that look like formulas', async () => {
    const ctx = createTestContext();
    const admin = await registerAdmin(ctx);
    await registerUser(ctx, { displayName: '=HYPERLINK("http://evil.test","Click")' });
    const res = await adminGet(ctx, admin, '/users?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="users.csv"/);
    const lines = res.text.replace(BOM, '').trim().split('\r\n');
    expect(lines[0]).toMatch(/^id,email,phone,name,/);
    expect(lines).toHaveLength(3);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil.test"",""Click"")"`);
    expect(res.text).not.toMatch(/,=HYPERLINK/);
  });

  it('exports orders with amounts in rupees', async () => {
    const ctx = createTestContext();
    const { order } = await paidOrder(ctx);
    const admin = await registerAdmin(ctx);
    const res = await adminGet(ctx, admin, `/orders?format=csv&q=${order.ref}`);
    expect(res.status).toBe(200);
    const [, row] = res.text.replace(BOM, '').trim().split('\r\n');
    expect(row).toContain(order.ref);
    expect(row).toContain(`${order.totalPaise / 100}.00`);
  });
});

describe('refunds', () => {
  it('a refund the gateway reported failed is replaced by a new one on retry, and money moves once', async () => {
    const ctx = createTestContext();
    const { buyer, order } = await paidOrder(ctx);
    ctx.gateway.refundOutcome = 'pending';
    expect((await buyerAction(ctx, buyer, order.id, 'cancel')).status).toBe(200);
    const refund = await db.refund.findFirstOrThrow({ where: { orderId: order.id } });
    await markRefundFailed(ctx.app.locals.deps, refund.gatewayRefundId, 'Card closed');

    const admin = await registerAdmin(ctx);
    const failed = await adminGet(ctx, admin, '/refunds?status=FAILED');
    expect(failed.body.items.map((r) => r.id)).toEqual([refund.id]);

    ctx.gateway.refundOutcome = 'processed';
    const res = await adminPost(ctx, admin, `/refunds/${refund.id}/retry`, {
      reason: 'Buyer gave a new card; retrying',
    });
    expect(res.status).toBe(200);
    expect(res.body.refund).toMatchObject({ status: 'PROCESSED', amountPaise: refund.amountPaise });
    expect(res.body.refund.id).not.toBe(refund.id);
    const refunded = await db.ledgerEntry.findMany({
      where: { orderId: order.id, type: 'BUYER_REFUND' },
    });
    expect(refunded).toHaveLength(1);
    expect(refunded[0].amountPaise).toBe(refund.amountPaise);

    const twice = await adminPost(ctx, admin, `/refunds/${res.body.refund.id}/retry`, reason);
    expect(twice.status).toBe(409);
  });
});
