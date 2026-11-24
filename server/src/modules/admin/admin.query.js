import { z } from 'zod';
import { CSV_EXPORT_MAX_ROWS, REASON_MAX_LENGTH } from '../../config/policy.js';
import { addCalendarDays, atBusinessTime } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { paged, pageWindow, paginationQuery } from '../../lib/pagination.js';
import { sendCsv, toCsv } from '../../lib/csv.js';

// Shared pieces of the admin lists: date filters in business days, free-text
// search, and `?format=csv` for a download of the same rows (SPEC Module 10).

const isoDate = z.iso.date('Use a date like 2026-11-24');

export const idParams = z.object({ id: z.uuid() });

export const listQuery = {
  ...paginationQuery,
  q: z.string().trim().max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  format: z.enum(['json', 'csv']).default('json'),
};

export const requiredReason = z.strictObject({
  reason: z
    .string('Give a reason')
    .trim()
    .min(5, 'Give a reason of at least 5 characters')
    .max(REASON_MAX_LENGTH),
});

/**
 * A Prisma date filter for `from`..`to`, both whole days in the business time zone
 * and both included. Returns undefined when neither is set.
 */
export function dayRange({ from, to }) {
  if (from && to && from > to) throw AppError.badRequest('The start date is after the end date');
  const range = {};
  if (from) range.gte = atBusinessTime(from, 0);
  if (to) range.lt = atBusinessTime(addCalendarDays(to, 1), 0);
  return from || to ? range : undefined;
}

/**
 * Answers a list request: a page of JSON, or with `format=csv` every matching row
 * (up to CSV_EXPORT_MAX_ROWS) as a download. `find(window)` loads rows, `count()`
 * counts them, `view(row)` shapes one for JSON, and `columns` shape it for CSV.
 */
export async function respondList(res, query, { find, count, view, columns, filename }) {
  if (query.format === 'csv') {
    const rows = await find({ skip: 0, take: CSV_EXPORT_MAX_ROWS + 1 });
    if (rows.length > CSV_EXPORT_MAX_ROWS) {
      res.setHeader('X-Export-Truncated', String(CSV_EXPORT_MAX_ROWS));
      rows.length = CSV_EXPORT_MAX_ROWS;
    }
    return sendCsv(res, filename, toCsv(columns, rows));
  }
  const [rows, total] = await Promise.all([find(pageWindow(query)), count()]);
  return res.json(paged(rows.map(view), total, query));
}

/** Writes one row of the append-only admin audit log, inside `tx`. */
export function writeAudit(tx, now, { adminId, action, targetType, targetId, reason, details }) {
  return tx.adminAuditLog.create({
    data: {
      adminId,
      action,
      targetType,
      targetId,
      reason,
      details: details ?? undefined,
      createdAt: now,
    },
  });
}
