-- AlterTable: candidate country (free-form name from the country dropdown).
ALTER TABLE "Lead" ADD COLUMN "country" TEXT;

-- CreateIndex: backs the leads-list country filter/segmentation.
CREATE INDEX "Lead_country_idx" ON "Lead"("country");
