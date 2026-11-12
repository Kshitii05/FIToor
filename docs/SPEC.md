# Product and Technical Specification (Final)

> **Naming:** the product name is not final. `{{APP_NAME}}` is a placeholder everywhere in this document.
> In code, the name must come from a single `APP_NAME` constant/env value; never hard-code a product name.
>
> Final specification, dated 11 November 2026. Sections 12–15 record the finalized decisions; section 17 lists items still awaiting external verification.

# 1. Executive Summary

{{APP_NAME}} is a hyperlocal peer-to-peer fashion marketplace where people can buy, sell and rent pre-loved clothing, footwear, bags and accessories from nearby users. It combines local discovery, resale, rentals, messaging, trust and safety, and transaction management in one platform.

The product uses one account per person. A user can act as a buyer, seller, renter or owner without creating separate accounts. {{APP_NAME}}'s central value proposition is making fashion more accessible and circular by helping users discover nearby items for purchase or temporary use.

## Product vision

Make fashion discovery more local, affordable and reusable by connecting people who have fashion items to offer with people who want to buy or rent them.

## Selected differentiators

- Hyperlocal marketplace discovery using location-aware search and map/list views.

- Both sale and rental listings, with distinct workflows and financial rules.

- Integrated buyer–seller messaging and structured price negotiation.

- Outfit Builder (planned Phase 2).

- Conversational AI Search (planned Phase 3).

# 2. Product Scope

## Core user journeys

1.  A user registers, verifies their email and phone, and completes a public profile.

2.  A seller creates a sale or rental listing, uploads photos and manages its availability.

3.  A buyer discovers nearby listings, adds items from multiple sellers to a cart, checks out and pays.

4.  A renter selects an owner-defined rental package, requests dates, receives owner approval, pays the rental fee and deposit, and completes handover and return.

5.  Users communicate through {{APP_NAME}} chat, negotiate prices where supported, and receive transaction updates.

6.  After a completed transaction, eligible participants can review one another.

7.  Admins moderate users and listings, intervene in disputes, manage refunds and payouts, and view platform analytics.

## Listing types

| **Type** | **Rule**                                                                                                                          |
|----------|-----------------------------------------------------------------------------------------------------------------------------------|
| Sale     | A listing is for sale only. It has a selling price and quantity; quantity defaults to 1 for a pre-loved item.                     |
| Rent     | A listing is for rent only. It has owner-defined rental packages, a mandatory refundable security deposit and availability dates. |

A single listing cannot be both for sale and for rent. A seller who wants to offer the same item under both models must create separate listings, subject to inventory and operational controls.

# 3. Confirmed Technology Stack

| **Layer**             | **Technology / service**        | **Purpose**                                                                    |
|-----------------------|---------------------------------|--------------------------------------------------------------------------------|
| Frontend              | React + Vite                    | Single-page web application.                                                   |
| UI                    | Tailwind CSS, Framer Motion     | Styling, responsive interface and motion.                                      |
| Backend               | Node.js + Express.js            | REST API and business logic.                                                   |
| Database              | PostgreSQL                      | Relational transactional data.                                                 |
| ORM                   | Prisma                          | Database access and schema management.                                         |
| Geospatial            | PostGIS                         | Nearby search, radius filtering and distance calculations.                     |
| Payments              | Razorpay                        | Checkout, payment verification and refunds, subject to supported capabilities. |
| Images                | Cloudinary + Multer             | Image upload and storage.                                                      |
| Realtime              | Socket.IO                       | Chat and live notification delivery.                                           |
| Maps                  | Leaflet + OpenStreetMap         | Interactive map discovery.                                                     |
| Location              | Browser Geolocation API         | Permission-based current location.                                             |
| Background jobs       | BullMQ + Redis                  | Scheduled reminders, retries and asynchronous tasks.                           |
| Email                 | Nodemailer + email provider     | Verification and transactional email.                                          |
| Push                  | Web Push API                    | Browser push notifications.                                                    |
| Charts                | Recharts                        | Seller and platform analytics.                                                 |
| Testing               | Postman                         | API testing.                                                                   |
| Version control       | Git + GitHub                    | Source control and collaboration.                                              |
| Deployment (proposed) | Vercel frontend; Render backend | Initial hosting approach.                                                      |

