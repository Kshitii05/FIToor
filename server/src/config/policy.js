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
export const RENTAL_CONDITION_PHOTOS_MIN = 2; // DECISIONS I17 (PROVISIONAL)

// Disputes (DECISIONS I13, PROVISIONAL)
export const APPEAL_WINDOW_DAYS = 3;
export const APPEALS_PER_DISPUTE = 1;

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
});

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
