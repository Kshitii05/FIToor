import { Router } from 'express';
import { requireVerified } from '../../lib/auth.js';
import { sendCsv, toCsv } from '../../lib/csv.js';
import { rangeQuery, sellerAnalytics, seriesColumns } from '../analytics/analytics.service.js';
import { bankAccountInput, getOwnBankAccount, saveOwnBankAccount } from './bank.service.js';
import { sellerPayouts } from './payouts.service.js';

/** `/me/bank-account`: the seller's own payout details, always masked. */
export function createBankAccountRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth);
  router.get('/', async (req, res) =>
    res.json({ bankAccount: await getOwnBankAccount(deps, req.auth.userId) }),
  );
  router.put('/', requireVerified, async (req, res) =>
    res.json({
      bankAccount: await saveOwnBankAccount(
        deps,
        req.auth.userId,
        bankAccountInput.parse(req.body ?? {}),
      ),
    }),
  );
  return router;
}

/** `/me/payouts`: what the seller was paid, what is on its way and what is held. */
export function createMyPayoutsRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth);
  router.get('/', async (req, res) => res.json(await sellerPayouts(deps, req.auth.userId)));
  return router;
}

/** `/me/analytics`: every seller's own dashboard figures (SPEC Module 11). */
export function createMyAnalyticsRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth);
  router.get('/', async (req, res) => {
    const query = rangeQuery.parse(req.query);
    const result = await sellerAnalytics(deps, req.auth.userId, query);
    if (query.format === 'csv') {
      return sendCsv(
        res,
        `my-sales-${result.range.from}-to-${result.range.to}.csv`,
        toCsv(seriesColumns(result.series), result.series),
      );
    }
    return res.json(result);
  });
  return router;
}