# 4. Functional Requirements by Module

## Module 1 — User Accounts and Profiles

- Single account with role switching; buying, selling and renting are capabilities/modes, not separate accounts.

- Registration, login, logout and password reset.

- Email and phone OTP verification, including OTP expiry, resend limits and attempt limits.

- JWT-based authentication; passwords hashed using bcrypt.

- Public profile includes display name, profile photo, ratings, listings and approximate location.

- Users can update profile details, photos and notification preferences.

- Dashboard combines purchases, sales and rental bookings.

- Backend enforces authorization, role checks and resource ownership; hiding frontend controls is not sufficient.

- Exact home address is never publicly displayed.

## Module 2 — Product Listings and Inventory

- Categories: Ethnic wear, Western wear, Footwear, Accessories, Bags and Formal wear.

- Condition values: New, Good and Fair.

- Up to 8 images per listing.

- Required details: brand, size, colour, condition, description and price.

- Sale listing: selling price and quantity; default quantity is 1 for pre-loved clothing.

- Rental listing: rental package prices, mandatory security deposit and availability.

- Seller can create, edit, pause, activate and delete listings.

- Listings are published automatically, with user reporting and admin moderation.

- Moderation/listing statuses include active, under_review and removed.

- Sold inventory becomes unavailable. Rental availability is controlled by bookings, returns, inspection and disputes.

- Use Cloudinary for images and Multer for upload handling; persist listing and inventory records in PostgreSQL.

## Module 3 — Buying, Checkout and Payments

- Multi-seller cart is supported.

- Checkout supports home delivery and local pickup.

- Payment methods planned: UPI, debit/credit cards, net banking and wallets, subject to gateway availability.

- Razorpay is the selected payment gateway.

- A parent checkout can create separate seller-specific orders so each seller can fulfil independently.

- Backend verifies payment status and securely verifies Razorpay webhooks.

- Implement idempotency and duplicate-event handling to prevent duplicate orders, payments or refunds.

- Reserve/lock inventory during checkout to prevent two buyers purchasing the same item.

- Cancellation of sale orders is allowed before seller dispatch; refunds go to the original payment method.

- Track payments, refunds, commissions, seller earnings and payouts separately.

- Do not assume a standard Razorpay checkout automatically performs marketplace split payouts; verify Route/marketplace eligibility and capabilities.

## Module 4 — Rental Management

- Owners define fixed rental packages and prices; renters choose from the packages offered by the owner.

- Owner approval is required for every rental booking.

- A mandatory refundable security deposit is set by the owner.

- Both local pickup and home delivery are supported.

- Owner confirms return and inspects the item.

- Late fee is owner-defined per day, with a 24-hour grace period.

- Cancellation before owner approval is free with a full rental-fee refund.

- Cancellation after approval but before rental start receives a 50% rental-fee refund.

- Cancellation after rental start receives no rental-fee refund.

- Security deposit is settled separately from the rental fee and platform revenue.

- Rental availability must prevent overlapping confirmed bookings. Pending requests should temporarily hold dates for a limited period; rejected/expired holds are released.

- Damage deductions require evidence and must support renter dispute and admin resolution.

- Rental payment and deposit are collected together after owner approval.

- Deposit inspection deadline is 48 hours after return. If there is no damage or dispute, refund is due within 3 business days after inspection.

- Do not assume Razorpay supports escrow or a true authorization hold for the deposit; verify the available collection/refund mechanism.

## Module 5 — Location-Based Discovery

- Location can be obtained through GPS permission or selected manually.

- Distance filters: 2 km, 5 km, 10 km, 25 km and 50 km.

- Both list and interactive map views are supported.

