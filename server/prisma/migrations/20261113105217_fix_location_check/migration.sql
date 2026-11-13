-- The first version of this check let a half-filled location through: a comparison
-- with NULL is "unknown", and a CHECK that is unknown passes. Every column is now
-- tested for presence explicitly.
ALTER TABLE "listings" DROP CONSTRAINT "listings_location_check";

ALTER TABLE "listings" ADD CONSTRAINT "listings_location_check" CHECK (
  (
    "pin_lat" IS NULL AND "pin_lng" IS NULL AND "public_lat" IS NULL
    AND "public_lng" IS NULL AND "locality" IS NULL
  ) OR (
    "pin_lat" IS NOT NULL AND "pin_lng" IS NOT NULL
    AND "public_lat" IS NOT NULL AND "public_lng" IS NOT NULL AND "locality" IS NOT NULL
    AND "pin_lat" BETWEEN 6 AND 37.5 AND "pin_lng" BETWEEN 68 AND 97.5
    AND "public_lat" BETWEEN 6 AND 37.5 AND "public_lng" BETWEEN 68 AND 97.5
    AND length(trim("locality")) > 0
  )
);
