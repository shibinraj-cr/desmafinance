-- WhatsApp conversations mirrored into the CRM.
--
-- Phase 1 of moving the shared inbox out of Wabis: store the conversation on
-- our side so a BDE can read what was said without leaving the CRM. Both tables
-- are provider-agnostic — a message relayed by Wabis and one delivered straight
-- from Meta's Cloud API land in the same shape.

-- One thread per candidate number. `leadId` is nullable and SetNull: a message
-- can arrive from a number we have never seen (the ingest path creates a lead),
-- and deleting a lead must not take the conversation history with it.
CREATE TABLE "WaConversation" (
    "id" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "leadId" TEXT,
    "assignedToId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "lastMessageAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "sessionExpiresAt" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WaMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT,
    "mediaId" TEXT,
    "mediaUrl" TEXT,
    "mediaMime" TEXT,
    "fileName" TEXT,
    "providerMessageId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'wabis',
    "templateName" TEXT,
    "waStatus" TEXT,
    "waErrorCode" TEXT,
    "waErrorMessage" TEXT,
    "readAt" TIMESTAMP(3),
    "sentById" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
);

-- One thread per number, whatever else shares it.
CREATE UNIQUE INDEX "WaConversation_phoneE164_key" ON "WaConversation"("phoneE164");
CREATE INDEX "WaConversation_leadId_idx" ON "WaConversation"("leadId");
CREATE INDEX "WaConversation_assignedToId_status_idx" ON "WaConversation"("assignedToId", "status");
CREATE INDEX "WaConversation_status_lastMessageAt_idx" ON "WaConversation"("status", "lastMessageAt");
-- "which threads can I still send free text to" as a range scan.
CREATE INDEX "WaConversation_sessionExpiresAt_idx" ON "WaConversation"("sessionExpiresAt");

-- The idempotency guard: webhooks are re-delivered, so a replay must collide
-- here rather than duplicate the thread.
CREATE UNIQUE INDEX "WaMessage_providerMessageId_key" ON "WaMessage"("providerMessageId");
CREATE INDEX "WaMessage_conversationId_occurredAt_idx" ON "WaMessage"("conversationId", "occurredAt");
CREATE INDEX "WaMessage_direction_waStatus_idx" ON "WaMessage"("direction", "waStatus");
CREATE INDEX "WaMessage_occurredAt_idx" ON "WaMessage"("occurredAt");

ALTER TABLE "WaConversation" ADD CONSTRAINT "WaConversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WaConversation" ADD CONSTRAINT "WaConversation_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WaConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
