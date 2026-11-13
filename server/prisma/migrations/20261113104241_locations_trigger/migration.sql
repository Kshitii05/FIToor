-- The radius-search point becomes a plain column kept current by a trigger, instead
-- of a generated column. Same behaviour; it keeps the schema file and the database
-- in agreement, so later migrations do not try to undo it.
ALTER TABLE "listings" DROP COLUMN "public_location";
ALTER TABLE "listings" ADD COLUMN "public_location" geography(Point,4326);

CREATE FUNCTION listings_set_public_location() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.public_lat IS NULL OR NEW.public_lng IS NULL THEN
    NEW.public_location := NULL;
  ELSE
    NEW.public_location := ST_SetSRID(ST_MakePoint(NEW.public_lng, NEW.public_lat), 4326)::geography;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER listings_public_location
BEFORE INSERT OR UPDATE OF public_lat, public_lng, public_location ON "listings"
FOR EACH ROW EXECUTE FUNCTION listings_set_public_location();

CREATE INDEX "listings_public_location_idx" ON "listings" USING GIST ("public_location");
