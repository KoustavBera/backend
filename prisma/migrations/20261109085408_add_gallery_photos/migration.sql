-- CreateEnum
CREATE TYPE "gallery_category" AS ENUM ('campus', 'events', 'sports', 'academics', 'celebrations');

-- CreateTable
CREATE TABLE "gallery_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "title_bn" TEXT,
    "category" "gallery_category" NOT NULL DEFAULT 'campus',
    "description" TEXT,
    "photo_key" TEXT NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gallery_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_gallery_active_order" ON "gallery_photos"("is_active", "sort_order", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_gallery_category" ON "gallery_photos"("category");

-- AddForeignKey
ALTER TABLE "gallery_photos" ADD CONSTRAINT "gallery_photos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
