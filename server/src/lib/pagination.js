import { z } from 'zod';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '../config/policy.js';

/** Query-string fields shared by every list endpoint. Spread into a list's query schema. */
export const paginationQuery = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
};

/** Prisma `skip` / `take` for a page. */
export function pageWindow({ page, pageSize }) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/** The response envelope for a page of results. */
export function paged(items, total, { page, pageSize }) {
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
