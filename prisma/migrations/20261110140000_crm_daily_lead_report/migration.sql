-- Daily Lead Report + Lead Handovers. Additive only: two new tables, four new
-- columns on CrmDailyReport, four lead sources, one setting. No existing row
-- changes except that already-submitted daily reports read as locked (the
-- default), which is what "submitting locks the day" means for them.

-- AlterTable
ALTER TABLE "CrmDailyReport" ADD COLUMN     "leadReport" JSONB,
ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "unlockedAt" TIMESTAMP(3),
ADD COLUMN     "unlockedById" TEXT;

-- CreateTable
CREATE TABLE "CrmLeadAssignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL,
    "contactDueAt" TIMESTAMP(3) NOT NULL,
    "firstContactedAt" TIMESTAMP(3),
    "contactStatus" TEXT NOT NULL DEFAULT 'pending',
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLeadAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLeadHandover" (
    "id" TEXT NOT NULL,
    "handoverDate" DATE NOT NULL,
    "channel" TEXT NOT NULL,
    "leadName" TEXT,
    "phone" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "assignedBdeId" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "linkedLeadId" TEXT,
    "rejectReason" TEXT,
    "rejectNote" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actionedAt" TIMESTAMP(3),
    "actionedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLeadHandover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmLeadAssignment_userId_assignedAt_idx" ON "CrmLeadAssignment"("userId", "assignedAt");

-- CreateIndex
CREATE INDEX "CrmLeadAssignment_userId_contactDueAt_idx" ON "CrmLeadAssignment"("userId", "contactDueAt");

-- CreateIndex
CREATE INDEX "CrmLeadAssignment_contactStatus_contactDueAt_idx" ON "CrmLeadAssignment"("contactStatus", "contactDueAt");

-- CreateIndex
CREATE INDEX "CrmLeadAssignment_leadId_endedAt_idx" ON "CrmLeadAssignment"("leadId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLeadAssignment_leadId_userId_assignedAt_key" ON "CrmLeadAssignment"("leadId", "userId", "assignedAt");

-- CreateIndex
CREATE INDEX "CrmLeadHandover_assignedBdeId_handoverDate_idx" ON "CrmLeadHandover"("assignedBdeId", "handoverDate");

-- CreateIndex
CREATE INDEX "CrmLeadHandover_phoneE164_status_idx" ON "CrmLeadHandover"("phoneE164", "status");

-- CreateIndex
CREATE INDEX "CrmLeadHandover_status_dueAt_idx" ON "CrmLeadHandover"("status", "dueAt");

-- CreateIndex
CREATE INDEX "CrmLeadHandover_handoverDate_idx" ON "CrmLeadHandover"("handoverDate");

-- CreateIndex
CREATE INDEX "CrmLeadHandover_linkedLeadId_idx" ON "CrmLeadHandover"("linkedLeadId");

-- CreateIndex
CREATE INDEX "CrmLeadHandover_createdById_idx" ON "CrmLeadHandover"("createdById");

-- CreateIndex
CREATE INDEX "CrmLeadHandover_actionedById_idx" ON "CrmLeadHandover"("actionedById");

-- CreateIndex
CREATE INDEX "CrmDailyReport_unlockedById_idx" ON "CrmDailyReport"("unlockedById");

-- AddForeignKey
ALTER TABLE "CrmDailyReport" ADD CONSTRAINT "CrmDailyReport_unlockedById_fkey" FOREIGN KEY ("unlockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLeadAssignment" ADD CONSTRAINT "CrmLeadAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLeadAssignment" ADD CONSTRAINT "CrmLeadAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLeadHandover" ADD CONSTRAINT "CrmLeadHandover_assignedBdeId_fkey" FOREIGN KEY ("assignedBdeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLeadHandover" ADD CONSTRAINT "CrmLeadHandover_linkedLeadId_fkey" FOREIGN KEY ("linkedLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLeadHandover" ADD CONSTRAINT "CrmLeadHandover_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLeadHandover" ADD CONSTRAINT "CrmLeadHandover_actionedById_fkey" FOREIGN KEY ("actionedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Lead sources for leads created from a handover (the Marketing Admin's
-- "walk-in", "phone", "personal WhatsApp" and "other" channels). YouTube and
-- referral handovers reuse the existing YouTube and Candidate Referral sources.
-- Guarded on code AND label, like the Insta and WA API sources: if an admin
-- already made one in Master Data, that row is used instead of a duplicate.
INSERT INTO "LeadPulseSource" ("id", "code", "label", "displayOrder", "active", "createdAt", "updatedAt")
SELECT v."id", v."code", v."label", v."displayOrder", true, NOW(), NOW()
FROM (VALUES
  ('lpsrc_walk_in_seed', 'walk_in', 'Walk-in', 20),
  ('lpsrc_phone_direct_seed', 'phone_direct', 'Phone (direct)', 21),
  ('lpsrc_wa_personal_seed', 'whatsapp_personal', 'WhatsApp (personal)', 22),
  ('lpsrc_other_seed', 'other', 'Other', 23)
) AS v("id", "code", "label", "displayOrder")
WHERE NOT EXISTS (
  SELECT 1 FROM "LeadPulseSource" s WHERE s."code" = v."code" OR lower(s."label") = lower(v."label")
);

-- When contact tracking starts: the moment this migration runs. Only
-- assignments made from now on are tracked, so the day it goes live nobody's
-- report fills with old leads that were never under this rule.
INSERT INTO "AppSetting" ("key", "value", "createdAt", "updatedAt")
VALUES ('crm_lead_report_start', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
