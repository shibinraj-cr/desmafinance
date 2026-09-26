-- CreateTable
CREATE TABLE "MediaPlanItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idea',
    "publishDate" DATE,
    "publishTime" TEXT,
    "shootDate" DATE,
    "hook" TEXT,
    "ownerId" TEXT,
    "createdById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaPlanTask" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "dueDate" DATE,
    "assignedToId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "remindedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaPlanTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaPlanItem_publishDate_idx" ON "MediaPlanItem"("publishDate");

-- CreateIndex
CREATE INDEX "MediaPlanItem_status_publishDate_idx" ON "MediaPlanItem"("status", "publishDate");

-- CreateIndex
CREATE INDEX "MediaPlanTask_itemId_status_idx" ON "MediaPlanTask"("itemId", "status");

-- CreateIndex
CREATE INDEX "MediaPlanTask_status_dueDate_idx" ON "MediaPlanTask"("status", "dueDate");

-- AddForeignKey
ALTER TABLE "MediaPlanItem" ADD CONSTRAINT "MediaPlanItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaPlanItem" ADD CONSTRAINT "MediaPlanItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaPlanTask" ADD CONSTRAINT "MediaPlanTask_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MediaPlanItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaPlanTask" ADD CONSTRAINT "MediaPlanTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaPlanTask" ADD CONSTRAINT "MediaPlanTask_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

