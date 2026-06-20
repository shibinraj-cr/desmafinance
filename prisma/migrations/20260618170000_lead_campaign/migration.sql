-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "campaign" TEXT;

-- Backfill campaign from extra.campaign for leads already imported from sheets.
UPDATE "Lead" SET "campaign" = "extra"->>'campaign' WHERE "extra" ? 'campaign';

-- CreateIndex
CREATE INDEX "Lead_campaign_idx" ON "Lead"("campaign");
