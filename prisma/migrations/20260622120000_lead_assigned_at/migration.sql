-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "assignedAt" TIMESTAMP(3);

-- Backfill: for leads that are already assigned, use the most recent
-- ASSIGNED/REASSIGNED activity timestamp; fall back to the lead's createdAt
-- when no such activity row exists (e.g. very old / imported assignments).
UPDATE "Lead" l
SET "assignedAt" = COALESCE(
  (
    SELECT MAX(a."occurredAt")
    FROM "LeadActivity" a
    WHERE a."leadId" = l."id"
      AND a."type" IN ('ASSIGNED', 'REASSIGNED')
  ),
  l."createdAt"
)
WHERE l."assignedToId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "Lead_assignedAt_idx" ON "Lead"("assignedAt");
