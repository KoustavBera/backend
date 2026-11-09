-- AlterTable
ALTER TABLE "upload_intents" ALTER COLUMN "subject_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "faculty_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_bn" TEXT,
    "designation" TEXT NOT NULL,
    "designation_bn" TEXT,
    "department" TEXT NOT NULL DEFAULT 'General',
    "education" TEXT NOT NULL,
    "education_bn" TEXT,
    "description" TEXT,
    "photo_key" TEXT,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faculty_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "faculty_members_slug_key" ON "faculty_members"("slug");

-- CreateIndex
CREATE INDEX "idx_faculty_order" ON "faculty_members"("sort_order", "created_at");

-- CreateIndex
CREATE INDEX "idx_faculty_dept" ON "faculty_members"("department");

-- CreateIndex
CREATE INDEX "idx_faculty_slug" ON "faculty_members"("slug");

-- AddForeignKey
ALTER TABLE "faculty_members" ADD CONSTRAINT "faculty_members_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
