# Acceptance checklist

Checked on 2026-11-25 against `docs/SPEC.md` sections 11, 17 and 18, at the end of Phase 1
(MVP). Every "Pass" names the automated test that proves it; all of them run with
`npm test` against a real PostgreSQL + PostGIS test database (Vitest + Supertest, with an
injectable clock so deadlines are tested exactly). Payments use Razorpay **test mode**
or the simulated gateway; live payments are disabled.

Test files are under `server/src/`. Test names are quoted as they appear in the code.

## End-to-end journeys (SPEC 10 success criterion)

| Journey | Test | Result |
|---|---|---|
| Register and verify with the real codes, list an item, find it nearby (approximate distance, no pin), chat, buy for delivery, pay (simulated gateway, signed webhook), dispatch, seller reports delivery (does not complete), buyer confirms, 7-day window passes, both review once, ledger adds up | `e2e/journeys.test.js` › "register, list, find nearby, chat, buy, pay, deliver, confirm and review" | Pass |
| List a rental, find it nearby, request (paying before approval refused), approve, pay fee and deposit together, handover with code and photos, return with code and photos, inspection fine, whole deposit refunded once, no commission on the deposit, both review | `e2e/journeys.test.js` › "list, find nearby, request, approve, pay, hand over, return, inspect, refund and review" | Pass |

## SPEC section 11 — testing and acceptance checklist

| # | Requirement | Proving tests | Result |
|---|---|---|---|
| 1 | Register, verify email/phone, log in, reset password, manage profile | `modules/auth/auth.test.js` (registration, login, tokens, refresh, logout); `modules/auth/otp.test.js` (verification, expiry, attempts, resend); `modules/auth/password.test.js` (reset); `modules/users/users.test.js` (own account); e2e purchase journey | Pass |
| 2 | Sale or rental listing, never both | `modules/listings/listings.test.js` › "sale or rent, never both" and "in the database itself" | Pass |
| 3 | Image limit, required fields, moderation status, inventory rules | `modules/listings/listing-images.test.js` ("accepts 8 photos and refuses a 9th", "the database itself refuses a 9th image", "judges the file by its contents"); `listings.test.js` (required fields, "is refused on a removed listing but allowed while under review"); `modules/admin/admin.test.js` › "listing moderation"; `modules/checkout/checkout.test.js` (stock) | Pass |
| 4 | Nearby search returns only approximate location and respects distance filters | `modules/locations/nearby.test.js` › "privacy of locations in every public list", "nearby search"; `lib/geo.test.js` | Pass |
| 5 | Multi-seller checkout creates separate seller orders | `modules/orders/playbook.test.js` › "a two-seller cart creates two seller orders; commission is 10% of items only" | Pass |
| 6 | Duplicate payment webhooks create no duplicate orders or money rows | `orders/playbook.test.js` › "the same webhook delivered 3 times creates one order and one set of ledger rows"; `rentals/rentals.test.js` › "a repeated webhook changes nothing; a second payment is refunded in full" | Pass |
| 7 | No overselling under concurrent checkouts | `orders/playbook.test.js` › "10 concurrent checkouts for a quantity-1 listing: exactly one succeeds" | Pass |
| 8 | Rental needs owner approval; confirmed dates never overlap | `rentals/playbook.test.js` › "the database refuses two overlapping paid bookings…", "of 8 renters asking for overlapping dates at the same moment, exactly one gets them"; e2e rental journey (paying before approval is refused) | Pass |
| 9 | Fee and deposit collected after approval and recorded separately | `rentals/playbook.test.js` › "paid together, recorded apart: no commission on the deposit, and it all goes back"; e2e rental journey | Pass |
| 10 | Cancellation refunds, late-fee grace, inspection deadlines | `rentals/playbook.test.js` › "3. cancellation refunds", "4. late fees", "5. missed inspection"; `orders/playbook.test.js` › "5. cancelling" | Pass |
| 11 | Only participants review; duplicates blocked | `modules/reviews/reviews.test.js` › "only after a completed transaction, once per person…", "the database refuses a second review even if two arrive at once" | Pass |
| 12 | Chat access, read receipts, offers, blocking, reporting | `modules/messaging/messaging.test.js` (who can read and write, delivery and reading, blocking, offers, live chat); `reviews/reviews.test.js` › "reports" | Pass |
| 13 | Notifications persisted; retries never duplicate them | `modules/notifications/notifications.test.js` › "never twice" (including real BullMQ on Redis) | Pass |
| 14 | Admin actions require authorization and are audit logged | `modules/admin/admin.test.js` › "every admin route refuses signed-out visitors and regular users"; `modules/admin/audit-sweep.test.js` › "every admin action without a reason is refused, and nothing is logged", "every admin action that succeeds writes exactly one row with the admin and the reason"; `orders/orders.test.js` › "admin actions need the admin role" | Pass |
| 15 | Seller and platform money figures reconcile with payments, commission, refunds and payouts | `modules/analytics/analytics.test.js` › "reconciles GMV, commission, refunds, deposits and payouts with the ledger exactly"; `orders/orders.test.js` › "payments equal commission plus seller payables, and refunds equal reversals" | Pass |

