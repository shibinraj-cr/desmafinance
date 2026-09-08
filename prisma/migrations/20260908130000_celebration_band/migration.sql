-- Celebration band + greeting.
--
-- Who is celebrating today is derived from Employee.dob / Employee.joinDate at
-- read time, so nothing here stores a schedule. What is stored is (a) the
-- employee's own opt-out, (b) HR's switches, and (c) one row per greeting
-- actually shown, so it fires exactly once a year across devices.

-- The employee's own call: keep me off the band and don't greet me.
ALTER TABLE "Employee" ADD COLUMN "celebrationOptOut" BOOLEAN NOT NULL DEFAULT false;

-- HR switches. Defaults reproduce the behaviour described in
-- CELEBRATION_DEFAULTS (src/lib/celebrations.ts): band and greeting on,
-- anniversaries included every year, age withheld.
ALTER TABLE "HrBirthdaySettings"
  ADD COLUMN "bandEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "greetingEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "anniversaryEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "showAge" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "anniversaryTemplate" TEXT NOT NULL DEFAULT 'Thank you for everything you have built here, {{name}}. Here is to the year ahead. — Team DESMA';

-- DESMA is the company; DesGro is the ERP. The birthday template has signed
-- off as the software since 0_init. Correct the column default, and correct
-- any saved row that is still carrying the shipped default verbatim — a row
-- HR has actually edited is left alone.
ALTER TABLE "HrBirthdaySettings"
  ALTER COLUMN "template"
  SET DEFAULT 'Happy birthday, {{name}}! Wishing you a wonderful year ahead. — Team DESMA';

UPDATE "HrBirthdaySettings"
   SET "template" = 'Happy birthday, {{name}}! Wishing you a wonderful year ahead. — Team DESMA'
 WHERE "template" = 'Happy birthday, {{name}}! Wishing you a wonderful year ahead. — Team DESGRO';

-- One row per greeting shown. The unique key is the idempotency guarantee.
CREATE TABLE "HrCelebration" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "years" INTEGER,
    "greetedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrCelebration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HrCelebration_employeeId_kind_year_key"
  ON "HrCelebration"("employeeId", "kind", "year");

CREATE INDEX "HrCelebration_year_idx" ON "HrCelebration"("year");

ALTER TABLE "HrCelebration"
  ADD CONSTRAINT "HrCelebration_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
