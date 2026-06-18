-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "emailKey" TEXT;

-- Backfill emailKey = lowercased, trimmed email for existing leads so the new
-- "email OR phone" duplicate detection sees historical rows too.
UPDATE "Lead" SET "emailKey" = lower(btrim("email")) WHERE "email" IS NOT NULL AND btrim("email") <> '';

-- CreateIndex
CREATE INDEX "Lead_emailKey_idx" ON "Lead"("emailKey");
