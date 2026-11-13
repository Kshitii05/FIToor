-- Listing location. The pin (exact, private) and the public point (centre of the
-- ~500 m grid square the pin falls in) are both stored; only the public point is
-- ever shown to others or used to measure distance.
ALTER TABLE "listings" ADD COLUMN     "locality" TEXT,
ADD COLUMN     "pin_lat" DOUBLE PRECISION,
ADD COLUMN     "pin_lng" DOUBLE PRECISION,
ADD COLUMN     "public_lat" DOUBLE PRECISION,
ADD COLUMN     "public_lng" DOUBLE PRECISION;

-- The point used for radius search is derived from the public point by the database,
-- so it can never drift from what the public is shown.
ALTER TABLE "listings" ADD COLUMN "public_location" geography(Point,4326)
  GENERATED ALWAYS AS (
    CASE
      WHEN "public_lat" IS NOT NULL AND "public_lng" IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint("public_lng", "public_lat"), 4326)::geography
    END
  ) STORED;

CREATE INDEX "listings_public_location_idx" ON "listings" USING GIST ("public_location");

-- A location is complete or absent: pin, public point and area name together.
-- Coordinates must be inside the box around India.
ALTER TABLE "listings" ADD CONSTRAINT "listings_location_check" CHECK (
  (
    "pin_lat" IS NULL AND "pin_lng" IS NULL AND "public_lat" IS NULL
    AND "public_lng" IS NULL AND "locality" IS NULL
  ) OR (
    "pin_lat" BETWEEN 6 AND 37.5 AND "pin_lng" BETWEEN 68 AND 97.5
    AND "public_lat" BETWEEN 6 AND 37.5 AND "public_lng" BETWEEN 68 AND 97.5
    AND length(trim("locality")) > 0
  )
);

-- Saved locations: private places a user searches around.
CREATE TABLE "saved_locations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "locality" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_locations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "saved_locations_area_check" CHECK (
      "lat" BETWEEN 6 AND 37.5 AND "lng" BETWEEN 68 AND 97.5
    )
);

CREATE INDEX "saved_locations_user_id_created_at_idx" ON "saved_locations"("user_id", "created_at");

-- At most one default location per user.
CREATE UNIQUE INDEX "saved_locations_one_default_idx" ON "saved_locations"("user_id") WHERE "is_default";

ALTER TABLE "saved_locations" ADD CONSTRAINT "saved_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
