-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "autoMatched" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pendingEntryRef" TEXT,
ADD COLUMN     "transferPairId" TEXT;

-- CreateIndex
CREATE INDEX "BankTransaction_transferPairId_idx" ON "BankTransaction"("transferPairId");

