import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  ANALYTICS_DEFAULT_RANGE_DAYS,
  ANALYTICS_RANGE_MAX_DAYS,
  ANALYTICS_TOP_LIMIT,
  BUSINESS_TIME_ZONE,
  INACTIVE_AFTER_DAYS,
} from '../../config/policy.js';
import { addCalendarDays, atBusinessTime, businessDate } from '../../lib/clock.js';
import { rupees } from '../../lib/csv.js';
import { AppError } from '../../lib/errors.js';

// Seller and platform analytics (SPEC Module 11; DECISIONS I15, I101, I110, I111),
// all aggregated in PostgreSQL.
//
// Every money figure is about COMPLETED orders and rentals, dated by completion,
// and read from the ledger rows of those transactions:
//   GMV                 what buyers paid for them, less refunds; items or rental fee
//                       plus delivery. Deposits and deposit deductions are not GMV.
//   platform revenue    commission less reversed commission.
//   seller net earnings seller payable less its reversals (includes deductions from
//                       deposits, which go to the owner).
//   seller gross        net earnings plus commission.
// So for any set of transactions: GMV = revenue + net earnings - deductions.
// Refunds, deposits, payouts and gateway fees are the ledger rows written in the
// period.

const TZ = Prisma.sql`${BUSINESS_TIME_ZONE}`;
const BUCKETS = ['day', 'week', 'month'];

export const rangeQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  bucket: z.enum(BUCKETS).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

/** The period asked for, as dates and instants, and how to group the series. */
export function resolveRange(now, { from, to, bucket }) {
  const end = to ?? businessDate(now);
  const start = from ?? addCalendarDays(end, -(ANALYTICS_DEFAULT_RANGE_DAYS - 1));
  if (start > end) throw AppError.badRequest('The start date is after the end date');
  const days =
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) +
    1;
  if (days > ANALYTICS_RANGE_MAX_DAYS) {
    throw AppError.badRequest(`Choose at most ${ANALYTICS_RANGE_MAX_DAYS} days`);
  }
  return {
    from: start,
    to: end,
    days,
    bucket: bucket ?? (days <= 62 ? 'day' : days <= 200 ? 'week' : 'month'),
    startAt: atBusinessTime(start, 0),
    endAt: atBusinessTime(addCalendarDays(end, 1), 0),
  };
}

const num = (value) => (value === null || value === undefined ? 0 : Number(value));
const day = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value));

/**
 * The completed transactions of the period with their ledger figures, as a SQL
 * common table expression named `txns`. `sellerId` narrows it to one seller.
 */
function completedTxns(range, sellerId) {
  const forOrder = sellerId ? Prisma.sql`AND o.seller_id = ${sellerId}::uuid` : Prisma.empty;
  const forBooking = sellerId ? Prisma.sql`AND b.owner_id = ${sellerId}::uuid` : Prisma.empty;
  return Prisma.sql`
    net AS (
      SELECT order_id, booking_id,
        sum(CASE type WHEN 'COMMISSION' THEN amount_paise
                      WHEN 'COMMISSION_REVERSAL' THEN -amount_paise ELSE 0 END) AS commission,
        sum(CASE type WHEN 'SELLER_PAYABLE' THEN amount_paise
                      WHEN 'SELLER_PAYABLE_REVERSAL' THEN -amount_paise ELSE 0 END) AS payable,
        sum(CASE type WHEN 'DEPOSIT_DEDUCTION' THEN amount_paise ELSE 0 END) AS deducted
      FROM ledger_entries
      WHERE order_id IS NOT NULL OR booking_id IS NOT NULL
      GROUP BY order_id, booking_id
    ),
    txns AS (
      SELECT 'sale' AS kind, o.id, o.seller_id, o.completed_at,
        (o.total_paise - o.refunded_paise)::bigint AS gmv,
        coalesce(n.commission, 0) AS commission, coalesce(n.payable, 0) AS payable,
        coalesce(n.deducted, 0) AS deducted
      FROM orders o LEFT JOIN net n ON n.order_id = o.id
      WHERE o.status = 'COMPLETED'
        AND o.completed_at >= ${range.startAt} AND o.completed_at < ${range.endAt} ${forOrder}
      UNION ALL
      SELECT 'rental', b.id, b.owner_id, b.completed_at,
        (b.fee_paise + b.delivery_charge_paise - b.refunded_paise)::bigint,
        coalesce(n.commission, 0), coalesce(n.payable, 0), coalesce(n.deducted, 0)
      FROM rental_bookings b LEFT JOIN net n ON n.booking_id = b.id
      WHERE b.status = 'COMPLETED'
        AND b.completed_at >= ${range.startAt} AND b.completed_at < ${range.endAt} ${forBooking}
    )`;
}

