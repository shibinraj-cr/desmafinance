-- WhatsApp broadcasts — marketing sends to a lead segment, run inside the CRM.

-- Opt-out. Distinct from whatsappUndeliverableAt (the number does not work);
-- this one means the candidate asked us to stop. Marketing sends honour it.
ALTER TABLE "Lead" ADD COLUMN "whatsappOptedOutAt" TIMESTAMP(3);

CREATE TABLE "WaBroadcast" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- The lead filter the audience was built from (LeadFilterParams shape), kept
    -- for provenance. The recipient rows are what actually gets sent.
    "segment" JSONB NOT NULL,
    "templateName" TEXT NOT NULL,
    "variableMap" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaBroadcast_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WaBroadcastRecipient" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "leadId" TEXT,
    "phoneE164" TEXT NOT NULL,
    "renderedParams" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "skipReason" TEXT,
    "providerMessageId" TEXT,
    "waStatus" TEXT,
    "waErrorCode" TEXT,
    "waErrorMessage" TEXT,
    "readAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaBroadcastRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WaBroadcast_status_scheduledAt_idx" ON "WaBroadcast"("status", "scheduledAt");
CREATE INDEX "WaBroadcast_createdAt_idx" ON "WaBroadcast"("createdAt");
CREATE INDEX "WaBroadcast_createdById_idx" ON "WaBroadcast"("createdById");

-- The guard that matters: the drain is chunked and resumable, so it WILL run
-- again over a partly-sent broadcast. Without this, a re-run sends a candidate
-- the same marketing message twice.
CREATE UNIQUE INDEX "WaBroadcastRecipient_broadcastId_leadId_key" ON "WaBroadcastRecipient"("broadcastId", "leadId");
-- What a delivery-status webhook matches on — exactly, not by phone and timing.
CREATE UNIQUE INDEX "WaBroadcastRecipient_providerMessageId_key" ON "WaBroadcastRecipient"("providerMessageId");
-- The drain's own query: the next pending recipients of one broadcast.
CREATE INDEX "WaBroadcastRecipient_broadcastId_status_idx" ON "WaBroadcastRecipient"("broadcastId", "status");
CREATE INDEX "WaBroadcastRecipient_phoneE164_idx" ON "WaBroadcastRecipient"("phoneE164");
CREATE INDEX "WaBroadcastRecipient_waStatus_idx" ON "WaBroadcastRecipient"("waStatus");

ALTER TABLE "WaBroadcast" ADD CONSTRAINT "WaBroadcast_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WaBroadcastRecipient" ADD CONSTRAINT "WaBroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "WaBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaBroadcastRecipient" ADD CONSTRAINT "WaBroadcastRecipient_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
