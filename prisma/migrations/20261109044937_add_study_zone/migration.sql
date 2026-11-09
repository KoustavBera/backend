-- CreateEnum
CREATE TYPE "resource_category" AS ENUM ('video', 'notes', 'book', 'pyq');

-- CreateEnum
CREATE TYPE "resource_format" AS ENUM ('youtube', 'pdf', 'image');

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "class_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" CITEXT NOT NULL,
    "name_bn" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'book',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_id" UUID NOT NULL,
    "category" "resource_category" NOT NULL,
    "format" "resource_format" NOT NULL,
    "title" TEXT NOT NULL,
    "chapter" TEXT,
    "object_key" TEXT,
    "youtube_url" TEXT,
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "academic_year" TEXT NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_intents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "finalized_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_subjects_class_id" ON "subjects"("class_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_subject_class_slug" ON "subjects"("class_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "uq_subject_class_name" ON "subjects"("class_id", "name");

-- CreateIndex
CREATE INDEX "idx_resources_subject" ON "resources"("subject_id");

-- CreateIndex
CREATE INDEX "idx_resources_year" ON "resources"("subject_id", "academic_year");

-- CreateIndex
CREATE INDEX "idx_resources_draft" ON "resources"("subject_id", "uploaded_by");

-- CreateIndex
CREATE UNIQUE INDEX "upload_intents_object_key_key" ON "upload_intents"("object_key");

-- CreateIndex
CREATE INDEX "idx_upload_intents_expires" ON "upload_intents"("expires_at");

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
