-- AlterTable: preferred study-abroad destination country (distinct from the
-- candidate's home `country`). Free-form name from the country dropdown.
ALTER TABLE "Lead" ADD COLUMN "studyDestination" TEXT;

-- CreateIndex: backs the leads-list "Study Destination" filter/segmentation.
CREATE INDEX "Lead_studyDestination_idx" ON "Lead"("studyDestination");
