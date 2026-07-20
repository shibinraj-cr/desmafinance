-- AlterTable: lead temperature — the consultant's read on how hot the
-- opportunity is ('hot' | 'warm' | 'cold'; null = not yet rated). A fixed
-- value set (no master table) backing the leads-list Temperature column/filter.
ALTER TABLE "Lead" ADD COLUMN "temperature" TEXT;

-- CreateIndex: backs the leads-list Temperature filter.
CREATE INDEX "Lead_temperature_idx" ON "Lead"("temperature");
