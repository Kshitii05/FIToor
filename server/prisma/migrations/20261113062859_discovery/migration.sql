-- Trigram matching, used by the autocomplete indexes below.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
-- headline_price_paise is added empty, filled for existing rows, then made required.
ALTER TABLE "listings" ADD COLUMN     "headline_price_paise" INTEGER,
ADD COLUMN     "like_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "popularity_score" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "search_vector" tsvector,
ADD COLUMN     "view_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "listings" l
SET "headline_price_paise" = COALESCE(
  l."price_paise",
  (SELECT MIN(p."price_paise") FROM "rental_packages" p WHERE p."listing_id" = l."id")
);

ALTER TABLE "listings" ALTER COLUMN "headline_price_paise" SET NOT NULL;
ALTER TABLE "listings" ADD CONSTRAINT "listings_discovery_counts_check" CHECK (
  "headline_price_paise" > 0 AND "view_count" >= 0 AND "like_count" >= 0 AND "popularity_score" >= 0
);

-- CreateTable
CREATE TABLE "listing_likes" (
    "user_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listing_likes_pkey" PRIMARY KEY ("user_id","listing_id")
);

-- CreateTable
CREATE TABLE "listing_views" (
    "user_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "viewed_on" DATE NOT NULL,

    CONSTRAINT "listing_views_pkey" PRIMARY KEY ("user_id","listing_id","viewed_on")
);

-- CreateTable
CREATE TABLE "search_history" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "search_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_likes_listing_id_created_at_idx" ON "listing_likes"("listing_id", "created_at");

-- CreateIndex
CREATE INDEX "listing_likes_user_id_created_at_idx" ON "listing_likes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "listing_views_listing_id_viewed_on_idx" ON "listing_views"("listing_id", "viewed_on");

-- CreateIndex
CREATE INDEX "search_history_user_id_created_at_idx" ON "search_history"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "search_history_user_id_query_key" ON "search_history"("user_id", "query");

-- CreateIndex
CREATE INDEX "listings_search_vector_idx" ON "listings" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "listings_title_trgm_idx" ON "listings" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "listings_brand_trgm_idx" ON "listings" USING GIN ("brand" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "listings_status_created_at_idx" ON "listings"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "listings_status_headline_price_paise_idx" ON "listings"("status", "headline_price_paise");

-- CreateIndex
CREATE INDEX "listings_status_popularity_score_idx" ON "listings"("status", "popularity_score" DESC);

-- CreateIndex
CREATE INDEX "listings_status_category_idx" ON "listings"("status", "category");

-- AddForeignKey
ALTER TABLE "listing_likes" ADD CONSTRAINT "listing_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_likes" ADD CONSTRAINT "listing_likes_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_views" ADD CONSTRAINT "listing_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_views" ADD CONSTRAINT "listing_views_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keyword search. The search text of a listing is its title (most important),
-- then brand, colour and category, then description. A trigger keeps it current.
CREATE FUNCTION listings_set_search_vector() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', NEW.title), 'A') ||
    setweight(
      to_tsvector(
        'english',
        NEW.brand || ' ' || NEW.colour || ' ' || replace(NEW.category::text, '_', ' ')
      ),
      'B'
    ) ||
    setweight(to_tsvector('english', NEW.description), 'C');
  RETURN NEW;
END
$$;

CREATE TRIGGER listings_search_vector
BEFORE INSERT OR UPDATE OF title, brand, colour, category, description ON "listings"
FOR EACH ROW EXECUTE FUNCTION listings_set_search_vector();

-- Fill the search text of listings that already exist.
UPDATE "listings" SET "title" = "title";
