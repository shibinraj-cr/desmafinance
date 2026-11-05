-- HR approving a salary run raises one Finance draft per employee. Additive:
-- existing drafts keep a NULL salaryRunId (NULLs never collide in the unique
-- index) and existing runs keep a NULL financeSubmittedAt.
ALTER TABLE "HrSalaryRun" ADD COLUMN "financeSubmittedAt" TIMESTAMP(3);

ALTER TABLE "TransactionDraft" ADD COLUMN "salaryRunId" TEXT;

CREATE UNIQUE INDEX "TransactionDraft_salaryRunId_employeeId_key" ON "TransactionDraft"("salaryRunId", "employeeId");

ALTER TABLE "TransactionDraft" ADD CONSTRAINT "TransactionDraft_salaryRunId_fkey" FOREIGN KEY ("salaryRunId") REFERENCES "HrSalaryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
