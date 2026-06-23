-- AlterTable: optional secondary contact number (raw + normalised E.164),
-- mirroring the primary phone pair. Not used for duplicate detection.
ALTER TABLE "Lead" ADD COLUMN "altPhone" TEXT;
ALTER TABLE "Lead" ADD COLUMN "altPhoneE164" TEXT;

-- CreateIndex: backs the format-agnostic phone search over the alternate number.
CREATE INDEX "Lead_altPhoneE164_idx" ON "Lead"("altPhoneE164");
