-- Partner Commissions: a program can pay a flat commission per enrollment (e.g.
-- GCAN) instead of a percentage of the course fee. Additive: three nullable
-- columns. The amount itself is set on the Settings tab, not here.
-- AlterTable
ALTER TABLE "CommissionProgram" ADD COLUMN     "defaultFlat" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "CommissionEnrollment" ADD COLUMN     "commissionFlat" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "CommissionInvoiceLine" ADD COLUMN     "commissionFlat" DECIMAL(12,2);

