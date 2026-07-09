-- AlterTable: candidate's official date of birth (date-only). Age is derived
-- from this at read time (never stored), so it stays current.
ALTER TABLE "Lead" ADD COLUMN "dob" DATE;

-- CreateIndex: backs the leads-list age-range filter (translated to a dob range).
CREATE INDEX "Lead_dob_idx" ON "Lead"("dob");
