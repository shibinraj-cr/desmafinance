-- AlterTable: the "details sent" clock.
--
-- Records the moment a consultant sent the candidate the actual process/fee
-- details, and the first reply that came back after it. Marked explicitly
-- rather than inferred from outbound traffic: details go out as free text or a
-- PDF inside a live chat, which no query can tell apart from a "hi". Together
-- the two columns answer the question the funnel could not — how many
-- candidates go dark after the pitch, and which ones are still owed a chase.
ALTER TABLE "Lead" ADD COLUMN "detailsSentAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "detailsSentById" TEXT;
ALTER TABLE "Lead" ADD COLUMN "detailsRespondedAt" TIMESTAMP(3);

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_detailsSentById_fkey"
  FOREIGN KEY ("detailsSentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backs the "Details sent · awaiting reply" filter (the BDE's daily chase list).
CREATE INDEX "Lead_detailsSentAt_idx" ON "Lead"("detailsSentAt");
CREATE INDEX "Lead_detailsSentById_idx" ON "Lead"("detailsSentById");

-- No backfill is possible or wanted: nothing in the history distinguishes a
-- pitch from a greeting, so every existing lead starts unmarked and the metric
-- begins accumulating honestly from the day this ships.
