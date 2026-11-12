# Decisions log

## 1. Finalized decisions live in the spec

Product and operational decisions are final and recorded in `docs/SPEC.md`:

| Topic | SPEC section |
|-------|--------------|
| Financial and payment | 12 |
| Rental operations | 13 |
| Delivery and handover | 14 |
| Platform policy and operations | 15 |
| Cross-module consistency rules | 16 |

They are deliberately **not** repeated here, so there is only one source of truth. If anything in this file disagrees with the spec, the spec wins.

## 2. Implementation details the spec leaves open

These are suggested defaults so development can proceed. They are `PROVISIONAL` until the team confirms them; change the status to `FINAL` when confirmed. Each value lives in `/server/src/config` so it can be changed in one place. If work depends on something not listed here or in the spec, stop and ask, then add it here.

| ID | Question | Provisional default | Status |
|----|----------|---------------------|--------|
| I1 | Phone OTP provider | Not chosen. In development, OTPs are logged to the console behind an `OtpSender` interface so a real SMS provider can be plugged in later. | PROVISIONAL |
| I2 | OTP limits | 6 digits, 10-minute expiry, 5 attempts, resend after 60 seconds, 5 resends per hour. | PROVISIONAL |
| I3 | JWT strategy | 15-minute access token + rotating refresh token in an httpOnly cookie, tracked in `user_sessions`. | PROVISIONAL |
| I4 | Checkout inventory reservation | Stock is reserved for 15 minutes when checkout starts; released on payment failure or expiry. | PROVISIONAL |
| I5 | Payment window after rental approval | Renter has 12 hours to pay the fee + deposit; otherwise the booking expires and the dates are released. | PROVISIONAL |
| I6 | Approximate public location | Public coordinates are snapped to a roughly 500 m grid; distance is shown rounded to 0.5 km. | PROVISIONAL |
| I7 | Delivery charge for several items from one seller | The spec sets the charge per listing. For a cart with several items from the same seller, charge the highest single delivery charge among them, not the sum. | PROVISIONAL |
| I8 | Discounts and taxes | The only "discount" in the MVP is an accepted negotiated offer; the commission base is the accepted price. No coupon system and no tax calculation in the MVP (see section 3). | PROVISIONAL |
| I9 | Time and business days | Timestamps stored in UTC; deadlines evaluated in Asia/Kolkata. Business days are Monday–Friday; no public-holiday calendar in the MVP. | PROVISIONAL |
| I10 | Start of the 7-day issue window, and payout eligibility | The 7 days run from the moment delivery is confirmed (buyer confirmation or admin verification). A sale order becomes payout-eligible only after that window closes with no open issue. Rentals become payout-eligible when the deposit is settled with no open dispute. | PROVISIONAL |
| I11 | Missed dispatch deadline | After 3 business days without dispatch or a buyer-approved extension, the buyer gets a "cancel for full refund" option. It is not automatic. | PROVISIONAL |
| I12 | Damage claim larger than the deposit | Deductions through the platform are capped at the deposit. Any excess (damage or late fees) is recorded as an amount owed and handled manually by admin. | PROVISIONAL |
| I13 | Appeals | One appeal per dispute, filed within 3 days of the decision with new evidence or a reason; the appeal decision is final. Payouts and refunds for that dispute stay on hold until the appeal window closes. | PROVISIONAL |
| I14 | Seller bank details | Seller enters account holder name, account number and IFSC. Stored encrypted and shown masked. Verification is a manual admin step in the MVP. | PROVISIONAL |
| I15 | Conversion-rate denominator | Unique listing views (one per user per listing per day) in the selected period. | PROVISIONAL |
| I16 | Account deletion timing | The 30-day recovery period starts at the deletion request. Deletion is refused while the user has active orders, rentals, disputes or unpaid payouts. | PROVISIONAL |
| I17 | Rental condition photos | At least 2 timestamped photos at handover and at return, uploaded by the party handing the item over. | PROVISIONAL |
| I18 | Sign-up and login | Register with email, Indian mobile number, password and display name; log in with email + password. Unverified users can log in; modules that list, buy or rent require both email and phone to be verified. | PROVISIONAL |
| I19 | Password rules | 8 characters minimum, 72 bytes maximum (the bcrypt limit), no composition rules. | PROVISIONAL |
| I20 | Password reset | A 6-digit code emailed to the user, under the same limits as I2, rather than a reset link. A successful reset signs out every device. | PROVISIONAL |
| I21 | Refresh token lifetime | 30 days from last use. Each refresh token works once; presenting an already-used one revokes that session, except within 10 seconds of its replacement (two browser tabs refreshing together), when it is only refused. | PROVISIONAL |
| I22 | Rate limits per IP address | Login and account recovery: 10 per 15 minutes. Registration: 5 per hour. Password reset requests and attempts: 5 per hour. OTP send and verify: 30 per 15 minutes, on top of the per-user limits in I2. | PROVISIONAL |
| I23 | Email delivery | Sent through Nodemailer when `SMTP_*` is configured. No provider is chosen; in development emails are printed to the server console behind an `EmailSender` interface. | PROVISIONAL |
| I24 | Recovering a deleted account | During the 30 days, login is refused with a message saying until when the account can be recovered; submitting the email and password to the recovery endpoint reactivates it. The email and phone stay reserved until the account is erased. | PROVISIONAL |
| I25 | OTP resend count | "5 resends per hour" (I2) means the initial send plus 5 resends in any rolling hour, counted separately per channel and purpose. | PROVISIONAL |
| I26 | Listing title | Every listing has a required title of 5–80 characters, in addition to the details the spec lists. | PROVISIONAL |
| I27 | Listing photos | 1 to 8 photos; JPEG, PNG or WebP, judged by file contents; 5 MB maximum each. A listing always keeps at least one photo. | PROVISIONAL |
| I28 | Image storage without Cloudinary keys | In development, uploads are kept in `server/uploads` and served by the API. In production uploads are refused until the `CLOUDINARY_*` values are set. | PROVISIONAL |
| I29 | Listing amount limits | Price, rental package price and deposit: ₹1 to ₹5,00,000. Delivery charge: ₹0 to ₹5,000. Late fee per day: ₹0 to ₹10,000. The deposit must be above zero. Sale quantity: 1 to 99, default 1. | PROVISIONAL |
| I30 | Rental packages | 1 to 6 packages per listing, each 1–30 days, no duplicate durations. The 1/3/7-day presets are suggestions, not requirements. | PROVISIONAL |
| I31 | Fulfilment, editing and deleting | A listing offers delivery, pickup or both; delivery needs a charge and a radius of 1–50 km. The mode (sale or rent) cannot change after creation. Delete is a soft delete. A removed listing cannot be edited; one under review can. Only fully verified users can create listings (I18). | PROVISIONAL |

## 3. External verification gates

SPEC section 17 lists what is **not yet confirmed**: Razorpay eligibility and refund/deposit behaviour, India-specific legal and tax review, bank payout operations, infrastructure, and some policy timing details.

Rules while these are open:

- Build and test against Razorpay test mode only. Live payments stay disabled.
- Do not write code, UI copy or documentation that states any of these as confirmed.
- Nothing in this file is legal, tax or payment-provider advice.

| Gate | Checked by | Date | Outcome |
|------|-----------|------|---------|
| Razorpay refunds, partial refunds, deposit flow | | | |
| Legal / tax review | | | |
| Bank payout procedure | | | |
| Hosting: PostGIS, Redis, backups | | | |

## Change log

- 2026-11-13 — Added I26–I31 while building listings and inventory (Module 2).
- 2026-11-12 — Added I18–I25 while building accounts and profiles (Module 1).
- 2026-11-12 — Rewritten against the final specification. Former open questions are now SPEC sections 12–15; this file keeps only implementation-level defaults.
