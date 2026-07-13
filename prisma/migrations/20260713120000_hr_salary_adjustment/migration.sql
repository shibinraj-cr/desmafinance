-- Itemised, ad-hoc pay corrections per (run, employee): advance recovery, loan
-- EMI, penalty, incentive, arrears, reimbursement… Keyed by (runId, employeeId)
-- rather than by run-line so a Recompute (which deletes+recreates every
-- HrSalaryRunLine) does not wipe them. Deductions apply pre-statutory (shown
-- above ESI/PF/PT on the slip, but they never change the statutory amounts);
-- additions are paid on top of net.

-- CreateTable
CREATE TABLE "HrSalaryAdjustment" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrSalaryAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrSalaryAdjustment_runId_employeeId_idx" ON "HrSalaryAdjustment"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "HrSalaryAdjustment_employeeId_idx" ON "HrSalaryAdjustment"("employeeId");

-- AddForeignKey
ALTER TABLE "HrSalaryAdjustment" ADD CONSTRAINT "HrSalaryAdjustment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "HrSalaryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSalaryAdjustment" ADD CONSTRAINT "HrSalaryAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSalaryAdjustment" ADD CONSTRAINT "HrSalaryAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: preserve any pre-existing single-figure line adjustments as itemised
-- rows so a future Recompute (which rebuilds HrSalaryRunLine.adjustments from
-- these rows) does not silently drop them. Positive => addition, negative =>
-- deduction; amount stored positive. Deterministic id from the line id keeps this
-- idempotent and avoids a uuid-extension dependency.
INSERT INTO "HrSalaryAdjustment" ("id", "runId", "employeeId", "kind", "category", "amount", "note", "createdById", "createdAt", "updatedAt")
SELECT
    'legacy-adj-' || "id",
    "runId",
    "employeeId",
    CASE WHEN "adjustments" > 0 THEN 'addition' ELSE 'deduction' END,
    'other',
    ABS("adjustments"),
    "adjustmentNote",
    NULL,
    "createdAt",
    CURRENT_TIMESTAMP
FROM "HrSalaryRunLine"
WHERE "adjustments" <> 0;
