-- Employee counterparty for transactions + drafts (salary / incentive outflows).
-- Additive and nullable: a transaction carries EITHER partyId OR employeeId,
-- enforced at the app layer so legacy party-less rows stay valid.

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "employeeId" TEXT;
ALTER TABLE "TransactionDraft" ADD COLUMN "employeeId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_employeeId_idx" ON "Transaction"("employeeId");
CREATE INDEX "TransactionDraft_employeeId_idx" ON "TransactionDraft"("employeeId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TransactionDraft" ADD CONSTRAINT "TransactionDraft_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
