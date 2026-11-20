-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'PHOTO', 'OFFER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED', 'COUNTERED', 'WITHDRAWN', 'EXPIRED', 'USED');

-- AlterTable
ALTER TABLE "checkout_items" ADD COLUMN     "offer_id" UUID;

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "user_a_id" UUID NOT NULL,
    "user_b_id" UUID NOT NULL,
    "last_message_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "delivered_up_to" INTEGER NOT NULL DEFAULT 0,
    "read_up_to" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "seq" SERIAL NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID,
    "kind" "MessageKind" NOT NULL,
    "body" TEXT,
    "listing_id" UUID,
    "order_id" UUID,
    "booking_id" UUID,
    "offer_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "storage_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_offers" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "made_by_id" UUID NOT NULL,
    "previous_offer_id" UUID,
    "quantity" INTEGER NOT NULL,
    "unit_price_paise" INTEGER NOT NULL,
    "list_price_paise" INTEGER NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'OPEN',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "responded_at" TIMESTAMPTZ(3),
    "accepted_at" TIMESTAMPTZ(3),
    "use_by" TIMESTAMPTZ(3),
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_users" (
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "blocked_users_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_user_a_id_user_b_id_key" ON "conversations"("user_a_id", "user_b_id");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_idx" ON "conversation_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_seq_key" ON "messages"("seq");

-- CreateIndex
CREATE INDEX "messages_conversation_id_seq_idx" ON "messages"("conversation_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "message_attachments_message_id_position_key" ON "message_attachments"("message_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "price_offers_previous_offer_id_key" ON "price_offers"("previous_offer_id");

-- CreateIndex
CREATE INDEX "price_offers_buyer_id_listing_id_status_idx" ON "price_offers"("buyer_id", "listing_id", "status");

-- CreateIndex
CREATE INDEX "price_offers_status_expires_at_idx" ON "price_offers"("status", "expires_at");

-- CreateIndex
CREATE INDEX "blocked_users_blocked_id_idx" ON "blocked_users"("blocked_id");

-- AddForeignKey
ALTER TABLE "checkout_items" ADD CONSTRAINT "checkout_items_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "price_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_a_id_fkey" FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_b_id_fkey" FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "price_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_offers" ADD CONSTRAINT "price_offers_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_offers" ADD CONSTRAINT "price_offers_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_offers" ADD CONSTRAINT "price_offers_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_offers" ADD CONSTRAINT "price_offers_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_offers" ADD CONSTRAINT "price_offers_previous_offer_id_fkey" FOREIGN KEY ("previous_offer_id") REFERENCES "price_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_users" ADD CONSTRAINT "blocked_users_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_users" ADD CONSTRAINT "blocked_users_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Messaging: written by hand
-- ---------------------------------------------------------------------------

-- The pair is stored in a fixed order, so one pair has one conversation.
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_pair_order"
  CHECK ("user_a_id" < "user_b_id");

ALTER TABLE "messages" ADD CONSTRAINT "messages_body_length"
  CHECK ("body" IS NULL OR char_length("body") <= 2000);

ALTER TABLE "price_offers" ADD CONSTRAINT "price_offers_amounts"
  CHECK ("quantity" > 0 AND "unit_price_paise" > 0 AND "unit_price_paise" < "list_price_paise"
         AND "buyer_id" <> "seller_id");

ALTER TABLE "blocked_users" ADD CONSTRAINT "blocked_users_not_self"
  CHECK ("blocker_id" <> "blocked_id");

-- One live (open or accepted) offer per buyer and listing.
CREATE UNIQUE INDEX "price_offers_one_live" ON "price_offers" ("listing_id", "buyer_id")
  WHERE "status" IN ('OPEN', 'ACCEPTED');

-- Messages are never edited or removed.
CREATE TRIGGER messages_append_only BEFORE UPDATE OR DELETE ON "messages"
FOR EACH ROW EXECUTE FUNCTION refuse_record_change();