- Public display shows approximate location and distance; exact address is shared only after a relevant booking/order is confirmed and it is necessary for fulfilment.

- Seller defines a delivery radius.

- Location search supports city, area/locality, PIN code and distance from current location.

- Users can save preferred locations and update them.

- Use PostGIS geography(Point, 4326), ST_Distance, ST_DWithin and GiST indexes.

- Keep discovery coordinates separate from private delivery addresses. Public APIs must not expose exact residential coordinates.

- Leaflet + OpenStreetMap provides map rendering; browser Geolocation API provides user location.

## Module 6 — Product Discovery, Search and Recommendations

- Keyword search with autocomplete and suggestions.

- Filters: category, price range, size, brand, colour, condition, sale/rent, distance and availability.

- Sort options: price low-to-high, price high-to-low, nearest first, newest first and most popular.

- Homepage sections: Trending Near You, Recently Listed, Budget-Friendly Finds, Rent for an Occasion and For You.

- Personalized recommendations initially use browsing activity, likes and purchase history with a rule-based weighted approach.

- Use PostgreSQL full-text search, indexed autocomplete, Prisma SQL filtering and PostGIS distance queries.

- Exclude unavailable, removed or otherwise ineligible listings from recommendations.

- Conversational AI search is planned for Phase 3, not required for the initial MVP.

## Module 7 — Reviews, Ratings, Trust and Safety

- Only participants in completed purchases or rentals can review.

- Both parties can review each other.

- Rating dimensions: overall experience, product condition, communication and delivery/handover.

- Reviews include 1–5 star ratings, written feedback and optional photographs.

- Exactly one review per participant per transaction.

- Verified-transaction badge is tied to a completed transaction.

- Automatic review publishing is supported, with user reporting and admin moderation.

- Safety actions: report user, report listing, block user, report inappropriate messages and dispute resolution.

- Reported reviews enter moderation; reporting does not automatically delete them.

- Rental inspection should support before/after photos, damage reports, evidence-based deposit deductions and disputes.

## Module 8 — Messaging and Communication

- Users can chat before and after transactions.

- One conversation per buyer–seller pair, rather than a separate conversation per product.

- Messages can reference a product or transaction.

- Real-time chat uses Socket.IO with JWT-authenticated connections.

- Attachments: images and product links; images stored through Cloudinary.

- Structured price negotiation: buyer sends offer; seller accepts, rejects or counteroffers; offer history is retained.

- Accepted offers can be linked to the relevant product and checkout.

- Both delivery and read receipts are supported.

- Hide personal phone numbers and email addresses; provide reporting and blocking controls.

- Implement pagination, authorization, rate limiting and blocking enforcement.

## Module 9 — Notifications and Reminders

- Channels: in-app notifications, email and browser push.

- Important events are sent instantly.

- Rental reminders: booking confirmation, one day before return, on return date, overdue reminder, and booking approval/rejection.

- Users can enable/disable optional notifications.

- Notification center includes unread count, read/unread state and notification history.

- Critical account, payment and security notifications cannot be silently disabled as optional messages.

- Persist notifications in PostgreSQL; use Socket.IO for live delivery, BullMQ + Redis for jobs/retries, Nodemailer for email and Web Push API for browser push.

- Deduplicate background jobs and delivery retries.

## Module 10 — Admin Dashboard and Platform Management

- One Super Admin has complete platform access.

- User management: view/search/filter profiles, suspend/ban, restore and inspect transaction history.

- Listing moderation: remove and restore listings; suspend sellers.

- Order/rental management: monitor transactions and bookings and intervene when needed.

- Financial operations: view payments, manage refunds, view commissions and seller payouts, and monitor deposit settlements.

- Analytics: total/active users, sale/rental listings, orders/completed rentals, platform revenue/commissions, popular categories and location-wise activity.

- Separate protected admin routes; backend authorization and audit logs.

- Support pagination, search, date filters, CSV export and confirmation for destructive/financial actions.

