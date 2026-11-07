-- Voxbay CDR webhook (src/app/api/crm/voxbay/webhook). Purely additive: new
-- nullable columns, or NOT NULL ones with a constant default, on "VoxbayCall"
-- and one new table. The live deployment keeps writing report uploads while
-- this applies, and the defaults describe exactly what it writes: an
-- 'incoming' row from an 'upload'.
--
-- "VoxbayWebhookEvent" logs every delivery, so a retry is recognised by its
-- X-Voxbay-Event-Id and a failed one can be found and re-sent from Voxbay.

-- AlterTable
ALTER TABLE "VoxbayCall" ADD COLUMN     "agentEmail" TEXT,
ADD COLUMN     "agentPhone" TEXT,
ADD COLUMN     "agentUserId" TEXT,
ADD COLUMN     "callEndTime" TIMESTAMP(3),
ADD COLUMN     "direction" TEXT NOT NULL DEFAULT 'incoming',
ADD COLUMN     "leadId" TEXT,
ADD COLUMN     "leadUnmatched" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phoneE164" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'upload',
ADD COLUMN     "voxbayCallId" TEXT;

-- CreateTable
CREATE TABLE "VoxbayWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "eventType" TEXT,
    "attempt" INTEGER,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "signatureOk" BOOLEAN NOT NULL DEFAULT false,
    "callId" TEXT,
    "rawBody" JSONB,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoxbayWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoxbayWebhookEvent_eventId_key" ON "VoxbayWebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "VoxbayWebhookEvent_receivedAt_idx" ON "VoxbayWebhookEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "VoxbayWebhookEvent_status_idx" ON "VoxbayWebhookEvent"("status");

-- CreateIndex
CREATE INDEX "VoxbayWebhookEvent_callId_idx" ON "VoxbayWebhookEvent"("callId");

-- CreateIndex
CREATE UNIQUE INDEX "VoxbayCall_voxbayCallId_key" ON "VoxbayCall"("voxbayCallId");

-- CreateIndex
CREATE INDEX "VoxbayCall_phoneE164_callStartTime_idx" ON "VoxbayCall"("phoneE164", "callStartTime");

-- CreateIndex
CREATE INDEX "VoxbayCall_leadId_idx" ON "VoxbayCall"("leadId");

-- CreateIndex
CREATE INDEX "VoxbayCall_agentUserId_idx" ON "VoxbayCall"("agentUserId");

-- CreateIndex
CREATE INDEX "VoxbayCall_leadUnmatched_idx" ON "VoxbayCall"("leadUnmatched");

-- AddForeignKey
ALTER TABLE "VoxbayCall" ADD CONSTRAINT "VoxbayCall_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoxbayCall" ADD CONSTRAINT "VoxbayCall_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

