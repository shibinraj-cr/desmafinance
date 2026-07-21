-- Transactional outbox for outbound CRM webhooks — the Wabis WhatsApp
-- automation fires one delivery per lead assignment. The row is written before
-- the HTTP call is attempted so a delivery survives the serverless instance
-- being killed mid-retry; whatever is still 'pending' is drained by
-- /api/cron/crm-webhooks. "dedupeKey" ("lead_assigned:<leadId>:<assigneeUserId>")
-- stops the same lead+consultant pair sending twice; the broader "one
-- introduction per lead" rule lives in enqueueLeadAssignedWebhook, because with
-- the re-fire setting on, multiple rows per lead are intentional.

-- CreateTable
CREATE TABLE "CrmWebhookDelivery" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "leadId" TEXT,
    "assigneeUserId" TEXT,
    "url" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmWebhookDelivery_dedupeKey_key" ON "CrmWebhookDelivery"("dedupeKey");

-- CreateIndex
CREATE INDEX "CrmWebhookDelivery_status_nextAttemptAt_idx" ON "CrmWebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "CrmWebhookDelivery_leadId_idx" ON "CrmWebhookDelivery"("leadId");

-- CreateIndex
CREATE INDEX "CrmWebhookDelivery_createdAt_idx" ON "CrmWebhookDelivery"("createdAt");