- Even with one Super Admin, enforce permissions on the backend.

## Module 11 — Analytics and Reporting

- Seller metrics: total sales, total rental bookings, gross/net earnings, commission deductions, product views, popular listings, average rating and conversion rate.

- Every seller receives an analytics dashboard.

- Platform metrics: user growth, active/inactive users, sales/rental trends, GMV, platform commission revenue, popular categories, location-wise demand, average transaction value and top-performing sellers.

- Interactive charts with date-range filters.

- Exports: CSV and PDF.

- Use Recharts and PostgreSQL aggregation through Prisma.

### Metric definitions

- GMV: total value of completed transactions before commission.

- Platform revenue: earned commissions/fees; security deposits are excluded.

- Seller net earnings: gross eligible earnings minus commission and applicable deductions.

- Conversion rate: completed purchases/bookings divided by relevant listing views for the selected period; define the denominator consistently in implementation.

# 5. Advanced Features Selected

## Outfit Builder — Phase 2

- Combine clothing, footwear and accessories from multiple sellers into one outfit/collection.

- Filter items by budget and location.

- Display total outfit price and check item availability.

- Allow users to save and share collections.

Outfit Builder is a selected advanced feature, but it is not required for the first MVP release.

## Conversational AI Search — Phase 3

- Accept natural-language shopping requests.

- Extract intent and structured filters such as budget, category, occasion, size and distance.

- Translate the request into structured queries against {{APP_NAME}} listings.

- Explain why matching items were returned and support follow-up refinements.

The AI search layer should query the existing marketplace data and must not invent product availability, prices or listing attributes.

# 6. Business Rules and Financial Decisions

| **Area**                                         | **Final decision**                                                       |
|--------------------------------------------------|--------------------------------------------------------------------------|
| Sale commission                                  | 10% of successful sale value.                                            |
| Rental commission                                | 10% of successful rental value.                                          |
| Seller payout timing                             | After successful delivery or rental completion.                          |
| Payout method                                    | Manual bank transfers initially; automate later.                         |
| Payment gateway                                  | Razorpay.                                                                |
| Gateway processing fees                          | {{APP_NAME}} bears the gateway charges as an operating expense.                  |
| Sale cancellation                                | Allowed before seller dispatch; refund to original payment method.       |
| Rental payment timing                            | Rental fee and security deposit collected together after owner approval. |
| Rental cancellation before approval              | Full rental-fee refund.                                                  |
| Rental cancellation after approval, before start | 50% rental-fee refund.                                                   |
| Rental cancellation after start                  | No rental-fee refund.                                                    |
| Late fee                                         | Owner-defined fixed fee per overdue day.                                 |
| Late grace period                                | 24 hours.                                                                |
| Deposit inspection                               | Owner has 48 hours after return.                                         |
| Deposit refund                                   | Within 3 business days after inspection if no damage/dispute.            |
| Delivery responsibility                          | Seller arranges delivery independently.                                  |
| Delivery charge                                  | Seller sets the delivery charge.                                         |
| Fulfilment options                               | Home delivery and local pickup.                                          |

## Commission examples

- Sale example: ₹2,000 sale value → ₹200 {{APP_NAME}} commission and ₹1,800 seller gross share, before any other applicable adjustments.

- Rental example: ₹1,000 rental value → ₹100 {{APP_NAME}} commission and ₹900 owner gross share, before any other applicable adjustments.

The exact commission base (for example, whether it excludes delivery charges, taxes or other add-ons) remains to be specified. Gateway charges are borne by {{APP_NAME}} and should not be deducted again from the seller as a separate gateway fee.

## Financial safeguards

- Keep rental deposits separate from rental revenue and commission calculations.

- Track payment, refund, commission, seller payable, payout and deposit settlement as distinct ledger concepts.

- Use webhook signature verification, idempotency keys, reconciliation and audit trails.

- Do not describe the deposit as escrow or held funds unless the payment provider contractually supports that arrangement.

