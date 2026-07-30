-- CreateTable
CREATE TABLE "CrmDailyReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "summary" TEXT NOT NULL,
    "blockers" TEXT,
    "planNext" TEXT,
    "metrics" JSONB NOT NULL,
    "details" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmDailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmDailyReport_day_status_idx" ON "CrmDailyReport"("day", "status");

-- CreateIndex
CREATE INDEX "CrmDailyReport_reviewedById_idx" ON "CrmDailyReport"("reviewedById");

-- CreateIndex
CREATE UNIQUE INDEX "CrmDailyReport_userId_day_key" ON "CrmDailyReport"("userId", "day");

-- CreateIndex
CREATE INDEX "LeadActivity_actorId_occurredAt_idx" ON "LeadActivity"("actorId", "occurredAt");

-- AddForeignKey
ALTER TABLE "CrmDailyReport" ADD CONSTRAINT "CrmDailyReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDailyReport" ADD CONSTRAINT "CrmDailyReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

