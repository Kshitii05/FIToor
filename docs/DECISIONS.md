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
| I32 | Distance in search | The distance filter and "nearest first" sort arrive with locations in Step 4. Until then "Trending Near You" shows trending listings overall. | PROVISIONAL |
| I33 | Availability filter | A sale listing is available while it has stock. A rent listing counts as available until bookings exist (Step 6) to say otherwise. | PROVISIONAL |
| I34 | Popularity | Unique views by signed-in people (one per person per listing per day, I15) plus 3 for each like. Views by the seller and by signed-out visitors are not counted. | PROVISIONAL |
| I35 | Trending | Views plus weighted likes from the last 14 days. | PROVISIONAL |
| I36 | Budget-Friendly Finds | Listings whose price (or cheapest rental package) is ₹1,000 or less, most popular first. | PROVISIONAL |
| I37 | "For You" recommendations | Signals: a like counts 3, a view 1, a purchase 5 (once orders exist). Listings score by matching category (×3), brand (×2) and size (×1) of those signals. Own listings and already-liked listings are left out; with no activity, the most popular listings are shown. | PROVISIONAL |
| I38 | Keyword search | Every word must match; the last word matches by prefix ("kur" finds "kurta"); English word forms are matched ("bags" finds "bag"). No typo correction. At most 8 words. Signed-in users' last 10 keyword searches are kept as suggestions and can be cleared. | PROVISIONAL |
| I39 | Place search | City, area and PIN code search, and area names for a map point, use OpenStreetMap's Nominatim service through our server: India only, answers cached 30 days, at most one request per second, positions rounded to about 100 m before sending. What a user types is sent to OpenStreetMap; the privacy notice must say so. A paid provider may be needed at scale (launch check). | PROVISIONAL |
| I40 | Listing location | The seller places a pin (map, current position or place search) with an area name. Required for new listings. Listings without one still appear in searches without distance. | PROVISIONAL |
| I41 | What the public sees of a location | Only the centre of the ~500 m grid square the pin is in (I6), with the area name. Distances are measured from that centre and shown rounded up to the next 0.5 km (at least 0.5 km). The exact pin is shown only to the seller; sharing it with the other party of a confirmed order or booking comes with Steps 5 and 6. | PROVISIONAL |
| I42 | Where distances are measured from | A device position (rounded to about 100 m, never stored, kept out of shareable links), else a saved location named in the request, else the person's default saved location. Without any of these there are no distances, and the distance filters are refused. | PROVISIONAL |
| I43 | Saved locations | Up to 5 per person, each with a name and an area; private to the owner. The first one saved is the default; exactly one is the default; removing it passes the default to the oldest remaining one. | PROVISIONAL |
| I44 | Delivery radius in search | "Delivers to you" means the listing offers delivery and its public point is within the seller's delivery radius of the origin. Optional filter for these only. Checked again at checkout (Step 5). | PROVISIONAL |
| I45 | Trending Near You | Within 10 km of the origin when there is one; across all listings otherwise. | PROVISIONAL |
| I46 | Allowed area and map tiles | Coordinates must be inside 6–37.5° N, 68–97.5° E. Maps use OpenStreetMap's standard tiles with their credit line; a production tile provider is a launch check. | PROVISIONAL |
| I47 | Delivery address | Entered at checkout with a map pin; up to 5 saved, private to the owner. A copy is kept on the order. Delivery is refused when the pin is outside any item's delivery radius (measured from the listing's public point). | PROVISIONAL |
| I48 | What each side sees after payment | The seller sees the buyer's name, phone and delivery address; a pickup buyer sees the exact pickup pin and the seller's phone. Phone numbers and pickup pins are shown only while the order is in progress, not after it is completed, cancelled or refunded. | PROVISIONAL |
| I49 | Seller cancellation | Allowed before dispatch (or before pickup) with a recorded reason; the buyer gets a full refund and the item goes back on sale. | PROVISIONAL |
| I50 | Dispatch extension | Once per order, the seller may ask for up to 3 more business days. It applies only if the buyer accepts; declining or not answering keeps the original deadline. Dispatch deadlines apply to delivery orders only. | PROVISIONAL |
| I51 | Late or duplicate payments | A payment after the 15-minute reservation keeps the order if the stock is still free; otherwise it is refunded in full automatically. A second payment for an already paid checkout is refunded in full. | PROVISIONAL |
| I52 | Issue refunds | The admin chooses a full refund (everything not yet refunded, delivery included), a partial refund (items only, less than what is left) or rejection. No return of the item is required in the MVP. Each needs a written reason. | PROVISIONAL |
| I53 | Admin in this step | A `role` column (USER / ADMIN) and admin-only endpoints to verify delivery, cancel with refund, resolve issues and reset a handover code. Every action needs a reason and is written to the append-only admin audit log. `npm run make-admin` gives an account the role. The dashboard comes in Step 10. | PROVISIONAL |
| I54 | Order notifications | Emails for: order placed, dispatch reminder (24 h before), dispatch overdue, extension request, dispatched, delivery reported, sent to review, received, issue opened, cancelled, refunded, completed. In-app notifications come in Step 9. | PROVISIONAL |
| I55 | Payouts | This step only marks orders payout-eligible (COMPLETED: delivered, 7-day window over, nothing open). Payout batches come later. The delivery charge is part of the seller payable, since the seller arranges delivery. | PROVISIONAL |
| I56 | Cart | Up to 20 items; quantity no more than stock; sale listings only; not your own. Any signed-in person can use a cart; checkout needs a verified account (I18). | PROVISIONAL |
| I57 | Commission rounding and gateway fees | Commission is 10% of the items subtotal per seller order, rounded to the nearest paisa (halves up). Refunds recalculate it on what remains, so partial refunds add up exactly. Gateway fees are recorded as a platform cost and never charged to sellers. | PROVISIONAL |
| I58 | Buyer cancellation and pickup codes | The buyer may cancel any time before dispatch (or before pickup), as the spec allows. Pickup completes only with the buyer's 6-digit handover code; 5 wrong tries lock it until an admin resets it. | PROVISIONAL |
| I59 | Rental days and return time | Rentals run in whole calendar days (India time), start and end inclusive; a 3-day package from the 20th ends on the 22nd. The item is due back by 8 pm on the last day. Start dates can be from tomorrow up to 90 days ahead. Bookings may be back to back (one ends on the 22nd, the next starts on the 23rd); there is no gap day by default. | PROVISIONAL |
| I60 | Date holds | A request holds its dates for 24 hours; an approval extends the hold to the 12-hour payment deadline (I5). Holds are separate rows from bookings and are released on payment, decline, cancellation or expiry. Paid bookings and unreleased holds each have a database exclusion constraint. A renter may have at most 5 unpaid requests at once. Owners can close date ranges (at most 20); booked or held days cannot be closed. Public availability shows taken ranges only. | PROVISIONAL |
| I61 | Rental cancellation | Before paying (requested or approved): free, nothing charged. After paying: the renter gets 50% of the fee if cancelling before the start day, none of it from the start day; the deposit and delivery charge always come back. The owner or an admin may cancel a paid booking before handover with a full refund. After handover there is no cancellation. | PROVISIONAL |
| I62 | Rental delivery | Delivery or pickup as the listing offers. The delivery charge is paid once, for the way out; the renter returns the item in person. The exact pickup spot and phone numbers are shared only after payment, as for orders (I48). | PROVISIONAL |
| I63 | Handover and return | At handover the owner enters the renter's 6-digit code and uploads 2–8 photos; at return the renter enters the owner's code and uploads 2–8 photos (I17). Photos are stored with the time. 5 wrong codes lock it; an admin can confirm a handover or return instead, with a reason. | PROVISIONAL |
| I64 | Late fees | Worked out at the return: nothing within 24 hours of the due time, then the daily fee for each started 24 hours. The renter may dispute it until the deposit is settled; a disputed late fee is decided by an admin. The owner may report a non-return to an admin 3 days after the due time. Reminders go out about 24 hours and 8 hours before the due time, and once when it is overdue. | PROVISIONAL |
| I65 | Inspection, claims and settlement | The owner has 48 hours after the return to confirm it is fine or file a claim (description, 1–10 itemised costs, 1–8 photos). With neither, the deposit less any late fee is refunded automatically, once. The renter has 48 hours to accept or dispute a claim; disputed or unanswered claims go to an admin, who sets the damage and late fee to deduct. Deductions stop at the deposit; any excess is recorded as owed (I12). Late fees and damage go to the owner with no commission. | PROVISIONAL |
| I66 | Rental payments and ledger | Fee, deposit and delivery are paid in one gateway payment after approval and recorded apart: the deposit as "deposit collected", never as revenue; the deposit comes back as a partial refund. Commission is 10% of the fee only. Deposit collected = deposit refunded + deposit deducted. A payment that arrives after the booking expired or was cancelled, or a second payment, is refunded in full; the booking is not revived. Whether Razorpay supports this deposit flow in production is a verification gate (SPEC 17). | PROVISIONAL |
| I67 | Rental payout eligibility | A rental is payout-eligible when it is completed: the deposit settled and refunded with nothing open (I10). Accounts with unfinished rentals cannot be deleted (I16). | PROVISIONAL |
| I68 | Starting a chat | A conversation starts from a listing, an order or a rental booking the person is part of; never with oneself. Sending messages and offers needs a verified account (I18). One conversation per pair of people. | PROVISIONAL |
| I69 | Delivered and read ticks | Each person has a delivered mark and a read mark (message sequence numbers). Opening a chat marks its messages delivered; the app reports reading. Marks only move forward. | PROVISIONAL |
| I70 | Message size and photos | Up to 2,000 characters of text and up to 4 photos (JPEG, PNG or WebP, 5 MB each) per message. A message can carry a listing link. Messages are never edited or deleted. | PROVISIONAL |
| I71 | Who can offer | Offers are on sale listings only (rental prices are the owner's packages). The price per item must be from ₹1 to below the listed price; the quantity no more than is in stock. | PROVISIONAL |
| I72 | Offer timing | An open offer or counter waits 48 hours for an answer, then expires. An accepted offer can be used at checkout for 48 hours after acceptance. | PROVISIONAL |
| I73 | Offer history | One live (open or accepted) offer per buyer and listing, enforced by the database. A counter is a new offer that replaces the one it answers; the chain is kept. Only the side an offer waits on can accept, reject or counter; only its maker can withdraw it. | PROVISIONAL |
| I74 | Offers at checkout | An accepted offer sets that buyer's price per item for that listing when the cart quantity is no more than the agreed quantity; otherwise the listed price applies. The server reads the price from the offer row. A paid checkout marks the offer used. Accepting does not reserve stock. Commission is 10% of the accepted price (I8). | PROVISIONAL |
| I75 | Blocking | Either person blocking the other stops messages and offers both ways and withdraws open offers between them. Chat history stays readable. Up to 500 blocks per person. Reporting comes in Step 8. | PROVISIONAL |
| I76 | Contact details in chat | Chat never shows phone numbers or emails. Phone numbers (10 or more digits) and email addresses typed into a message are stored as [hidden] unless the two people already have a paid order or rental between them. | PROVISIONAL |
| I77 | Messaging rate limits | Counted per person and per IP address: 30 messages a minute, 10 offers or counters an hour, 20 new chats an hour, 30 blocks an hour. | PROVISIONAL |
| I78 | Live chat servers | Socket.IO runs in the single API process in the MVP. Connections need a valid access token, checked like an API request. Running several processes needs a shared adapter (Redis), a Step 11 item. | PROVISIONAL |
| I79 | One dispute flow | Every post-sale problem is a dispute of one of four kinds, about one order or one rental booking: a problem with the item (7-day window), "it did not arrive" (opened by the buyer, or by the system after 48 hours of silence), a rental deposit dispute (damage claimed by the owner and/or a late fee disputed by the renter), and "not returned". At most one unfinished dispute per order or booking (database index). The order issue and rental claim records of Steps 5 and 6 were carried over into it. | PROVISIONAL |
| I80 | Answer window and review target | The other side has 48 hours to agree or answer with evidence; answering, or 48 hours passing, sends it to an admin, with a target of 5 business days. Disputes past the target are flagged for the admin queue. | PROVISIONAL |
| I81 | When a decision takes effect | An admin decision takes effect when the 3-day appeal window ends, or straight after the appeal is decided. Until then the order or booking stays on hold and is not payout-eligible. | PROVISIONAL |
| I82 | Agreement | When the other side agrees (the seller agrees to refund, the renter accepts a claim, the owner waives a disputed late fee, the renter admits a non-return) it takes effect at once and cannot be appealed. A rental deposit dispute that mixes a damage claim with a disputed late fee cannot be agreed to or withdrawn; an admin decides it. | PROVISIONAL |
| I83 | Appeals | Either side may appeal once per dispute, with a written reason, within 3 days of the decision. An admin either upholds the decision or replaces it; that decision is final and takes effect at once. | PROVISIONAL |
| I84 | Evidence | Both sides can add text (up to 2,000 characters) and up to 5 photos per entry while the dispute is open, under review or appealed. Photos are deleted 180 days after the dispute ends (SPEC 15); the written record stays. | PROVISIONAL |
| I85 | Payout holds | An order or rental with any unfinished dispute (including one in its appeal window) is not payout-eligible. | PROVISIONAL |
| I86 | Who can review | Only the two sides of a completed order or rental, within 30 days of completion, one review each per transaction (database unique index). Reviews cannot be edited. | PROVISIONAL |
| I87 | Rating dimensions | Overall, communication and delivery/handover are always rated 1–5; the item's condition is rated too, except when a seller reviews a buyer. Optional text up to 1,000 characters and up to 4 photos. | PROVISIONAL |
| I88 | Publishing and moderation | Reviews publish at once with a verified-transaction badge. Reported reviews stay published until an admin hides them, with a reason; admins can show them again. Hidden reviews leave the averages. | PROVISIONAL |
| I89 | Reports | A person, a listing, a chat message (by the other person in that chat) or a review can be reported with a set reason (prohibited item, counterfeit, scam, harassment, inappropriate, spam, other) and optional details. One open report per reporter and target. Reporting never removes anything by itself. | PROVISIONAL |
| I90 | Report actions | An admin dismisses a report, hides the reported review, or removes the reported listing, always with a reason and an audit log entry; an action resolves every open report about the same thing. Warning and suspending users come with the admin step (Step 10). | PROVISIONAL |
| I91 | One notification service | Every notification is saved in the database first, then shown live over Socket.IO and emailed through a BullMQ queue. Orders, rentals, payments, disputes, messages, offers and reviews all use it. Browser push is out of scope. | PROVISIONAL |
| I92 | Never sent twice | Each notification has a key naming the event (for example booking:<id>:returnTomorrow:renter). The key is unique in the database, and the email job id is taken from the saved notification, so a retried job, a repeated call or a second run cannot notify twice. | PROVISIONAL |
| I93 | Deadline jobs | Deadlines keep running from the BullMQ job that repeats every minute and changes only what is still waiting (Steps 5 to 8). There is no separate delayed job per deadline, which would be a second source of truth that could drift from the database. | PROVISIONAL |
| I94 | Critical categories | Orders, rentals, payments and disputes are critical: always shown in the app and emailed, and shown as always on in the settings (SPEC Module 9). | PROVISIONAL |
| I95 | Optional categories | Messages, offers and reviews can be turned off, in the app and by email separately. The Step 1 on/off switches were replaced by these settings, with their values carried over. | PROVISIONAL |
| I96 | Message notifications | At most one per chat every 30 minutes, and none while the person has that chat open. | PROVISIONAL |
| I97 | Email retries | An email job is tried 3 times, waiting 30 seconds, then longer each time; failures are logged. Finished jobs are kept 7 days so their ids stay taken. | PROVISIONAL |
| I98 | Keeping notifications | Read notifications are deleted 90 days after they were read; unread ones are kept. | PROVISIONAL |
| I99 | Codes stay out | Sign-in, verification and password reset codes, and account deletion emails, stay direct emails and never appear in the notification list. | PROVISIONAL |

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
| OpenStreetMap place search and map tiles: usage policy, provider at scale (I39, I46) | | | |

## Change log

- 2026-11-24 — Added I91–I99 while building notifications (Module 9).
- 2026-11-24 — Added I79–I90 while building disputes, reviews and reports (Module 7).
- 2026-11-20 — Added I68–I78 while building messaging and offers (Module 8).
- 2026-11-13 — Added I59–I67 while building rentals, deposits, returns and inspection (Module 4).
- 2026-11-13 — Added I47–I58 while building cart, checkout, payments and orders (Module 3).
- 2026-11-13 — Added I39–I46 while building location discovery (Module 5).
- 2026-11-13 — Added I32–I38 while building search and recommendations (Module 6).
- 2026-11-13 — Added I26–I31 while building listings and inventory (Module 2).
- 2026-11-12 — Added I18–I25 while building accounts and profiles (Module 1).
- 2026-11-12 — Rewritten against the final specification. Former open questions are now SPEC sections 12–15; this file keeps only implementation-level defaults.
