-- CreateTable
CREATE TABLE "FinanceDocFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceDocFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceDocument" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "folderId" TEXT,
    "blobPathname" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceDocShare" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "documentId" TEXT,
    "folderId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceDocShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceDocFolder_parentId_idx" ON "FinanceDocFolder"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceDocument_blobPathname_key" ON "FinanceDocument"("blobPathname");

-- CreateIndex
CREATE INDEX "FinanceDocument_folderId_idx" ON "FinanceDocument"("folderId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceDocShare_token_key" ON "FinanceDocShare"("token");

-- CreateIndex
CREATE INDEX "FinanceDocShare_documentId_idx" ON "FinanceDocShare"("documentId");

-- CreateIndex
CREATE INDEX "FinanceDocShare_folderId_idx" ON "FinanceDocShare"("folderId");

-- AddForeignKey
ALTER TABLE "FinanceDocFolder" ADD CONSTRAINT "FinanceDocFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FinanceDocFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDocFolder" ADD CONSTRAINT "FinanceDocFolder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDocument" ADD CONSTRAINT "FinanceDocument_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "FinanceDocFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDocument" ADD CONSTRAINT "FinanceDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDocShare" ADD CONSTRAINT "FinanceDocShare_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinanceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDocShare" ADD CONSTRAINT "FinanceDocShare_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "FinanceDocFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDocShare" ADD CONSTRAINT "FinanceDocShare_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

