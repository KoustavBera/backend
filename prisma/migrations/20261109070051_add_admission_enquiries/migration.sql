-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('new', 'read', 'replied', 'closed');

-- CreateTable
CREATE TABLE "admission_enquiries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parent_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "class_interest" TEXT,
    "message" TEXT,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'new',
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "purge_after" TIMESTAMPTZ DEFAULT (now() + '2 years'::interval),

    CONSTRAINT "admission_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_enquiries_submitted" ON "admission_enquiries"("submitted_at" DESC);

-- CreateIndex
CREATE INDEX "idx_enquiries_purge" ON "admission_enquiries"("purge_after");

-- AddForeignKey
ALTER TABLE "admission_enquiries" ADD CONSTRAINT "admission_enquiries_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
