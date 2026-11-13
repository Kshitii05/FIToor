-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('REQUESTED', 'APPROVED', 'CONFIRMED', 'ACTIVE', 'RETURNED', 'CLAIM_OPEN', 'ADMIN_REVIEW', 'SETTLING', 'COMPLETED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DISPUTED', 'NO_RESPONSE', 'DECIDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerEntryType" ADD VALUE 'DEPOSIT_COLLECTED';
ALTER TYPE "LedgerEntryType" ADD VALUE 'DEPOSIT_REFUND';
ALTER TYPE "LedgerEntryType" ADD VALUE 'DEPOSIT_DEDUCTION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RefundReason" ADD VALUE 'RENTER_CANCELLED';
ALTER TYPE "RefundReason" ADD VALUE 'OWNER_CANCELLED';
ALTER TYPE "RefundReason" ADD VALUE 'DEPOSIT_RETURN';

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_checkout_id_fkey";

-- DropForeignKey
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_checkout_id_fkey";

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "booking_id" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "booking_id" UUID,
ALTER COLUMN "checkout_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "booking_id" UUID,
ADD COLUMN     "deposit_amount_paise" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "checkout_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "rental_bookings" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "listing_id" UUID NOT NULL,
    "renter_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "title" TEXT NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "fulfilment" "Fulfilment" NOT NULL,
    "delivery_address" JSONB,
    "pickup_lat" DOUBLE PRECISION,
    "pickup_lng" DOUBLE PRECISION,
    "pickup_locality" TEXT,
    "fee_paise" INTEGER NOT NULL,
    "deposit_paise" INTEGER NOT NULL,
    "delivery_charge_paise" INTEGER NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "commission_paise" INTEGER NOT NULL,
    "owner_payable_paise" INTEGER NOT NULL,
    "late_fee_per_day_paise" INTEGER NOT NULL,
    "refunded_paise" INTEGER NOT NULL DEFAULT 0,
    "fee_refunded_paise" INTEGER NOT NULL DEFAULT 0,
    "deposit_refunded_paise" INTEGER NOT NULL DEFAULT 0,
    "late_fee_paise" INTEGER,
    "damage_paise" INTEGER,
    "deposit_deducted_paise" INTEGER NOT NULL DEFAULT 0,
    "owed_paise" INTEGER NOT NULL DEFAULT 0,
    "hold_expires_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "payment_due_at" TIMESTAMPTZ(3),
    "gateway_order_id" TEXT,
    "paid_at" TIMESTAMPTZ(3),
    "handover_code" TEXT,
    "handover_attempts" INTEGER NOT NULL DEFAULT 0,
    "return_code" TEXT,
    "return_attempts" INTEGER NOT NULL DEFAULT 0,
    "return_due_at" TIMESTAMPTZ(3) NOT NULL,
    "handed_over_at" TIMESTAMPTZ(3),
    "handover_photos" JSONB,
    "returned_at" TIMESTAMPTZ(3),
    "return_photos" JSONB,
    "inspection_ends_at" TIMESTAMPTZ(3),
    "late_fee_disputed_at" TIMESTAMPTZ(3),
    "non_return_reported_at" TIMESTAMPTZ(3),
    "reminded_before_at" TIMESTAMPTZ(3),
    "reminded_due_day_at" TIMESTAMPTZ(3),
    "overdue_notified_at" TIMESTAMPTZ(3),
    "settled_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rental_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_date_holds" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "released_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rental_date_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_blocked_dates" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rental_blocked_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_claims" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "photos" JSONB NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'OPEN',
    "respond_due_at" TIMESTAMPTZ(3) NOT NULL,
    "renter_response" TEXT,
    "responded_at" TIMESTAMPTZ(3),
    "decided_by_id" UUID,
    "decided_paise" INTEGER,
    "decision_reason" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rental_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_events" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "BookingStatus",
    "to_status" "BookingStatus",
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rental_bookings_ref_key" ON "rental_bookings"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "rental_bookings_gateway_order_id_key" ON "rental_bookings"("gateway_order_id");

-- CreateIndex
CREATE INDEX "rental_bookings_listing_id_status_idx" ON "rental_bookings"("listing_id", "status");

-- CreateIndex
CREATE INDEX "rental_bookings_renter_id_created_at_idx" ON "rental_bookings"("renter_id", "created_at");

-- CreateIndex
CREATE INDEX "rental_bookings_owner_id_created_at_idx" ON "rental_bookings"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "rental_bookings_status_idx" ON "rental_bookings"("status");

-- CreateIndex
CREATE UNIQUE INDEX "rental_date_holds_booking_id_key" ON "rental_date_holds"("booking_id");

-- CreateIndex
CREATE INDEX "rental_date_holds_listing_id_released_at_idx" ON "rental_date_holds"("listing_id", "released_at");

-- CreateIndex
CREATE INDEX "rental_blocked_dates_listing_id_end_date_idx" ON "rental_blocked_dates"("listing_id", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "rental_claims_booking_id_key" ON "rental_claims"("booking_id");

-- CreateIndex
CREATE INDEX "booking_events_booking_id_created_at_idx" ON "booking_events"("booking_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_booking_id_idx" ON "ledger_entries"("booking_id");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE INDEX "refunds_booking_id_idx" ON "refunds"("booking_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "checkouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "rental_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "checkouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "rental_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_renter_id_fkey" FOREIGN KEY ("renter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_date_holds" ADD CONSTRAINT "rental_date_holds_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_date_holds" ADD CONSTRAINT "rental_date_holds_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "rental_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_blocked_dates" ADD CONSTRAINT "rental_blocked_dates_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_claims" ADD CONSTRAINT "rental_claims_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "rental_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "rental_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rentals: written by hand
-- ---------------------------------------------------------------------------

-- A payment, refund belongs to exactly one checkout or one rental booking.
ALTER TABLE "payments" ADD CONSTRAINT "payments_one_purpose"
  CHECK (num_nonnulls("checkout_id", "booking_id") = 1);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_one_purpose"
  CHECK (num_nonnulls("checkout_id", "booking_id") = 1);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_parts"
  CHECK ("deposit_amount_paise" >= 0 AND "items_amount_paise" >= 0
         AND "items_amount_paise" + "deposit_amount_paise" <= "amount_paise");

-- Paid bookings of one listing never share a day. Start and end are inclusive.
-- This is the final guard; the server also checks, under a lock on the listing.
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_no_overlap"
  EXCLUDE USING gist ("listing_id" WITH =, daterange("start_date", "end_date", '[]') WITH &&)
  WHERE ("status" IN ('CONFIRMED', 'ACTIVE', 'RETURNED', 'CLAIM_OPEN', 'ADMIN_REVIEW', 'SETTLING', 'COMPLETED'));

-- Unreleased holds of one listing never share a day either.
ALTER TABLE "rental_date_holds" ADD CONSTRAINT "rental_date_holds_no_overlap"
  EXCLUDE USING gist ("listing_id" WITH =, daterange("start_date", "end_date", '[]') WITH &&)
  WHERE ("released_at" IS NULL);

ALTER TABLE "rental_date_holds" ADD CONSTRAINT "rental_date_holds_dates"
  CHECK ("end_date" >= "start_date");
ALTER TABLE "rental_blocked_dates" ADD CONSTRAINT "rental_blocked_dates_dates"
  CHECK ("end_date" >= "start_date");

-- Amounts on a booking add up, and the deposit is never used twice:
-- what is refunded plus what is deducted can never exceed what was collected.
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_amounts" CHECK (
  "end_date" >= "start_date"
  AND "duration_days" = "end_date" - "start_date" + 1
  AND "fee_paise" > 0 AND "deposit_paise" > 0 AND "delivery_charge_paise" >= 0
  AND "total_paise" = "fee_paise" + "deposit_paise" + "delivery_charge_paise"
  AND "commission_paise" >= 0 AND "commission_paise" <= "fee_paise"
  AND "owner_payable_paise" = "fee_paise" - "commission_paise" + "delivery_charge_paise"
  AND "late_fee_per_day_paise" >= 0
  AND "fee_refunded_paise" >= 0 AND "fee_refunded_paise" <= "fee_paise"
  AND "refunded_paise" >= "fee_refunded_paise"
  AND "refunded_paise" <= "fee_paise" + "delivery_charge_paise"
  AND "deposit_refunded_paise" >= 0 AND "deposit_deducted_paise" >= 0
  AND "deposit_refunded_paise" + "deposit_deducted_paise" <= "deposit_paise"
  AND "owed_paise" >= 0
  AND coalesce("late_fee_paise", 0) >= 0 AND coalesce("damage_paise", 0) >= 0
  AND "handover_attempts" >= 0 AND "return_attempts" >= 0
);

ALTER TABLE "rental_claims" ADD CONSTRAINT "rental_claims_amounts"
  CHECK ("total_paise" > 0 AND coalesce("decided_paise", 0) >= 0);

-- Booking history is append-only, like order history.
CREATE TRIGGER booking_events_append_only BEFORE UPDATE OR DELETE ON "booking_events"
FOR EACH ROW EXECUTE FUNCTION refuse_record_change();
