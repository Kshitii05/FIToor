-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ORDERS', 'RENTALS', 'PAYMENTS', 'DISPUTES', 'MESSAGES', 'OFFERS', 'REVIEWS');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "type" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "data" JSONB,
    "read_at" TIMESTAMPTZ(3),
    "emailed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","category")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_key_key" ON "notifications"("key");

-- CreateIndex
CREATE INDEX "notifications_user_id_in_app_created_at_idx" ON "notifications"("user_id", "in_app", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_read_at_created_at_idx" ON "notifications"("read_at", "created_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Written by hand: carry the Step 1 on/off settings over to each optional category
-- (messages, offers, reviews) before the old table goes. Critical categories have
-- no setting: they are always on.
INSERT INTO "notification_preferences" ("user_id", "category", "in_app", "email", "updated_at")
SELECT p."user_id", c.category::"NotificationCategory", p."in_app_notifications", p."email_notifications", now()
FROM "user_preferences" p
CROSS JOIN (VALUES ('MESSAGES'), ('OFFERS'), ('REVIEWS')) AS c(category)
WHERE NOT (p."in_app_notifications" AND p."email_notifications");

-- DropForeignKey
ALTER TABLE "user_preferences" DROP CONSTRAINT "user_preferences_user_id_fkey";

-- DropTable
DROP TABLE "user_preferences";
