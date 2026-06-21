-- AlterTable: deal fields + 1:1 link to a Lead Pulse pipeline entry
ALTER TABLE "Lead" ADD COLUMN "expectedValue" DECIMAL(14,2);
ALTER TABLE "Lead" ADD COLUMN "expectedCloseDate" DATE;
ALTER TABLE "Lead" ADD COLUMN "pipelineId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Lead_pipelineId_key" ON "Lead"("pipelineId");

-- CreateIndex
CREATE INDEX "Lead_expectedCloseDate_idx" ON "Lead"("expectedCloseDate");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "LeadPulsePipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;
