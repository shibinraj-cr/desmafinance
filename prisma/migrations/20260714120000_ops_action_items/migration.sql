-- Ad-hoc, assignable tasks ("Task" in the UI) attached to a process step
-- (OpsTask). Advisory: an open action item never blocks its step or the
-- project from completing. `completedById` is stamped at completion so
-- attribution survives project re-assignment (same as OpsTask.completedBy).

-- CreateTable
CREATE TABLE "OpsActionItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignedToId" TEXT,
    "dueAt" TIMESTAMP(3),
    "createdById" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpsActionItem_assignedToId_status_dueAt_idx" ON "OpsActionItem"("assignedToId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "OpsActionItem_taskId_idx" ON "OpsActionItem"("taskId");

-- CreateIndex
CREATE INDEX "OpsActionItem_projectId_idx" ON "OpsActionItem"("projectId");

-- AddForeignKey
ALTER TABLE "OpsActionItem" ADD CONSTRAINT "OpsActionItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "OpsProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsActionItem" ADD CONSTRAINT "OpsActionItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OpsTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsActionItem" ADD CONSTRAINT "OpsActionItem_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsActionItem" ADD CONSTRAINT "OpsActionItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsActionItem" ADD CONSTRAINT "OpsActionItem_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
