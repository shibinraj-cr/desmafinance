-- AlterTable: preserve a candidate's ORIGINAL acquisition source on a
-- re-enrollment lead. On a second-service enrollment the lead's primary
-- `sourceId` is set to the "Existing Candidate" source (so repeat business is
-- its own bucket in the source funnel); `originalSourceId` keeps the channel the
-- candidate first came in through so attribution is never lost.
ALTER TABLE "Lead" ADD COLUMN "originalSourceId" TEXT;

-- CreateIndex: backs source-attribution lookups on the preserved original source.
CREATE INDEX "Lead_originalSourceId_idx" ON "Lead"("originalSourceId");

-- AddForeignKey: same SetNull semantics as the primary `sourceId` FK.
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_originalSourceId_fkey" FOREIGN KEY ("originalSourceId") REFERENCES "LeadPulseSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
