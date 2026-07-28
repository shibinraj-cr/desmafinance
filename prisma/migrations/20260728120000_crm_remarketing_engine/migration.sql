-- Re-marketing nurturing engine. A CrmRemarketingCampaign row is opened when a
-- lead enters the Re-marketing stage; the daily scheduler (/api/cron/crm-webhooks
-- → runRemarketingScheduler) sends three WhatsApp touch-points through the shared
-- Wabis outbox (CrmWebhookDelivery, event 'remarketing_touch') on a calendar
-- schedule, and closes the campaign 'responded' (candidate replied in Wabis),
-- 'completed' (silent) or 'stopped' (left the stage). See src/lib/crm-remarketing.ts.

-- AlterTable: when the lead most recently entered Re-marketing (schedule anchor).
ALTER TABLE "Lead" ADD COLUMN "remarketingStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CrmRemarketingCampaign" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'running',
    "touch1SentAt" TIMESTAMP(3),
    "touch2SentAt" TIMESTAMP(3),
    "touch3SentAt" TIMESTAMP(3),
    "endedReason" TEXT,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmRemarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmRemarketingCampaign_status_idx" ON "CrmRemarketingCampaign"("status");

-- CreateIndex
CREATE INDEX "CrmRemarketingCampaign_leadId_status_idx" ON "CrmRemarketingCampaign"("leadId", "status");

-- CreateIndex
CREATE INDEX "CrmRemarketingCampaign_startedAt_idx" ON "CrmRemarketingCampaign"("startedAt");

-- AddForeignKey
ALTER TABLE "CrmRemarketingCampaign" ADD CONSTRAINT "CrmRemarketingCampaign_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
