-- AlterTable
ALTER TABLE "EsignRequest" ADD COLUMN     "currentPathname" TEXT,
ADD COLUMN     "currentSha256" TEXT;

-- AlterTable
ALTER TABLE "EsignSigner" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "EsignSigner_userId_idx" ON "EsignSigner"("userId");

-- AddForeignKey
ALTER TABLE "EsignSigner" ADD CONSTRAINT "EsignSigner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