- Document the payout and refund process, including failed transfers and reconciliation exceptions.

# 7. Proposed Data Model

The following is a proposed logical table inventory. Exact columns, constraints, indexes, enum values and Prisma relations should be designed during schema implementation.

| **Domain**       | **Proposed tables / entities**                                                                                                                                                                |
|------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Identity         | users, user_profiles, user_verifications, user_sessions, user_preferences, addresses                                                                                                          |
| Listings         | products/listings, product_images, product_categories, product_inventory, listing_moderation                                                                                                  |
| Discovery        | search_history, user_activity, product_views, product_likes, saved_locations                                                                                                                  |
| Cart and orders  | carts, cart_items, checkouts, orders, order_items, fulfilments, delivery_events                                                                                                               |
| Payments         | payments, payment_events, refunds, commissions, seller_payouts, financial_ledger                                                                                                              |
| Rentals          | rental_packages, rental_bookings, rental_availability, rental_date_holds, rental_transactions, security_deposits, rental_returns, rental_inspections, rental_damage_reports, rental_late_fees |
| Communication    | conversations, conversation_participants, messages, message_attachments, message_receipts, price_offers                                                                                       |
| Trust and safety | reviews, review_photos, review_ratings, reports, blocked_users, disputes, dispute_evidence, dispute_resolutions                                                                               |
| Notifications    | notifications, notification_preferences, push_subscriptions, notification_delivery_logs                                                                                                       |
| Administration   | admin_users, admin_roles, admin_permissions, admin_audit_logs, moderation_actions                                                                                                             |

## Important database constraints

- A listing must have exactly one listing mode: sale or rent.

- Prevent overlapping confirmed rental bookings for the same rentable item using database-level constraints/transaction-safe logic.

- Use unique constraints for one review per participant per transaction.

- Use transaction boundaries and inventory reservation to prevent overselling.

- Use PostGIS geography columns and GiST indexes for efficient radius and distance search.

- Keep private delivery addresses and exact coordinates out of public listing/profile responses.

# 8. API and Backend Design Guidance

Use versioned REST endpoints (for example, /api/v1) organized by domain. The exact endpoint list and request/response contracts are to be designed during implementation.

| **API group**      | **Responsibilities**                                                                                                        |
|--------------------|-----------------------------------------------------------------------------------------------------------------------------|
| Auth and users     | Registration, login, OTP verification, password reset, profile and preferences.                                             |
| Listings           | Create/edit/pause/activate listings, images, inventory and moderation status.                                               |
| Discovery          | Keyword search, filters, sorting, nearby listings, map results and recommendations.                                         |
| Cart and checkout  | Cart operations, stock reservation, checkout creation and order splitting by seller.                                        |
| Payments           | Payment order creation, verification, webhooks, refunds and reconciliation.                                                 |
| Rentals            | Packages, availability, booking requests, approval/rejection, payment, handover, return, inspection and deposit settlement. |
| Messaging          | Conversations, messages, attachments, receipts, offers and negotiation.                                                     |
| Reviews and safety | Reviews, reports, blocks, disputes, evidence and resolutions.                                                               |
| Notifications      | Notification history, preferences, push subscription and delivery status.                                                   |
| Admin              | User/listing moderation, orders/rentals, financial actions, audit logs and analytics.                                       |
| Analytics          | Seller dashboards, platform reports, date filters and exports.                                                              |

## Backend implementation principles

- Validate all request data on the server.

- Enforce authentication, authorization, ownership and role rules at the API layer.

- Use database transactions for checkout, booking confirmation, payment state transitions and financial updates.

- Verify payment webhooks cryptographically and make handlers idempotent.

- Use pagination and filtering for listing, message, admin and report endpoints.

- Use rate limits for authentication, OTP, messaging, offers and reporting.

- Never trust client-provided prices, commission amounts, payment status or user roles.

# 9. Security, Privacy and Reliability

- Hash passwords with bcrypt and use short-lived/appropriately managed JWTs.

