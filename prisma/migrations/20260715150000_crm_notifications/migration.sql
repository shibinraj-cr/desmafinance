-- Per-user in-app CRM notifications (e.g. "a lead was assigned to you"), keyed
-- to User so they reach BDEs who have no HR Employee record — the HR-scoped
-- HrNotification/Receipt pair can't serve CRM users. Plus a per-user preference
-- (LeadPulseRole.notifyOnAssign) that gates whether an assignment writes a row.
-- Rows are cosmetic history written best-effort by notifyLeadAssigned().

-- CreateTable
CREATE TABLE "CrmNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'lead_assigned',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkUrl" TEXT,
    "leadId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmNotification_userId_readAt_idx" ON "CrmNotification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "CrmNotification_userId_createdAt_idx" ON "CrmNotification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CrmNotification" ADD CONSTRAINT "CrmNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: per-user opt-out for lead-assignment notifications (default on)
ALTER TABLE "LeadPulseRole" ADD COLUMN "notifyOnAssign" BOOLEAN NOT NULL DEFAULT true;
