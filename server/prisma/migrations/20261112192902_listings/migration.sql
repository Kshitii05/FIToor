-- CreateEnum
CREATE TYPE "ListingMode" AS ENUM ('SALE', 'RENT');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'PAUSED', 'UNDER_REVIEW', 'REMOVED');

-- CreateEnum
CREATE TYPE "ListingCategory" AS ENUM ('ETHNIC_WEAR', 'WESTERN_WEAR', 'FOOTWEAR', 'ACCESSORIES', 'BAGS', 'FORMAL_WEAR');

-- CreateEnum
CREATE TYPE "ItemCondition" AS ENUM ('NEW', 'GOOD', 'FAIR');

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "mode" "ListingMode" NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "ListingCategory" NOT NULL,
    "condition" "ItemCondition" NOT NULL,
    "brand" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "colour" TEXT NOT NULL,
    "price_paise" INTEGER,
    "quantity" INTEGER,
    "deposit_paise" INTEGER,
    "late_fee_per_day_paise" INTEGER,
    "offers_delivery" BOOLEAN NOT NULL,
    "delivery_charge_paise" INTEGER,
    "delivery_radius_km" INTEGER,
    "offers_pickup" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_packages" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "listing_mode" "ListingMode" NOT NULL DEFAULT 'RENT',
    "duration_days" INTEGER NOT NULL,
    "price_paise" INTEGER NOT NULL,

    CONSTRAINT "rental_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_images" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "storage_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listing_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_status_events" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "from_status" "ListingStatus",
    "to_status" "ListingStatus",
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listing_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listings_seller_id_deleted_at_status_idx" ON "listings"("seller_id", "deleted_at", "status");

-- CreateIndex
CREATE UNIQUE INDEX "listings_id_mode_key" ON "listings"("id", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "rental_packages_listing_id_duration_days_key" ON "rental_packages"("listing_id", "duration_days");

-- CreateIndex
CREATE UNIQUE INDEX "listing_images_listing_id_position_key" ON "listing_images"("listing_id", "position");

-- CreateIndex
CREATE INDEX "listing_status_events_listing_id_created_at_idx" ON "listing_status_events"("listing_id", "created_at");

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_packages" ADD CONSTRAINT "rental_packages_listing_id_listing_mode_fkey" FOREIGN KEY ("listing_id", "listing_mode") REFERENCES "listings"("id", "mode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_status_events" ADD CONSTRAINT "listing_status_events_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_status_events" ADD CONSTRAINT "listing_status_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A listing is exactly one of sale or rent: the sale fields exist only on sale
-- listings and the rent fields only on rent listings.
ALTER TABLE "listings" ADD CONSTRAINT "listings_mode_fields_check" CHECK (
  (
    "mode" = 'SALE'
    AND "price_paise" IS NOT NULL AND "quantity" IS NOT NULL
    AND "deposit_paise" IS NULL AND "late_fee_per_day_paise" IS NULL
  ) OR (
    "mode" = 'RENT'
    AND "deposit_paise" IS NOT NULL AND "late_fee_per_day_paise" IS NOT NULL
    AND "price_paise" IS NULL AND "quantity" IS NULL
  )
);

ALTER TABLE "listings" ADD CONSTRAINT "listings_amounts_check" CHECK (
  ("price_paise" IS NULL OR "price_paise" > 0)
  AND ("quantity" IS NULL OR "quantity" >= 0)
  AND ("deposit_paise" IS NULL OR "deposit_paise" > 0)
  AND ("late_fee_per_day_paise" IS NULL OR "late_fee_per_day_paise" >= 0)
);

-- Delivery needs its charge and radius; without delivery neither is stored.
-- Every listing offers delivery, pickup or both.
ALTER TABLE "listings" ADD CONSTRAINT "listings_fulfilment_check" CHECK (
  ("offers_delivery" OR "offers_pickup")
  AND (
    (
      "offers_delivery"
      AND "delivery_charge_paise" IS NOT NULL AND "delivery_charge_paise" >= 0
      AND "delivery_radius_km" IS NOT NULL AND "delivery_radius_km" > 0
    ) OR (
      NOT "offers_delivery"
      AND "delivery_charge_paise" IS NULL AND "delivery_radius_km" IS NULL
    )
  )
);

-- Packages belong to rent listings only (the foreign key carries the mode).
ALTER TABLE "rental_packages" ADD CONSTRAINT "rental_packages_rent_only_check" CHECK ("listing_mode" = 'RENT');
ALTER TABLE "rental_packages" ADD CONSTRAINT "rental_packages_values_check" CHECK ("duration_days" > 0 AND "price_paise" > 0);

-- At most 8 images per listing: positions 0 to 7, unique per listing.
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_position_check" CHECK ("position" BETWEEN 0 AND 7);