/** Ledger totals by type for rows written in the period (optionally one seller's). */
async function ledgerInPeriod(db, range, sellerId) {
  const forSeller = sellerId ? Prisma.sql`AND seller_id = ${sellerId}::uuid` : Prisma.empty;
  const rows = await db.$queryRaw`
    SELECT type::text AS type, sum(amount_paise) AS total
    FROM ledger_entries
    WHERE created_at >= ${range.startAt} AND created_at < ${range.endAt} ${forSeller}
    GROUP BY type`;
  return Object.fromEntries(rows.map((r) => [r.type, num(r.total)]));
}

function moneyTotals(row) {
  const sales = num(row.sales);
  const rentals = num(row.rentals);
  const gmv = num(row.gmv);
  const count = sales + rentals;
  return {
    sales,
    rentals,
    gmvPaise: gmv,
    commissionPaise: num(row.commission),
    sellerNetPaise: num(row.payable),
    depositDeductionsPaise: num(row.deducted),
    // Whole paise, rounded down.
    averageTransactionPaise: count ? Math.floor(gmv / count) : 0,
  };
}

const txnTotalsSql = Prisma.sql`
  count(*) FILTER (WHERE kind = 'sale') AS sales,
  count(*) FILTER (WHERE kind = 'rental') AS rentals,
  coalesce(sum(gmv), 0) AS gmv,
  coalesce(sum(commission), 0) AS commission,
  coalesce(sum(payable), 0) AS payable,
  coalesce(sum(deducted), 0) AS deducted`;

