-- CrmTaskReminder: the candidate-facing safety net behind an overdue CRM task.
-- One row per task PER CHANNEL, because email and WhatsApp fail independently
-- and a single row could only record one outcome. Content is frozen at arm time
-- so a later edit to the default template cannot rewrite what a consultant
-- already reviewed.
CREATE TABLE "CrmTaskReminder" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "fireAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "skipReason" TEXT,
    "templateName" TEXT,
    "templateParams" JSONB,
    "subject" TEXT,
    "body" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmTaskReminder_pkey" PRIMARY KEY ("id")
);

-- One reminder per task per channel. The drain is chunked and resumable, so it
-- WILL run again over a partly-sent batch; without this nothing stops a
-- candidate being messaged twice for the same task.
CREATE UNIQUE INDEX "CrmTaskReminder_taskId_channel_key" ON "CrmTaskReminder"("taskId", "channel");

-- The drain's own query: what is due to fire now.
CREATE INDEX "CrmTaskReminder_status_fireAt_idx" ON "CrmTaskReminder"("status", "fireAt");
-- The cooldown lookup: this lead's most recent send.
CREATE INDEX "CrmTaskReminder_leadId_sentAt_idx" ON "CrmTaskReminder"("leadId", "sentAt");

ALTER TABLE "CrmTaskReminder" ADD CONSTRAINT "CrmTaskReminder_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "CrmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmTaskReminder" ADD CONSTRAINT "CrmTaskReminder_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmTaskReminder" ADD CONSTRAINT "CrmTaskReminder_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
