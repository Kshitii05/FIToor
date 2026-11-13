-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Fulfilment" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('OPEN', 'PAID', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('AWAITING_DISPATCH', 'AWAITING_PICKUP', 'DISPATCHED', 'DELIVERY_REPORTED', 'ADMIN_REVIEW', 'DELIVERED', 'ISSUE_OPEN', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ExtensionStatus" AS ENUM ('NONE', 'REQUESTED', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CAPTURED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('BUYER_CANCELLED', 'SELLER_CANCELLED', 'ADMIN_CANCELLED', 'NOT_DELIVERED', 'ISSUE_FULL', 'ISSUE_PARTIAL', 'LATE_PAYMENT', 'DUPLICATE_PAYMENT');

-- CreateEnum
CREATE TYPE "IssueKind" AS ENUM ('WRONG_ITEM', 'DAMAGED', 'NOT_AS_DESCRIBED');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "IssueResolution" AS ENUM ('FULL_REFUND', 'PARTIAL_REFUND', 'REJECTED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('BUYER_PAYMENT', 'COMMISSION', 'SELLER_PAYABLE', 'GATEWAY_FEE', 'BUYER_REFUND', 'COMMISSION_REVERSAL', 'SELLER_PAYABLE_REVERSAL');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "cart_items" (
    "user_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("user_id","listing_id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "locality" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkouts" (
    "id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "status" "CheckoutStatus" NOT NULL DEFAULT 'OPEN',
    "total_paise" INTEGER NOT NULL,
    "gateway_order_id" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),

    CONSTRAINT "checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_groups" (
    "id" UUID NOT NULL,
    "checkout_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "fulfilment" "Fulfilment" NOT NULL,
    "items_subtotal_paise" INTEGER NOT NULL,
    "delivery_charge_paise" INTEGER NOT NULL,
    "delivery_address" JSONB,

    CONSTRAINT "checkout_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_items" (
    "id" UUID NOT NULL,
    "checkout_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_paise" INTEGER NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "checkout_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "checkout_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "fulfilment" "Fulfilment" NOT NULL,
    "items_subtotal_paise" INTEGER NOT NULL,
    "delivery_charge_paise" INTEGER NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "commission_paise" INTEGER NOT NULL,
    "seller_payable_paise" INTEGER NOT NULL,
    "refunded_paise" INTEGER NOT NULL DEFAULT 0,
    "items_refunded_paise" INTEGER NOT NULL DEFAULT 0,
    "delivery_address" JSONB,
    "handover_code" TEXT,
    "handover_attempts" INTEGER NOT NULL DEFAULT 0,
    "courier_reference" TEXT,
    "dispatch_due_at" TIMESTAMPTZ(3),
    "dispatch_warned_at" TIMESTAMPTZ(3),
    "dispatch_overdue_at" TIMESTAMPTZ(3),
    "extension_status" "ExtensionStatus" NOT NULL DEFAULT 'NONE',
    "extension_until" TIMESTAMPTZ(3),
    "dispatched_at" TIMESTAMPTZ(3),
    "delivery_reported_at" TIMESTAMPTZ(3),
    "receipt_due_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "issue_window_ends_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "unit_price_paise" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "pickup_lat" DOUBLE PRECISION,
    "pickup_lng" DOUBLE PRECISION,
    "pickup_locality" TEXT,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus",
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "checkout_id" UUID NOT NULL,
    "gateway_order_id" TEXT NOT NULL,
    "gateway_payment_id" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "method" TEXT,
    "fee_paise" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "captured_at" TIMESTAMPTZ(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "gateway_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "checkout_id" UUID NOT NULL,
    "order_id" UUID,
    "payment_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "items_amount_paise" INTEGER NOT NULL,
    "reason" "RefundReason" NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "gateway_refund_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "last_attempt_at" TIMESTAMPTZ(3),
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_issues" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" "IssueKind" NOT NULL,
    "description" TEXT NOT NULL,
    "photos" JSONB NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "IssueResolution",
    "refund_paise" INTEGER,
    "resolved_by_id" UUID,
    "resolution_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "order_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "entry_key" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "checkout_id" UUID,
    "order_id" UUID,
    "payment_id" UUID,
    "refund_id" UUID,
    "seller_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "addresses_user_id_created_at_idx" ON "addresses"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "checkouts_gateway_order_id_key" ON "checkouts"("gateway_order_id");

-- CreateIndex
CREATE INDEX "checkouts_buyer_id_status_idx" ON "checkouts"("buyer_id", "status");

-- CreateIndex
CREATE INDEX "checkouts_status_expires_at_idx" ON "checkouts"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_groups_checkout_id_seller_id_key" ON "checkout_groups"("checkout_id", "seller_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_ref_key" ON "orders"("ref");

-- CreateIndex
CREATE INDEX "orders_buyer_id_created_at_idx" ON "orders"("buyer_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_seller_id_created_at_idx" ON "orders"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_checkout_id_seller_id_key" ON "orders"("checkout_id", "seller_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gateway_payment_id_key" ON "payments"("gateway_payment_id");

-- CreateIndex
CREATE INDEX "payments_checkout_id_idx" ON "payments"("checkout_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_gateway_event_id_key" ON "payment_events"("gateway_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_key_key" ON "refunds"("key");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_gateway_refund_id_key" ON "refunds"("gateway_refund_id");

-- CreateIndex
CREATE INDEX "refunds_status_last_attempt_at_idx" ON "refunds"("status", "last_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_issues_order_id_key" ON "order_issues"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_entry_key_key" ON "ledger_entries"("entry_key");

-- CreateIndex
CREATE INDEX "ledger_entries_checkout_id_idx" ON "ledger_entries"("checkout_id");

-- CreateIndex
CREATE INDEX "ledger_entries_order_id_idx" ON "ledger_entries"("order_id");

-- CreateIndex
CREATE INDEX "ledger_entries_seller_id_type_idx" ON "ledger_entries"("seller_id", "type");

-- CreateIndex
CREATE INDEX "admin_audit_logs_target_type_target_id_idx" ON "admin_audit_logs"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_groups" ADD CONSTRAINT "checkout_groups_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "checkouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_groups" ADD CONSTRAINT "checkout_groups_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_items" ADD CONSTRAINT "checkout_items_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "checkouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_items" ADD CONSTRAINT "checkout_items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "checkout_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_items" ADD CONSTRAINT "checkout_items_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "checkouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "checkouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "checkouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_issues" ADD CONSTRAINT "order_issues_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Append-only records: the ledger, webhook events, order history and admin
-- actions can be added to but never changed or removed. The test suite clears
-- them by setting app.allow_record_deletion for its own transaction only.
-- ---------------------------------------------------------------------------
CREATE FUNCTION refuse_record_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_record_deletion', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END
$$;

CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION refuse_record_change();
CREATE TRIGGER order_events_append_only BEFORE UPDATE OR DELETE ON "order_events"
FOR EACH ROW EXECUTE FUNCTION refuse_record_change();
CREATE TRIGGER admin_audit_logs_append_only BEFORE UPDATE OR DELETE ON "admin_audit_logs"
FOR EACH ROW EXECUTE FUNCTION refuse_record_change();

-- Webhook events: only the processed time may be filled in, once.
CREATE FUNCTION payment_events_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.allow_record_deletion', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'payment_events rows are append-only';
  END IF;
  IF OLD.processed_at IS NOT NULL
     OR NEW.gateway_event_id <> OLD.gateway_event_id OR NEW.type <> OLD.type
     OR NEW.payload <> OLD.payload OR NEW.received_at <> OLD.received_at THEN
    RAISE EXCEPTION 'payment_events rows are append-only';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON "payment_events"
FOR EACH ROW EXECUTE FUNCTION payment_events_guard();

-- ---------------------------------------------------------------------------
-- Amounts are whole paise and add up.
-- ---------------------------------------------------------------------------
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amount_check" CHECK ("amount_paise" >= 0);

ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check" CHECK (
  "items_subtotal_paise" > 0 AND "delivery_charge_paise" >= 0
  AND "total_paise" = "items_subtotal_paise" + "delivery_charge_paise"
  AND "commission_paise" >= 0 AND "commission_paise" <= "items_subtotal_paise"
  AND "commission_paise" + "seller_payable_paise" = "total_paise"
  AND "refunded_paise" BETWEEN 0 AND "total_paise"
  AND "items_refunded_paise" BETWEEN 0 AND "items_subtotal_paise"
  AND "items_refunded_paise" <= "refunded_paise"
  AND "handover_attempts" >= 0
);

ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfilment_check" CHECK (
  ("fulfilment" = 'DELIVERY' AND "delivery_address" IS NOT NULL AND "handover_code" IS NULL)
  OR ("fulfilment" = 'PICKUP' AND "delivery_address" IS NULL AND "delivery_charge_paise" = 0
      AND "handover_code" IS NOT NULL)
);

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_check" CHECK (
  "amount_paise" > 0 AND "items_amount_paise" BETWEEN 0 AND "amount_paise" AND "attempts" >= 0
);

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount_paise" > 0);
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_total_check" CHECK ("total_paise" > 0);
ALTER TABLE "checkout_groups" ADD CONSTRAINT "checkout_groups_amounts_check" CHECK (
  "items_subtotal_paise" > 0 AND "delivery_charge_paise" >= 0
);
ALTER TABLE "checkout_items" ADD CONSTRAINT "checkout_items_amounts_check" CHECK (
  "quantity" > 0 AND "unit_price_paise" > 0
);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_amounts_check" CHECK (
  "quantity" > 0 AND "unit_price_paise" > 0
);
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quantity_check" CHECK ("quantity" > 0);

-- ---------------------------------------------------------------------------
-- Addresses: inside India, a 6-digit PIN code, one default per person.
-- ---------------------------------------------------------------------------
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_values_check" CHECK (
  "lat" BETWEEN 6 AND 37.5 AND "lng" BETWEEN 68 AND 97.5 AND "pincode" ~ '^[1-9][0-9]{5}$'
);
CREATE UNIQUE INDEX "addresses_one_default_idx" ON "addresses"("user_id") WHERE "is_default";

-- At most one open checkout per buyer.
CREATE UNIQUE INDEX "checkouts_one_open_idx" ON "checkouts"("buyer_id") WHERE "status" = 'OPEN';