/** Fills buckets with no rows, so a chart shows a zero rather than skipping a day. */
function fillSeries(range, rows, empty) {
  const byBucket = new Map(rows.map((r) => [day(r.bucket), r]));
  const out = [];
  let cursor = range.from;
  const step = (date) => {
    if (range.bucket === 'day') return addCalendarDays(date, 1);
    if (range.bucket === 'week') return addCalendarDays(date, 7);
    const [y, m] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  };
  // Start at the bucket that holds `from` (Monday for weeks, the 1st for months).
  if (range.bucket === 'week') {
    const weekday = (new Date(`${cursor}T00:00:00Z`).getUTCDay() + 6) % 7;
    cursor = addCalendarDays(cursor, -weekday);
  } else if (range.bucket === 'month') {
    cursor = `${cursor.slice(0, 7)}-01`;
  }
  while (cursor <= range.to) {
    out.push({ ...empty, ...(byBucket.get(cursor) ?? {}), bucket: cursor });
    cursor = step(cursor);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export async function platformAnalytics({ db, clock }, query) {
  const now = clock.now();
  const range = resolveRange(now, query);
  const bucket = range.bucket;

  const [totals] = await db.$queryRaw`
    WITH ${completedTxns(range)} SELECT ${txnTotalsSql} FROM txns`;

  const txnSeries = await db.$queryRaw`
    WITH ${completedTxns(range)}
    SELECT date_trunc(${bucket}, completed_at AT TIME ZONE ${TZ})::date AS bucket, ${txnTotalsSql}
    FROM txns GROUP BY 1 ORDER BY 1`;

  const userSeries = await db.$queryRaw`
    SELECT date_trunc(${bucket}, created_at AT TIME ZONE ${TZ})::date AS bucket, count(*) AS signups
    FROM users
    WHERE created_at >= ${range.startAt} AND created_at < ${range.endAt}
    GROUP BY 1 ORDER BY 1`;

  const activeSeries = await db.$queryRaw`
    SELECT date_trunc(${bucket}, day::timestamp)::date AS bucket, count(DISTINCT user_id) AS active
    FROM user_activity_days
    WHERE day >= ${range.from}::date AND day <= ${range.to}::date
    GROUP BY 1 ORDER BY 1`;

  const [users] = await db.$queryRaw`
    SELECT
      count(*) FILTER (WHERE status <> 'DELETED') AS total,
      count(*) FILTER (WHERE created_at >= ${range.startAt} AND created_at < ${range.endAt}) AS new,
      (SELECT count(DISTINCT user_id) FROM user_activity_days
        WHERE day >= ${range.from}::date AND day <= ${range.to}::date) AS active,
      count(*) FILTER (WHERE status = 'ACTIVE' AND NOT EXISTS (
        SELECT 1 FROM user_activity_days a WHERE a.user_id = users.id
          AND a.day > ${addCalendarDays(range.to, -INACTIVE_AFTER_DAYS)}::date
          AND a.day <= ${range.to}::date)) AS inactive,
      count(*) FILTER (WHERE status = 'SUSPENDED') AS suspended
    FROM users WHERE role = 'USER'`;

  const [listings] = await db.$queryRaw`
    SELECT
      count(*) FILTER (WHERE mode = 'SALE' AND status = 'ACTIVE') AS "activeSale",
      count(*) FILTER (WHERE mode = 'RENT' AND status = 'ACTIVE') AS "activeRent",
      count(*) FILTER (WHERE created_at >= ${range.startAt} AND created_at < ${range.endAt}) AS new
    FROM listings WHERE deleted_at IS NULL`;

  const categories = await db.$queryRaw`
    WITH ${completedTxns(range)},
    lines AS (
      SELECT l.category, oi.unit_price_paise * oi.quantity AS value
      FROM txns t JOIN order_items oi ON oi.order_id = t.id AND t.kind = 'sale'
      JOIN listings l ON l.id = oi.listing_id
      UNION ALL
      SELECT l.category, b.fee_paise
      FROM txns t JOIN rental_bookings b ON b.id = t.id AND t.kind = 'rental'
      JOIN listings l ON l.id = b.listing_id
    )
    SELECT category::text AS category, count(*) AS count, sum(value) AS value
    FROM lines GROUP BY category ORDER BY count(*) DESC, sum(value) DESC
    LIMIT ${ANALYTICS_TOP_LIMIT}`;

  // Demand by area: the public locality of the listing, never a precise place.
  const localities = await db.$queryRaw`
    WITH ${completedTxns(range)},
    places AS (
      SELECT DISTINCT ON (t.id) t.id, t.gmv, l.locality
      FROM txns t JOIN order_items oi ON oi.order_id = t.id AND t.kind = 'sale'
      JOIN listings l ON l.id = oi.listing_id
      UNION ALL
      SELECT t.id, t.gmv, l.locality
      FROM txns t JOIN rental_bookings b ON b.id = t.id AND t.kind = 'rental'
      JOIN listings l ON l.id = b.listing_id
    )
    SELECT coalesce(locality, 'Unknown') AS locality, count(*) AS count, sum(gmv) AS gmv
    FROM places GROUP BY 1 ORDER BY count(*) DESC, sum(gmv) DESC
    LIMIT ${ANALYTICS_TOP_LIMIT}`;

  const topSellers = await db.$queryRaw`
    WITH ${completedTxns(range)}
    SELECT t.seller_id AS id, u.email, p.display_name AS "displayName",
      count(*) AS count, sum(t.gmv) AS gmv, sum(t.commission) AS commission
    FROM txns t JOIN users u ON u.id = t.seller_id
    LEFT JOIN user_profiles p ON p.user_id = t.seller_id
    GROUP BY t.seller_id, u.email, p.display_name
    ORDER BY sum(t.gmv) DESC LIMIT ${ANALYTICS_TOP_LIMIT}`;

  const ledger = await ledgerInPeriod(db, range);

  const empty = {
    sales: 0,
    rentals: 0,
    gmvPaise: 0,
    commissionPaise: 0,
    signups: 0,
    activeUsers: 0,
  };
  const merged = new Map();
  const put = (rows, shape) => {
    for (const r of rows) {
      const key = day(r.bucket);
      merged.set(key, { ...(merged.get(key) ?? { bucket: key }), ...shape(r) });
    }
  };
  put(txnSeries, (r) => {
    const t = moneyTotals(r);
    return {
      sales: t.sales,
      rentals: t.rentals,
      gmvPaise: t.gmvPaise,
      commissionPaise: t.commissionPaise,
    };
  });
  put(userSeries, (r) => ({ signups: num(r.signups) }));
  put(activeSeries, (r) => ({ activeUsers: num(r.active) }));

  return {
    range: { from: range.from, to: range.to, bucket },
    totals: {
      ...moneyTotals(totals),
      refundsPaise: ledger.BUYER_REFUND ?? 0,
      depositsCollectedPaise: ledger.DEPOSIT_COLLECTED ?? 0,
      depositsRefundedPaise: ledger.DEPOSIT_REFUND ?? 0,
      depositsDeductedPaise: ledger.DEPOSIT_DEDUCTION ?? 0,
      payoutsPaise: ledger.SELLER_PAYOUT ?? 0,
      gatewayFeesPaise: ledger.GATEWAY_FEE ?? 0,
    },
    users: {
      total: num(users.total),
      new: num(users.new),
      active: num(users.active),
      inactive: num(users.inactive),
      suspended: num(users.suspended),
    },
    listings: {
      activeSale: num(listings.activeSale),
      activeRent: num(listings.activeRent),
      new: num(listings.new),
    },
    series: fillSeries(range, [...merged.values()], empty),
    categories: categories.map((r) => ({
      category: r.category,
      count: num(r.count),
      valuePaise: num(r.value),
    })),
    localities: localities.map((r) => ({
      locality: r.locality,
      count: num(r.count),
      gmvPaise: num(r.gmv),
    })),
    topSellers: topSellers.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      count: num(r.count),
      gmvPaise: num(r.gmv),
      commissionPaise: num(r.commission),
    })),
  };
}

