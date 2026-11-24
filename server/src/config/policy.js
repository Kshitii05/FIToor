// Policy values: every deadline, limit and rate lives here as a named value.
// Sources are noted per group. Values marked PROVISIONAL follow docs/DECISIONS.md
// and may change; change them here only.

// Time and calendar (DECISIONS I9, PROVISIONAL)
export const BUSINESS_TIME_ZONE = 'Asia/Kolkata';
// ISO weekday numbers: 1 = Monday ... 7 = Sunday. No public-holiday calendar in the MVP.
export const BUSINESS_WEEKDAYS = Object.freeze([1, 2, 3, 4, 5]);

// Money (SPEC 6 / 16). Basis points: 1000 = 10% of the discounted item or rental-fee subtotal.
export const COMMISSION_RATE_BPS = 1000;

// Sales
export const DISPATCH_DEADLINE_BUSINESS_DAYS = 3; // DECISIONS I11
export const ISSUE_REPORT_WINDOW_DAYS = 7; // SPEC 16, DECISIONS I10
export const CHECKOUT_RESERVATION_MINUTES = 15; // DECISIONS I4 (PROVISIONAL)

// Rentals (SPEC 16)
export const RENTAL_PENDING_HOLD_HOURS = 24;
export const RENTAL_PAYMENT_WINDOW_HOURS = 12; // DECISIONS I5 (PROVISIONAL)
export const DEPOSIT_AUTO_REFUND_AFTER_RETURN_HOURS = 48;
export const LATE_FEE_GRACE_HOURS = 24;
export const LATE_FEE_PERIOD_HOURS = 24; // each started period after the grace is charged
export const RENTAL_CONDITION_PHOTOS_MIN = 2; // DECISIONS I17 (PROVISIONAL)
export const RENTAL_CONDITION_PHOTOS_MAX = 8;
export const CLAIM_RESPONSE_HOURS = 48; // SPEC 13: renter answers a damage claim
// Rental cancellation after payment (SPEC Module 4): share of the fee refunded.
export const RENTAL_REFUND_BPS_BEFORE_START = 5000; // before the start day: 50%
export const RENTAL_REFUND_BPS_FROM_START = 0; // on or after the start day: nothing
// DECISIONS I59 onwards (PROVISIONAL)
export const RENTAL_RETURN_HOUR = 20; // due back by 8 pm (business time) on the last day
export const RENTAL_BOOKING_WINDOW_DAYS = 90; // start dates from tomorrow up to this far ahead
export const RENTAL_OPEN_REQUESTS_MAX = 5; // unpaid requests a renter may have at once
export const RENTAL_NON_RETURN_REPORT_DAYS = 3; // owner may report non-return this long after due
export const RENTAL_RETURN_REMINDER_HOURS = 24; // "one day before return" reminder
export const RENTAL_DUE_DAY_REMINDER_HOURS = 8; // "on the return date" reminder, before the due time
export const CLAIM_ITEMS_MAX = 10;
export const CLAIM_PHOTOS_MIN = 1;
export const CLAIM_DESCRIPTION_MIN_LENGTH = 10;
export const BLOCKED_RANGES_MAX = 20;

// Disputes (SPEC 13, 15; DECISIONS I13, I79 to I85, PROVISIONAL)
export const APPEAL_WINDOW_DAYS = 3;
export const APPEALS_PER_DISPUTE = 1;
export const DISPUTE_RESPONSE_HOURS = 48; // the other side answers, then an admin reviews
export const DISPUTE_REVIEW_BUSINESS_DAYS = 5; // admin target for a decision
export const DISPUTE_EVIDENCE_RETENTION_DAYS = 180; // photos kept after a dispute closes
export const EVIDENCE_PHOTOS_MAX = 5;
export const EVIDENCE_TEXT_MAX_LENGTH = 2000;

// Notifications (SPEC Module 9; DECISIONS I91 to I99, PROVISIONAL)
export const NOTIFICATION_RETENTION_DAYS = 90; // read notifications are deleted after this
export const MESSAGE_NOTIFY_INTERVAL_MINUTES = 30; // at most one per chat in this time
export const REVIEW_REMINDER_DELAY_HOURS = 24; // after an order or rental completes
export const EMAIL_RETRY_ATTEMPTS = 3;
export const EMAIL_RETRY_DELAY_SECONDS = 30; // doubled after each failed try
export const EMAIL_JOB_KEEP_DAYS = 7; // finished email jobs kept, so their ids stay taken
export const NOTIFICATIONS_PAGE_SIZE_MAX = 50;

