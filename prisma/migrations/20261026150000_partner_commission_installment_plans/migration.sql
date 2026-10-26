-- Partner Commissions: installment plans. A program can offer plans picked when
-- enrolling (GCAN: 1, 2 or 6 installments); the enrollment keeps its plan, which
-- caps its installments. Additive: two columns.
-- AlterTable
ALTER TABLE "CommissionProgram" ADD COLUMN     "installmentPlans" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "CommissionEnrollment" ADD COLUMN     "installmentPlan" INTEGER;


-- GCAN offers 1, 2 or 6 installments (only if GCAN is set up already; a new GCAN
-- program gets the same options pre-filled on the Settings tab).
UPDATE "CommissionProgram" SET "installmentPlans" = ARRAY[1, 2, 6] WHERE "code" = 'GCAN' AND cardinality("installmentPlans") = 0;
