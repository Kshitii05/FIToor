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
export const ACCOUNT_RECOVERY_DAYS = 30; // DECISIONS I16

// OTP (DECISIONS I2, PROVISIONAL)
export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_RESENDS_PER_HOUR = 5;

// Sessions (DECISIONS I3, PROVISIONAL)
export const ACCESS_TOKEN_TTL_MINUTES = 15;