// Reviews and reports (SPEC Module 7; DECISIONS I86 to I90, PROVISIONAL)
export const REVIEW_WINDOW_DAYS = 30; // after the order or rental completes
export const REVIEW_TEXT_MAX_LENGTH = 1000;
export const REVIEW_PHOTOS_MAX = 4;
export const REPORT_DETAILS_MAX_LENGTH = 1000;

// Accounts
export const ACCOUNT_RECOVERY_DAYS = 30; // SPEC 15, DECISIONS I16
export const ACCOUNT_PURGE_INTERVAL_MINUTES = 60; // how often expired deletions are erased
export const PASSWORD_MIN_LENGTH = 8; // DECISIONS I19 (PROVISIONAL)
export const PASSWORD_MAX_BYTES = 72; // bcrypt ignores anything beyond 72 bytes
export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const BIO_MAX_LENGTH = 500;
export const LOCALITY_MAX_LENGTH = 80;

// OTP (DECISIONS I2, PROVISIONAL)
export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_RESENDS_PER_HOUR = 5;

// Sessions (DECISIONS I3, PROVISIONAL)
export const ACCESS_TOKEN_TTL_MINUTES = 15;
export const REFRESH_TOKEN_TTL_DAYS = 30; // DECISIONS I21 (PROVISIONAL)
// A just-replaced refresh token presented again within this window is refused without
// ending the session (two browser tabs refreshing together); after it, the session ends.
export const REFRESH_REUSE_GRACE_SECONDS = 10;

// Rate limits per IP address (DECISIONS I22, PROVISIONAL). OTP sends are additionally
// limited per user by the OTP values above.
export const RATE_LIMITS = Object.freeze({
  login: Object.freeze({ windowMinutes: 15, max: 10 }),
  register: Object.freeze({ windowMinutes: 60, max: 5 }),
  passwordReset: Object.freeze({ windowMinutes: 60, max: 5 }),
  otp: Object.freeze({ windowMinutes: 15, max: 30 }),
  places: Object.freeze({ windowMinutes: 1, max: 30 }),
  checkout: Object.freeze({ windowMinutes: 15, max: 20 }),
  rental: Object.freeze({ windowMinutes: 15, max: 20 }),
  // Messaging (I77): counted per person as well as per IP address.
  message: Object.freeze({ windowMinutes: 1, max: 30 }),
  offer: Object.freeze({ windowMinutes: 60, max: 10 }),
  conversation: Object.freeze({ windowMinutes: 60, max: 20 }),
  block: Object.freeze({ windowMinutes: 60, max: 30 }),
  report: Object.freeze({ windowMinutes: 60, max: 10 }),
  review: Object.freeze({ windowMinutes: 60, max: 10 }),
  evidence: Object.freeze({ windowMinutes: 60, max: 30 }),
});

// Messaging and offers (SPEC Module 8; DECISIONS I68 to I78, PROVISIONAL)
export const MESSAGE_MAX_LENGTH = 2000;
export const MESSAGE_PHOTOS_MAX = 4;
export const MESSAGES_PAGE_SIZE_DEFAULT = 30;
export const MESSAGES_PAGE_SIZE_MAX = 100;
export const OFFER_OPEN_HOURS = 48; // an offer or counter waits this long for an answer
export const OFFER_USE_HOURS = 48; // an accepted offer can be checked out this long
export const BLOCKS_MAX = 500;

// Listings (SPEC Module 2; limits are DECISIONS I26 to I31, PROVISIONAL)
export const LISTING_TITLE_MIN_LENGTH = 5;
export const LISTING_TITLE_MAX_LENGTH = 80;
export const LISTING_DESCRIPTION_MIN_LENGTH = 10;
export const LISTING_DESCRIPTION_MAX_LENGTH = 2000;
export const LISTING_BRAND_MAX_LENGTH = 60;
export const LISTING_SIZE_MAX_LENGTH = 20;
export const LISTING_COLOUR_MAX_LENGTH = 30;
export const LISTING_QUANTITY_MAX = 99;

// Listing photos
export const LISTING_IMAGES_MIN = 1;
export const LISTING_IMAGES_MAX = 8; // SPEC Module 2
export const LISTING_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// Amounts, in paise
export const LISTING_AMOUNT_MIN_PAISE = 1_00; // price, package price and deposit
export const LISTING_AMOUNT_MAX_PAISE = 5_00_000_00;
export const DELIVERY_CHARGE_MAX_PAISE = 5_000_00;
export const LATE_FEE_PER_DAY_MAX_PAISE = 10_000_00;