- Apply OTP expiry, resend throttling and attempt limits.

- Protect admin APIs with backend authorization and audit every sensitive action.

- Validate and restrict uploaded image types/sizes; store media in Cloudinary.

- Do not expose exact home addresses or precise residential coordinates publicly.

- Protect chat and Socket.IO rooms with authentication and participant authorization.

- Use secure secrets management and separate development/staging/production configuration.

- Implement payment webhook verification, idempotency, reconciliation and immutable audit records for financial events.

- Use database constraints and transaction-safe logic for stock and rental availability.

- Create backups, monitor job failures and maintain logs for payment, notification and payout workflows.

# 10. MVP and Phased Roadmap

## Phase 1 — Core marketplace MVP

- Authentication and profiles.

- Sale/rental listings, images and inventory.

- Search, filters, sorting and basic recommendations.

- Multi-seller cart, checkout, Razorpay payment and seller-specific orders.

- Rental packages, owner approval, deposit collection, return and basic inspection.

- Nearby discovery using PostGIS, list/map views and location privacy.

- Reviews, reporting, blocking and basic dispute handling.

- Real-time chat and basic price negotiation.

- In-app/email notifications and essential rental reminders.

- Super Admin management and basic seller/platform dashboards.

MVP success criterion: a user can register, list an item, discover a nearby item, buy or rent it, pay, communicate and complete the transaction.

## Phase 2 — Advanced marketplace

- Outfit Builder.

- More complete rental inspection, damage evidence and dispute workflows.

- Browser push notifications.

- Advanced seller analytics and PDF exports.

- Automated payout workflows, subject to payment provider capability and approval.

## Phase 3 — Intelligent shopping

- Conversational AI Search with natural-language interpretation, structured filters and follow-up refinements.

## Suggested development sequence

1.  Project foundation: repository, environment setup, PostgreSQL, Prisma, authentication and shared UI.

2.  Profiles, listing creation, image upload and inventory.

3. Search, filters, sorting and recommendations.

4. Cart, checkout, Razorpay integration, order management and sale fulfilment.

5. Rental packages, booking approvals, deposits, returns, late fees and inspection.

6. PostGIS nearby search, privacy-safe location APIs and map interface.

7. Messaging, offers, reviews, reporting and dispute workflows.

8. Notifications, admin dashboard, seller analytics and platform reports.

9. Outfit Builder, then Conversational AI Search.

10. End-to-end testing, security review, deployment and monitoring.

# 11. Testing and Acceptance Checklist

- A user can register, verify email/phone, log in, reset password and manage profile.

- A user can create either a sale listing or a rental listing, but not both in one listing.

- Listing image limit, required fields, moderation status and inventory rules are enforced.

- Nearby search returns only privacy-safe approximate location data and respects distance filters.

- A multi-seller checkout creates correctly separated seller orders.

- Duplicate payment webhooks do not create duplicate orders or financial entries.

- Stock cannot be oversold under concurrent checkout attempts.

- A rental booking requires owner approval and prevents overlapping confirmed dates.

- Rental fee and deposit are collected after approval and recorded separately.

- Cancellation refund rules, late fee grace period and deposit inspection deadlines are applied correctly.

- Only eligible transaction participants can review, and duplicate reviews are blocked.

- Chat access, read receipts, offers, blocking and reporting work correctly.

- Notifications are persisted and retries do not create duplicate user-visible notifications.

- Admin actions require authorization and are audit logged.

- Seller and platform financial metrics reconcile with payment, commission, refund and payout records.

# 12. Finalized Decisions — Financial and Payment

