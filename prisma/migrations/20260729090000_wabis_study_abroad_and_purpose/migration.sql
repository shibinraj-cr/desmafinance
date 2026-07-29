-- Study-abroad WhatsApp outreach.
--
-- Two additions:
--  1. Service.isStudyAbroad — flags the services whose leads get the per-lead
--     "Study-abroad WhatsApp" button.
--  2. WabisWebhookEndpoint.purpose — a Wabis workflow is tied to one template,
--     so the study-abroad counsellor intro is a DIFFERENT workflow from the
--     lead-assignment intro. Each consultant therefore holds one endpoint per
--     purpose. Existing rows are the lead-assignment intros, so they default to
--     'lead_assigned' and nothing about the current routing changes.
--
-- The active-per-consultant and active-default uniqueness must now be scoped by
-- purpose (one active intro endpoint AND one active study-abroad endpoint per
-- consultant), so the two partial indexes are dropped and recreated with
-- purpose in the key.

-- AlterTable
ALTER TABLE "Service" ADD COLUMN "isStudyAbroad" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WabisWebhookEndpoint" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'lead_assigned';

-- CreateIndex
CREATE INDEX "WabisWebhookEndpoint_purpose_idx" ON "WabisWebhookEndpoint"("purpose");

-- Re-scope the partial uniqueness by purpose. Drop first (order matters: the old
-- unscoped indexes would reject a second purpose for the same consultant).
DROP INDEX "WabisWebhookEndpoint_one_active_per_consultant";
DROP INDEX "WabisWebhookEndpoint_one_active_default";

-- At most one ACTIVE endpoint per (consultant, purpose).
CREATE UNIQUE INDEX "WabisWebhookEndpoint_one_active_per_consultant"
    ON "WabisWebhookEndpoint"("consultantId", "purpose")
    WHERE "isActive" AND "consultantId" IS NOT NULL;

-- At most one ACTIVE default per purpose.
CREATE UNIQUE INDEX "WabisWebhookEndpoint_one_active_default"
    ON "WabisWebhookEndpoint"("purpose")
    WHERE "isActive" AND "isDefault";