// Delivery (SPEC 14: per-listing charge and radius)
export const DELIVERY_RADIUS_MIN_KM = 1;
export const DELIVERY_RADIUS_MAX_KM = 50;

// Rental packages (SPEC 13: suggested presets plus custom durations)
export const RENTAL_PACKAGE_PRESET_DAYS = Object.freeze([1, 3, 7]);
export const RENTAL_PACKAGES_MAX = 6;
export const RENTAL_PACKAGE_MAX_DAYS = 30;

// Lists
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 50;

// Search and discovery (SPEC Module 6; values are DECISIONS I32 to I38, PROVISIONAL)
export const SEARCH_QUERY_MAX_LENGTH = 100;
export const SEARCH_TERMS_MAX = 8;
export const SUGGESTION_MIN_LENGTH = 2;
export const SUGGESTIONS_MAX = 5;
export const SEARCH_HISTORY_MAX = 10;
export const FACET_VALUES_MAX = 20;

// Popularity of a listing = unique signed-in views + this weight for each like.
export const POPULARITY_LIKE_WEIGHT = 3;

// Home page sections
export const HOME_SECTION_SIZE = 12;
export const TRENDING_WINDOW_DAYS = 14;
export const BUDGET_MAX_PAISE = 1_000_00;

// "For You": how much each kind of activity says about a person's taste, and how
// much a match on each attribute of a listing counts.
export const RECOMMENDATION_SIGNAL_WEIGHTS = Object.freeze({ viewed: 1, liked: 3, purchased: 5 });
export const RECOMMENDATION_MATCH_WEIGHTS = Object.freeze({ category: 3, brand: 2, size: 1 });

// Location (SPEC Module 5; DECISIONS I6 and I39 to I46, PROVISIONAL)
// Listings are shown at the centre of a grid square of about 500 m, never at their
// exact spot; distances are measured from that centre and rounded up.
export const LOCATION_GRID_DEGREES = 0.0045; // about 500 m of latitude
export const DISTANCE_ROUNDING_KM = 0.5;
export const SEARCH_RADIUS_OPTIONS_KM = Object.freeze([2, 5, 10, 25, 50]);
// A position sent from a device is rounded to this many decimals (about 100 m) and never stored.
export const ORIGIN_DECIMALS = 3;
export const TRENDING_NEAR_RADIUS_KM = 10;
export const SAVED_LOCATIONS_MAX = 5;
export const LOCATION_LABEL_MAX_LENGTH = 30;
// Coordinates must fall inside this box around India.
export const ALLOWED_AREA = Object.freeze({ minLat: 6, maxLat: 37.5, minLng: 68, maxLng: 97.5 });

// Place search through OpenStreetMap's Nominatim service (I39). Its usage policy
// allows at most one request per second; answers are cached.
export const PLACE_LOOKUP_MIN_INTERVAL_MS = 1100;
export const PLACE_LOOKUP_CACHE_DAYS = 30;
export const PLACE_RESULTS_MAX = 5;
export const PLACE_QUERY_MAX_LENGTH = 100;

// Cart, checkout and orders (SPEC Module 3, 12, 14, 15; DECISIONS I4, I7, I10, I11, I47 to I58)
export const CART_ITEMS_MAX = 20;
export const ADDRESSES_MAX = 5;
export const RECEIPT_WINDOW_HOURS = 48; // SPEC 14: buyer confirms or reports after delivery
export const DISPATCH_WARNING_HOURS = 24; // seller reminded this long before the deadline
export const DISPATCH_EXTENSION_MAX_BUSINESS_DAYS = 3;
export const HANDOVER_CODE_LENGTH = 6;
export const HANDOVER_MAX_ATTEMPTS = 5;
export const ISSUE_PHOTOS_MIN = 1;
export const ISSUE_PHOTOS_MAX = 5;
export const ISSUE_DESCRIPTION_MIN_LENGTH = 10;
export const ISSUE_DESCRIPTION_MAX_LENGTH = 1000;
export const REASON_MAX_LENGTH = 500;
export const REFUND_RETRY_MAX_ATTEMPTS = 5;
export const REFUND_RETRY_AFTER_MINUTES = 2;
export const ORDER_JOBS_INTERVAL_SECONDS = 60;
