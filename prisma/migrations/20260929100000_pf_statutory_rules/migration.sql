-- Effective-dated statutory PF rules (EPFO master data) + per-employee PF
-- configuration + frozen PF audit trail on payroll lines.
--
-- The payroll engine now selects PF rules by salary-period date instead of a
-- hard-coded ₹15,000 ceiling, so the 17 Sep 2026 EPFO ceiling revision
-- (₹15,000 → ₹25,000) applies from its effective date only. Historical runs
-- are untouched: recomputing an old period still resolves the old rule, and
-- approved runs carry their own frozen audit snapshot.

-- CreateTable
CREATE TABLE "HrPfRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "wageCeiling" DECIMAL(10,2) NOT NULL,
    "employeeRatePct" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "employerRatePct" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "epsRatePct" DECIMAL(5,2) NOT NULL DEFAULT 8.33,
    "epsApplicable" BOOLEAN NOT NULL DEFAULT true,
    "higherWageAllowed" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrPfRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrPfRule_code_key" ON "HrPfRule"("code");

-- CreateIndex
CREATE INDEX "HrPfRule_effectiveFrom_idx" ON "HrPfRule"("effectiveFrom");

-- AddForeignKey
ALTER TABLE "HrPfRule" ADD CONSTRAINT "HrPfRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Per-employee PF configuration. "ceiling" (the default every existing row
-- takes) reproduces today's behaviour exactly; "actual" marks higher-wage
-- members who contribute on full PF wages and must never be auto-reduced by
-- a ceiling change. pfVoluntaryPct is an optional employee-only VPF %.
ALTER TABLE "HrSalaryStructure" ADD COLUMN "pfBasis" TEXT NOT NULL DEFAULT 'ceiling';
ALTER TABLE "HrSalaryStructure" ADD COLUMN "pfVoluntaryPct" DECIMAL(5,2);

-- Frozen PF audit trail on each payroll line. Defaults keep every existing
-- (historical) line valid without a backfill — their contributions remain in
-- pfEmployee / pfEmployer exactly as computed at the time.
ALTER TABLE "HrSalaryRunLine" ADD COLUMN "pfWage" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "HrSalaryRunLine" ADD COLUMN "pfEmployerEpf" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "HrSalaryRunLine" ADD COLUMN "pfEmployerEps" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "HrSalaryRunLine" ADD COLUMN "pfRuleId" TEXT;
ALTER TABLE "HrSalaryRunLine" ADD COLUMN "pfRuleCode" TEXT;
ALTER TABLE "HrSalaryRunLine" ADD COLUMN "pfBasisApplied" TEXT;
ALTER TABLE "HrSalaryRunLine" ADD COLUMN "pfCeilingApplied" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HrSalaryRunLine" ADD COLUMN "pfDetail" JSONB;

-- Seed the statutory rule history. Fixed ids so re-running against a
-- restored dump stays idempotent.
--   PF_RULE_OLD : ₹15,000 ceiling, in force through 16 Sep 2026 (floor dated
--                 to the EPF scheme's inception so every historical payroll
--                 period is covered).
--   PF_RULE_2026: ₹25,000 ceiling, effective 17 Sep 2026, open-ended.
INSERT INTO "HrPfRule"
  ("id", "code", "wageCeiling", "employeeRatePct", "employerRatePct", "epsRatePct",
   "epsApplicable", "higherWageAllowed", "effectiveFrom", "effectiveTo", "notes", "updatedAt")
VALUES
  ('pf_rule_old_15000', 'PF_RULE_OLD', 15000, 12, 12, 8.33,
   true, true, DATE '1952-11-01', DATE '2026-09-16',
   'Statutory ₹15,000 PF wage ceiling — superseded by the EPFO revision effective 17 Sep 2026.',
   CURRENT_TIMESTAMP),
  ('pf_rule_2026_25000', 'PF_RULE_2026', 25000, 12, 12, 8.33,
   true, true, DATE '2026-09-17', NULL,
   'EPFO revised statutory PF wage ceiling ₹25,000, effective 17 Sep 2026.',
   CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
