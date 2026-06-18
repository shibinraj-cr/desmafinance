-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "externalKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Lead_externalKey_key" ON "Lead"("externalKey");