// ---------------------------------------------------------------------------
// Seller
// ---------------------------------------------------------------------------

export async function sellerAnalytics({ db, clock }, sellerId, query) {
  const now = clock.now();
  const range = resolveRange(now, query);
  const bucket = range.bucket;

  const [totals] = await db.$queryRaw`
    WITH ${completedTxns(range, sellerId)} SELECT ${txnTotalsSql} FROM txns`;

  const txnSeries = await db.$queryRaw`
    WITH ${completedTxns(range, sellerId)}
    SELECT date_trunc(${bucket}, completed_at AT TIME ZONE ${TZ})::date AS bucket, ${txnTotalsSql}
    FROM txns GROUP BY 1 ORDER BY 1`;

  // Unique views (I15): one per signed-in person per listing per day.
  const viewSeries = await db.$queryRaw`
    SELECT date_trunc(${bucket}, v.viewed_on::timestamp)::date AS bucket, count(*) AS views
    FROM listing_views v JOIN listings l ON l.id = v.listing_id
    WHERE l.seller_id = ${sellerId}::uuid
      AND v.viewed_on >= ${range.from}::date AND v.viewed_on <= ${range.to}::date
    GROUP BY 1 ORDER BY 1`;

  const topListings = await db.$queryRaw`
    WITH views AS (
      SELECT listing_id, count(*) AS views FROM listing_views
      WHERE viewed_on >= ${range.from}::date AND viewed_on <= ${range.to}::date
      GROUP BY listing_id
    ),
    likes AS (SELECT listing_id, count(*) AS likes FROM listing_likes GROUP BY listing_id),
    sold AS (
      SELECT oi.listing_id, sum(oi.quantity) AS completed FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'COMPLETED'
        AND o.completed_at >= ${range.startAt} AND o.completed_at < ${range.endAt}
      GROUP BY oi.listing_id
      UNION ALL
      SELECT listing_id, count(*) FROM rental_bookings
      WHERE status = 'COMPLETED' AND completed_at >= ${range.startAt} AND completed_at < ${range.endAt}
      GROUP BY listing_id
    )
    SELECT l.id, l.title, l.mode::text AS mode, l.status::text AS status,
      coalesce(v.views, 0) AS views, coalesce(k.likes, 0) AS likes,
      coalesce((SELECT sum(completed) FROM sold s WHERE s.listing_id = l.id), 0) AS completed
    FROM listings l
    LEFT JOIN views v ON v.listing_id = l.id
    LEFT JOIN likes k ON k.listing_id = l.id
    WHERE l.seller_id = ${sellerId}::uuid AND l.deleted_at IS NULL
    ORDER BY coalesce(v.views, 0) DESC, coalesce(k.likes, 0) DESC, l.created_at DESC
    LIMIT ${ANALYTICS_TOP_LIMIT}`;

  const [rating] = await db.$queryRaw`
    SELECT avg(overall) AS average, count(*) AS count FROM reviews
    WHERE subject_id = ${sellerId}::uuid AND status = 'PUBLISHED'`;

  const ledger = await ledgerInPeriod(db, range, sellerId);
  const money = moneyTotals(totals);
  const views = viewSeries.reduce((total, r) => total + num(r.views), 0);
  const completed = money.sales + money.rentals;

  const merged = new Map();
  for (const r of txnSeries) {
    const t = moneyTotals(r);
    merged.set(day(r.bucket), {
      bucket: day(r.bucket),
      sales: t.sales,
      rentals: t.rentals,
      netPaise: t.sellerNetPaise,
    });
  }
  for (const r of viewSeries) {
    const key = day(r.bucket);
    merged.set(key, { ...(merged.get(key) ?? { bucket: key }), views: num(r.views) });
  }

  return {
    range: { from: range.from, to: range.to, bucket },
    totals: {
      sales: money.sales,
      rentals: money.rentals,
      gmvPaise: money.gmvPaise,
      // Gross: the seller's earnings before commission. Net: after it (I110).
      grossPaise: money.sellerNetPaise + money.commissionPaise,
      commissionPaise: money.commissionPaise,
      netPaise: money.sellerNetPaise,
      depositDeductionsPaise: money.depositDeductionsPaise,
      paidOutPaise: ledger.SELLER_PAYOUT ?? 0,
      views,
      // Completed sales and rentals per unique listing view in the period (I15).
      conversionRate: views ? Math.round((completed / views) * 10_000) / 10_000 : null,
      averageRating: rating.count > 0n ? Math.round(Number(rating.average) * 10) / 10 : null,
      ratingCount: num(rating.count),
    },
    series: fillSeries(range, [...merged.values()], {
      sales: 0,
      rentals: 0,
      netPaise: 0,
      views: 0,
    }),
    topListings: topListings.map((r) => ({
      id: r.id,
      title: r.title,
      mode: r.mode,
      status: r.status,
      views: num(r.views),
      likes: num(r.likes),
      completed: num(r.completed),
    })),
  };
}

/** CSV columns for a series, whichever metrics it has. */
export function seriesColumns(series) {
  const keys = Object.keys(series[0] ?? { bucket: '' }).filter((k) => k !== 'bucket');
  return [
    ['period starting', (r) => r.bucket],
    ...keys.map((k) => [
      k.endsWith('Paise') ? `${k.slice(0, -5)} (rupees)` : k,
      (r) => (k.endsWith('Paise') ? rupees(r[k]) : r[k]),
    ]),
  ];
}