| Decision            | Final policy                                                                                                                                                                       |
|---------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Commission          | 10% of discounted sale-item or rental-fee subtotal only. Exclude delivery, refundable security deposits and separately stated taxes.                                               |
| Seller payout       | Weekly manual bank-transfer batches, target processing within 3 business days for payout-eligible transactions; unresolved disputes remain on hold.                                |
| Seller verification | Verify bank details and account ownership before payout; collect additional identity/KYC information where legally or provider-required.                                           |
| Failed payout       | Mark failed, notify seller, verify bank details, retry with idempotent payout references and reconciliation/audit trail.                                                           |
| Payment gateway     | Razorpay standard checkout with manual seller payouts initially; verify supported refunds and rental-deposit flows before launch. Do not assume escrow or automated split payouts. |

# 13. Finalized Decisions — Rental Operations

| Decision               | Final policy                                                                                                                                                                                                              |
|------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Pending booking        | Temporarily hold requested dates for 24 hours while awaiting owner response; expire/release holds automatically if not approved. Confirmed bookings must not overlap.                                                     |
| Rental packages        | Owner-defined packages with suggested 1-, 3- and 7-day presets plus custom durations/prices.                                                                                                                              |
| Damage claims          | Require before/after photos, description and itemized claimed costs; renter can respond; admin resolves contested deductions.                                                                                             |
| Dispute deadlines      | Renter response window 48 hours; admin target resolution within 5 business days; appeal/escalation within 3 days of decision.                                                                                             |
| Inspection expiry      | If owner misses 48-hour post-return inspection deadline without a timely documented claim or active dispute, automatically initiate full deposit refund.                                                                  |
| Late fees              | Owner-defined daily amount; 24-hour grace period; charge each started 24-hour period after grace. Disclose calculation at booking.                                                                                        |
| Late fees from deposit | May deduct itemized late fees from deposit subject to renter dispute; collect excess separately.                                                                                                                          |
| Deposit mechanism      | Collect rental fee and deposit together after approval, account separately, and refund eligible deposit through a verified supported gateway mechanism. Refund due within 3 business days after inspection if undisputed. |

# 14. Finalized Decisions — Delivery and Handover

| Decision               | Final policy                                                                                                                       |
|------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| Dispatch record        | Seller manually updates status; courier/tracking reference and dispatch evidence are optional.                                     |
| Delivery verification  | Buyer confirms receipt; if unresponsive, use evidence-based admin fallback, not automatic payout.                                  |
| Pickup                 | Transaction-specific one-time handover code.                                                                                       |
| Delivery charge        | Seller sets per-listing delivery charge and radius; display charge before checkout.                                                |
| Loss/damage in transit | Seller bears responsibility until verified delivery; hold payout and resolve evidence-based claim.                                 |
| Dispatch SLA           | Dispatch within 3 business days or obtain buyer-approved extension; otherwise cancellation/refund may be initiated.                |
| Receipt window         | Buyer has 48 hours after recorded delivery to confirm or report issue; unresolved cases go to admin review.                        |
| Rental handover/return | Use transaction-specific handover and return codes plus timestamped condition photos, with admin fallback for failed confirmation. |

# 15. Finalized Decisions — Platform Policy and Operations

| Decision            | Final policy                                                                                                                                                                                                                                                   |
|---------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Sale issues         | Within 7 days after delivery, buyer may report wrong, damaged or materially misdescribed items. Admin reviews evidence for full/partial refund. No general change-of-mind return entitlement is created by this policy; applicable legal rights still prevail. |
| Refund initiation   | Initiate approved refunds within 3 business days; actual settlement depends on provider/payment method.                                                                                                                                                        |
| Compliance          | Review GST, applicable TCS/TDS, invoicing, consumer protection, privacy and marketplace/payment obligations before live payments.                                                                                                                              |
| General disputes    | Acknowledge within 24 hours and target resolution within 5 business days; urgent safety/payment matters prioritized.                                                                                                                                           |
| Dispute evidence    | Retain 180 days after resolution unless legal hold, fraud investigation or applicable law requires longer.                                                                                                                                                     |
| Prohibited listings | Fashion-only marketplace. Prohibit counterfeit, stolen, illegal, unsafe and otherwise prohibited items; reporting, warnings, removals and suspensions.                                                                                                         |
| Account deletion    | Self-service deletion request; deactivate account and allow 30-day recovery, then erase/anonymize eligible data subject to outstanding transactions and legal retention.                                                                                       |
| Financial retention | Apply legally required retention schedules, to be established by jurisdiction-specific review.                                                                                                                                                                 |
| Deployment          | Vercel frontend, Render backend, managed PostgreSQL with PostGIS; verify Redis, region, pricing, capacity and operational support.                                                                                                                             |
| Reliability         | Daily backups and error monitoring; target RPO \<=24 hours and RTO \<=24 hours, subject to validated infrastructure and restore tests.                                                                                                                         |

