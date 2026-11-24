-- CreateEnum
CREATE TYPE "BankAccountStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PayoutBatchStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'SELLER_PAYOUT';

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'ACCOUNT';

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'SUSPENDED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "suspended_at" TIMESTAMPTZ(3),
ADD COLUMN     "suspension_reason" TEXT;

-- CreateTable
CREATE TABLE "user_activity_days" (
    "user_id" UUID NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "user_activity_days_pkey" PRIMARY KEY ("user_id","day")
);

-- CreateTable
CREATE TABLE "seller_bank_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "holder_name" TEXT NOT NULL,
    "account_number_encrypted" TEXT NOT NULL,
    "account_last4" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "status" "BankAccountStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "verified_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seller_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_batches" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "status" "PayoutBatchStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_id" UUID,
    "total_paise" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "overdue_notified_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "payout_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_items" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "batch_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),

    CONSTRAINT "payout_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_lines" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "order_id" UUID,
    "booking_id" UUID,
    "amount_paise" INTEGER NOT NULL,

    CONSTRAINT "payout_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_attempts" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "holder_name" TEXT NOT NULL,
    "account_last4" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "bank_reference" TEXT,
    "failure_reason" TEXT,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "payout_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_activity_days_day_idx" ON "user_activity_days"("day");

-- CreateIndex
CREATE UNIQUE INDEX "seller_bank_accounts_user_id_key" ON "seller_bank_accounts"("user_id");

-- CreateIndex
CREATE INDEX "seller_bank_accounts_status_submitted_at_idx" ON "seller_bank_accounts"("status", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "payout_batches_ref_key" ON "payout_batches"("ref");

-- CreateIndex
CREATE INDEX "payout_batches_status_due_at_idx" ON "payout_batches"("status", "due_at");

-- CreateIndex
CREATE INDEX "payout_batches_created_at_idx" ON "payout_batches"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payout_items_ref_key" ON "payout_items"("ref");

-- CreateIndex
CREATE INDEX "payout_items_seller_id_created_at_idx" ON "payout_items"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "payout_items_status_idx" ON "payout_items"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payout_items_batch_id_seller_id_key" ON "payout_items"("batch_id", "seller_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_lines_order_id_key" ON "payout_lines"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_lines_booking_id_key" ON "payout_lines"("booking_id");

-- CreateIndex
CREATE INDEX "payout_lines_item_id_idx" ON "payout_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_attempts_reference_key" ON "payout_attempts"("reference");

-- CreateIndex
CREATE INDEX "payout_attempts_item_id_created_at_idx" ON "payout_attempts"("item_id", "created_at");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- AddForeignKey
ALTER TABLE "user_activity_days" ADD CONSTRAINT "user_activity_days_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_bank_accounts" ADD CONSTRAINT "seller_bank_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_bank_accounts" ADD CONSTRAINT "seller_bank_accounts_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payout_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_lines" ADD CONSTRAINT "payout_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "payout_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_lines" ADD CONSTRAINT "payout_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_lines" ADD CONSTRAINT "payout_lines_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "rental_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_attempts" ADD CONSTRAINT "payout_attempts_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "payout_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_attempts" ADD CONSTRAINT "payout_attempts_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Payout safety, enforced by the database
-- ---------------------------------------------------------------------------

-- Only one batch can be open at a time.
CREATE UNIQUE INDEX "payout_batches_one_open" ON "payout_batches" ("status") WHERE "status" = 'OPEN';

-- A line pays exactly one order or one booking, and always a positive amount.
ALTER TABLE "payout_lines" ADD CONSTRAINT "payout_lines_one_target"
  CHECK (("order_id" IS NULL) <> ("booking_id" IS NULL));
ALTER TABLE "payout_lines" ADD CONSTRAINT "payout_lines_amount_positive" CHECK ("amount_paise" > 0);
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_amount_positive" CHECK ("amount_paise" > 0);
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_total_positive" CHECK ("total_paise" > 0);

-- Lines are never changed or removed once written.
CREATE TRIGGER payout_lines_append_only BEFORE UPDATE OR DELETE ON "payout_lines"
FOR EACH ROW EXECUTE FUNCTION refuse_record_change();

-- Bank details: only the last 4 digits are kept in the clear; IFSC has a fixed shape.
ALTER TABLE "seller_bank_accounts" ADD CONSTRAINT "seller_bank_accounts_last4"
  CHECK ("account_last4" ~ '^[0-9]{4}$');
ALTER TABLE "seller_bank_accounts" ADD CONSTRAINT "seller_bank_accounts_ifsc"
  CHECK ("ifsc" ~ '^[A-Z]{4}0[A-Z0-9]{6}$');
