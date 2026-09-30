-- Employee statutory identifiers for the monthly PF (ECR) and ESI returns.
--   uan         EPF Universal Account Number → "UAN No" column of the ECR sheet.
--   esiIpNumber ESIC Insured Person number   → "IP Number" column of the ESI upload.
--   epsExempt   member not enrolled in EPS (post-Sep-2014 joiner above the wage
--               ceiling, or past 58): employer PF share goes wholly to EPF. Pure
--               EPS↔EPF reallocation — contribution totals are unchanged.

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "uan" TEXT;
ALTER TABLE "Employee" ADD COLUMN "esiIpNumber" TEXT;
ALTER TABLE "Employee" ADD COLUMN "epsExempt" BOOLEAN NOT NULL DEFAULT false;
