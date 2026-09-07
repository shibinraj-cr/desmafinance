-- AlterTable
ALTER TABLE "HiringCandidate" ADD COLUMN     "resumeHash" TEXT;

-- CreateTable
CREATE TABLE "HiringResumeSource" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "driveFolderId" TEXT NOT NULL,
    "folderName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringResumeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringIngestBatch" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "jobId" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'upload',
    "status" TEXT NOT NULL DEFAULT 'parsing',
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "parsedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringIngestBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringIngestItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "externalId" TEXT,
    "fileHash" TEXT NOT NULL,
    "blobUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "parsed" JSONB,
    "candidateId" TEXT,
    "duplicateOfId" TEXT,
    "duplicateVia" TEXT,
    "suggestions" JSONB,
    "aiScore" INTEGER,
    "aiScoreBreakdown" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringIngestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HiringResumeSource_driveFolderId_key" ON "HiringResumeSource"("driveFolderId");

-- CreateIndex
CREATE INDEX "HiringResumeSource_jobId_isActive_idx" ON "HiringResumeSource"("jobId", "isActive");

-- CreateIndex
CREATE INDEX "HiringIngestBatch_jobId_createdAt_idx" ON "HiringIngestBatch"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "HiringIngestBatch_status_idx" ON "HiringIngestBatch"("status");

-- CreateIndex
CREATE INDEX "HiringIngestItem_batchId_status_idx" ON "HiringIngestItem"("batchId", "status");

-- CreateIndex
CREATE INDEX "HiringIngestItem_duplicateOfId_idx" ON "HiringIngestItem"("duplicateOfId");

-- CreateIndex
CREATE UNIQUE INDEX "HiringIngestItem_batchId_fileHash_key" ON "HiringIngestItem"("batchId", "fileHash");

-- CreateIndex
CREATE INDEX "HiringCandidate_resumeHash_idx" ON "HiringCandidate"("resumeHash");

-- AddForeignKey
ALTER TABLE "HiringResumeSource" ADD CONSTRAINT "HiringResumeSource_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "HiringJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringResumeSource" ADD CONSTRAINT "HiringResumeSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringIngestBatch" ADD CONSTRAINT "HiringIngestBatch_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "HiringResumeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringIngestBatch" ADD CONSTRAINT "HiringIngestBatch_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "HiringJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringIngestBatch" ADD CONSTRAINT "HiringIngestBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringIngestItem" ADD CONSTRAINT "HiringIngestItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "HiringIngestBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringIngestItem" ADD CONSTRAINT "HiringIngestItem_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "HiringCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