## SPEC section 18 — implementation readiness and acceptance gates

| # | Gate | Proving tests | Result |
|---|---|---|---|
| 1 | Database constraints for inventory, rental date exclusion, one review per transaction, idempotent money actions | `listings.test.js` › "in the database itself" (negative stock refused); `listing-images.test.js` (9th image refused); `rentals/playbook.test.js` (exclusion constraint); `reviews.test.js` (unique review); `checkout.test.js` › "the ledger" (append-only, unique keys); `payouts/payouts.test.js` › "the same order can never be paid out twice"; `rentals.test.js` › "the database refuses using more than the deposit" | Pass |
| 2 | Order, rental, dispute, deposit and payout state machines with audit logs and override reasons | `orders/playbook.test.js`; `rentals/playbook.test.js`; `disputes/disputes.test.js`; `payouts/payouts.test.js` › "recording payouts"; `rentals.test.js` › "booking history cannot be changed"; `admin/audit-sweep.test.js` | Pass |
| 3 | Tests for concurrent checkout, expiring rental holds, seller non-response, duplicate webhooks, refund failures, payout reconciliation | `orders/playbook.test.js` #1, #2, #9; `rentals/playbook.test.js` › "2. pending holds"; `orders/orders.test.js` › "refunds that do not go through at once"; `rentals.test.js` › "a deposit refund the gateway refuses…"; `analytics.test.js` (reconciliation); `payouts.test.js` | Pass |
| 4 | Tests for dispatch deadline, 48-hour buyer confirmation, 7-day issue reporting, 48-hour inspection, 24-hour grace, deposit release | `orders/playbook.test.js` #6, #8, #9; `rentals/playbook.test.js` #4–#7 | Pass |
| 5 | Private addresses and coordinates, backend authorization, OTP and messaging rate limits, secure image upload and deletion workflows | `nearby.test.js`; `rentals.test.js` › "location and contact privacy"; `orders.test.js` › "who can see and do what"; `auth.test.js` › "rate limiting"; `lib/rate-limits.test.js` (OTP checks, offers, reports); `messaging.test.js` › "rate limits"; `listing-images.test.js`; `users/deletion.test.js` | Pass |
| 6 | Provider and legal checks, production security review, tested backups and incident runbook before live payments | Not verifiable in code — see below | **Open** |

## Open before live payments (SPEC 18 gate 6)

These are operational and cannot be proved by tests in this repository:

- Provider and legal checks (SPEC 17 below).
- A production security review.
- Tested backups and a restore test (target RPO and RTO of 24 hours, SPEC 15).
- An incident runbook.

Live payments stay disabled until all of them are done.

## SPEC section 17 — external verification dependencies (not verifiable in code)

| Dependency | What has to be confirmed | Status |
|---|---|---|
| Razorpay | Account eligibility; refund timing and API behaviour; partial refunds; collecting and refunding rental deposits; whether Route or marketplace features are needed; gateway charges and settlement limits | Not confirmed. Built and tested against test mode and the simulated gateway only |
| India legal and tax review | GST registration and invoices, marketplace TCS/TDS, consumer protection, rental liability, data protection, financial record retention | Not confirmed |
| Bank payout operations | Permitted handling of funds, KYC and verification requirements, manual transfer procedure, accounting reconciliation | Not confirmed. The app supports manual weekly batches with verified bank details |
| Infrastructure | Managed PostgreSQL with PostGIS, Render configuration, Redis/BullMQ availability, backup retention, restore testing, security monitoring, domain and hosting costs | Not confirmed |
| Policy details | Exact start and end times of the 7-day issue window and 30-day recovery, admin appeals, holidays in the business-day calendar; clear terms for users | Implemented as recorded in `docs/DECISIONS.md` (provisional); not confirmed |
| Financial feasibility | Refund and deposit cash flow before accepting real rental payments; no claims of escrow or authorization holds | Not confirmed. The app never describes deposits as escrow |

## How to re-run

```
npm test
```

The suite creates the test database if needed and applies the migrations first.