# 16. Cross-Module Consistency and Implementation Rules

- Pre-dispatch cancellation and post-delivery issue refunds are distinct flows. A seven-day issue window does not replace the pre-dispatch cancellation rule.

- Weekly seller payout batches include only completed, verified, undisputed transactions. Delivery disputes, rental inspections and outstanding claims block payout eligibility.

- Pending rental date holds expire after 24 hours; approved bookings are distinct confirmed inventory reservations. Use transaction-safe non-overlap enforcement.

- At 48 hours after rental return, refund initiation is automatic only if no timely claim or active dispute exists. Do not release funds twice.

- Late-fee rounding starts after the 24-hour grace period; the first started additional 24-hour period incurs one daily fee.

- Commission is calculated on the discounted item/rental subtotal; shipping, deposits and separately stated taxes are excluded. Refunds and discounts must reverse/reconcile commissions as appropriate.

- Buyer confirmation or documented admin review determines successful delivery; seller marking delivered alone is insufficient.

- Account deletion must preserve only records required for legal, financial, fraud or active dispute obligations; privacy notices must explain exceptions.

- Use immutable financial event records, idempotent webhooks/refunds, and separate ledger entries for deposits, commissions, seller payables and transfers.

- All operational deadlines require consistent timezone, business-day calendar, notification, expiration and admin override handling.

# 17. External Verification Dependencies — Not Yet Confirmed

- Razorpay: account eligibility; refund timing and API behavior; partial refunds; rental deposit collection/refund feasibility; whether marketplace/Route functionality is available if needed; gateway charges and settlement limitations.

- India-specific legal/tax review: GST registration and invoice rules, marketplace TCS/TDS obligations where applicable, consumer protection, rental liability, data protection and financial-record retention.

- Bank payout operations: permissible handling of funds, verification/KYC requirements, manual transfer procedures and accounting reconciliation.

- Infrastructure: managed PostgreSQL/PostGIS compatibility, Render service configuration, Redis/BullMQ availability, backup retention, restore testing, security monitoring, domain and hosting costs.

- Policy implementation details: precise start/end timestamps for the seven-day issue window, 30-day account recovery, admin appeals and holidays/business-day computation; disclose terms clearly to users.

- Financial feasibility: validate refund and deposit cash-flow mechanics before allowing real rental payments; do not advertise escrow or authorization holds without contractual support.

# 18. Implementation Readiness and Acceptance Gates

- Implement database constraints for inventory, rental date exclusion, one-review-per-transaction and idempotent financial actions.

- Build explicit order, rental, dispute, deposit and payout state machines with audit logs and admin override reasons.

- Test concurrent checkout, expiring rental holds, seller non-response, duplicate webhooks, refund failures and payout reconciliation.

- Test dispatch deadline, buyer 48-hour confirmation, 7-day issue reporting, 48-hour inspection, 24-hour grace and deposit release edge cases.

- Enforce private addresses/coordinates, backend authorization, OTP and messaging rate limits, secure image upload and deletion workflows.

- Complete provider/legal checks, production security review, tested backups and incident runbook before accepting live payments.

Status: Product and operational choices from Rounds 1–4 are approved. External legal, provider and hosting dependencies above remain verification gates, not finalized claims. This document supersedes the original Section 12 open-decision list; Sections 1–11 remain the baseline requirements except where clarified here.
