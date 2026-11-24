/*
  Warnings:

  - You are about to drop the `order_issues` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `rental_claims` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "DisputeKind" AS ENUM ('SALE_ISSUE', 'NOT_DELIVERED', 'RENTAL_DEPOSIT', 'NOT_RETURNED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'DECIDED', 'APPEALED', 'RESOLVED', 'CLOSED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ReportTarget" AS ENUM ('USER', 'LISTING', 'MESSAGE', 'REVIEW');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('PROHIBITED_ITEM', 'COUNTERFEIT', 'SCAM', 'HARASSMENT', 'INAPPROPRIATE', 'SPAM', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" "DisputeKind" NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "order_id" UUID,
    "booking_id" UUID,
    "claimant_id" UUID NOT NULL,
    "respondent_id" UUID NOT NULL,
    "opened_by_claimant" BOOLEAN NOT NULL DEFAULT true,
    "category" "IssueKind",
    "description" TEXT NOT NULL,
    "claim_items" JSONB,
    "claimed_damage_paise" INTEGER,
    "late_fee_disputed" BOOLEAN NOT NULL DEFAULT false,
    "respond_due_at" TIMESTAMPTZ(3) NOT NULL,
    "responded_at" TIMESTAMPTZ(3),
    "review_due_at" TIMESTAMPTZ(3),
    "review_overdue_at" TIMESTAMPTZ(3),
    "decision" JSONB,
    "decision_reason" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "appeal_due_at" TIMESTAMPTZ(3),
    "appealed_by_id" UUID,
    "appeal_reason" TEXT,
    "appealed_at" TIMESTAMPTZ(3),
    "final_decision" JSONB,
    "final_reason" TEXT,
    "final_decided_by_id" UUID,
    "final_decided_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "evidence_purged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_evidence" (
    "id" UUID NOT NULL,
    "dispute_id" UUID NOT NULL,
    "author_id" UUID,
    "role" TEXT NOT NULL,
    "text" TEXT,
    "photos" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "order_id" UUID,
    "booking_id" UUID,
    "author_role" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "communication" INTEGER NOT NULL,
    "handover" INTEGER NOT NULL,
    "condition" INTEGER,
    "text" TEXT,
    "photos" JSONB NOT NULL DEFAULT '[]',
    "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
    "hidden_reason" TEXT,
    "hidden_by_id" UUID,
    "hidden_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "target_type" "ReportTarget" NOT NULL,
    "target_id" UUID NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolution_reason" TEXT,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "disputes_ref_key" ON "disputes"("ref");

-- CreateIndex
CREATE INDEX "disputes_order_id_idx" ON "disputes"("order_id");

-- CreateIndex
CREATE INDEX "disputes_booking_id_idx" ON "disputes"("booking_id");

-- CreateIndex
CREATE INDEX "disputes_claimant_id_idx" ON "disputes"("claimant_id");

-- CreateIndex
CREATE INDEX "disputes_respondent_id_idx" ON "disputes"("respondent_id");

-- CreateIndex
CREATE INDEX "disputes_status_respond_due_at_idx" ON "disputes"("status", "respond_due_at");

-- CreateIndex
CREATE INDEX "disputes_status_appeal_due_at_idx" ON "disputes"("status", "appeal_due_at");

-- CreateIndex
CREATE INDEX "dispute_evidence_dispute_id_created_at_idx" ON "dispute_evidence"("dispute_id", "created_at");

-- CreateIndex
CREATE INDEX "reviews_subject_id_status_created_at_idx" ON "reviews"("subject_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_author_id_order_id_key" ON "reviews"("author_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_author_id_booking_id_key" ON "reviews"("author_id", "booking_id");

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "reports_target_type_target_id_idx" ON "reports"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "rental_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_claimant_id_fkey" FOREIGN KEY ("claimant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_respondent_id_fkey" FOREIGN KEY ("respondent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "rental_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Written by hand
-- ---------------------------------------------------------------------------

-- Carry existing sale issues and rental claims over as disputes, with their photos
-- as the claimant's first piece of evidence.
INSERT INTO "disputes" ("id", "ref", "kind", "status", "order_id", "claimant_id", "respondent_id",
  "category", "description", "respond_due_at", "review_due_at", "decision", "decision_reason",
  "decided_by_id", "decided_at", "closed_at", "created_at", "updated_at")
SELECT i."id", 'DSP-' || upper(substr(replace(i."id"::text, '-', ''), 1, 8)), 'SALE_ISSUE',
  (CASE WHEN i."status" = 'OPEN' THEN 'UNDER_REVIEW' ELSE 'CLOSED' END)::"DisputeStatus",
  i."order_id", o."buyer_id", o."seller_id", i."kind", i."description", i."created_at",
  CASE WHEN i."status" = 'OPEN' THEN i."created_at" END,
  CASE WHEN i."resolution" IS NULL THEN NULL
       ELSE jsonb_build_object('outcome', i."resolution"::text, 'refundPaise', i."refund_paise") END,
  i."resolution_reason", i."resolved_by_id", i."resolved_at", i."resolved_at", i."created_at",
  coalesce(i."resolved_at", i."created_at")
FROM "order_issues" i JOIN "orders" o ON o."id" = i."order_id";

INSERT INTO "dispute_evidence" ("id", "dispute_id", "author_id", "role", "text", "photos", "created_at")
SELECT gen_random_uuid(), i."id", o."buyer_id", 'CLAIMANT', i."description",
  coalesce((SELECT jsonb_agg(jsonb_build_object('url', u, 'storageId', NULL, 'takenAt', i."created_at"))
            FROM jsonb_array_elements_text(i."photos") AS u), '[]'::jsonb),
  i."created_at"
FROM "order_issues" i JOIN "orders" o ON o."id" = i."order_id";

INSERT INTO "disputes" ("id", "ref", "kind", "status", "booking_id", "claimant_id", "respondent_id",
  "description", "claim_items", "claimed_damage_paise", "late_fee_disputed", "respond_due_at",
  "responded_at", "review_due_at", "decision", "decision_reason", "decided_by_id", "decided_at",
  "closed_at", "created_at", "updated_at")
SELECT c."id", 'DSP-' || upper(substr(replace(c."id"::text, '-', ''), 1, 8)), 'RENTAL_DEPOSIT',
  (CASE c."status" WHEN 'OPEN' THEN 'OPEN' WHEN 'ACCEPTED' THEN 'RESOLVED'
                   WHEN 'DECIDED' THEN 'CLOSED' ELSE 'UNDER_REVIEW' END)::"DisputeStatus",
  c."booking_id", b."owner_id", b."renter_id", c."description", c."items", c."total_paise",
  b."late_fee_disputed_at" IS NOT NULL, c."respond_due_at", c."responded_at",
  CASE WHEN c."status" IN ('DISPUTED', 'NO_RESPONSE') THEN coalesce(c."responded_at", c."respond_due_at") END,
  CASE WHEN c."decided_paise" IS NULL THEN NULL
       ELSE jsonb_build_object('outcome', 'SETTLE', 'damagePaise', c."decided_paise",
                               'lateFeePaise', coalesce(b."late_fee_paise", 0)) END,
  c."decision_reason", c."decided_by_id", c."decided_at",
  CASE WHEN c."status" IN ('ACCEPTED', 'DECIDED') THEN coalesce(c."decided_at", c."responded_at") END,
  c."created_at", c."created_at"
FROM "rental_claims" c JOIN "rental_bookings" b ON b."id" = c."booking_id";

INSERT INTO "dispute_evidence" ("id", "dispute_id", "author_id", "role", "text", "photos", "created_at")
SELECT gen_random_uuid(), c."id", b."owner_id", 'CLAIMANT', c."description", c."photos", c."created_at"
FROM "rental_claims" c JOIN "rental_bookings" b ON b."id" = c."booking_id";

INSERT INTO "dispute_evidence" ("id", "dispute_id", "author_id", "role", "text", "created_at")
SELECT gen_random_uuid(), c."id", b."renter_id", 'RESPONDENT', c."renter_response", c."responded_at"
FROM "rental_claims" c JOIN "rental_bookings" b ON b."id" = c."booking_id"
WHERE c."renter_response" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "order_issues" DROP CONSTRAINT "order_issues_order_id_fkey";

-- DropForeignKey
ALTER TABLE "rental_claims" DROP CONSTRAINT "rental_claims_booking_id_fkey";

-- DropTable
DROP TABLE "order_issues";

-- DropTable
DROP TABLE "rental_claims";

-- DropEnum
DROP TYPE "ClaimStatus";

-- DropEnum
DROP TYPE "IssueResolution";

-- DropEnum
DROP TYPE "IssueStatus";

-- A dispute is about exactly one order or one booking, and each has at most one
-- unfinished dispute at a time.
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_one_subject"
  CHECK (num_nonnulls("order_id", "booking_id") = 1);
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_two_sides"
  CHECK ("claimant_id" <> "respondent_id");
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_claim_amount"
  CHECK ("claimed_damage_paise" IS NULL OR "claimed_damage_paise" > 0);
CREATE UNIQUE INDEX "disputes_one_open_per_order" ON "disputes" ("order_id")
  WHERE "status" NOT IN ('RESOLVED', 'CLOSED', 'WITHDRAWN');
CREATE UNIQUE INDEX "disputes_one_open_per_booking" ON "disputes" ("booking_id")
  WHERE "status" NOT IN ('RESOLVED', 'CLOSED', 'WITHDRAWN');

-- Reviews: one per author per transaction (unique indexes above), ratings 1 to 5.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_one_subject"
  CHECK (num_nonnulls("order_id", "booking_id") = 1);
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_not_self"
  CHECK ("author_id" <> "subject_id");
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_ratings" CHECK (
  "overall" BETWEEN 1 AND 5 AND "communication" BETWEEN 1 AND 5 AND "handover" BETWEEN 1 AND 5
  AND ("condition" IS NULL OR "condition" BETWEEN 1 AND 5)
  AND ("text" IS NULL OR char_length("text") <= 1000));

-- One open report per reporter and target.
CREATE UNIQUE INDEX "reports_one_open" ON "reports" ("reporter_id", "target_type", "target_id")
  WHERE "status" = 'OPEN';
