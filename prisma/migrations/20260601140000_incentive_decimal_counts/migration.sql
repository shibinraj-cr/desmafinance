-- Allow fractional enrolment quantities (.5 enrolments for some services).
-- Widening INTEGER -> DOUBLE PRECISION is lossless; existing rows are preserved.
ALTER TABLE "IncentivePlan" ALTER COLUMN "boostThreshold" SET DATA TYPE DOUBLE PRECISION;
ALTER TABLE "IncentivePlan" ALTER COLUMN "teamTarget" SET DATA TYPE DOUBLE PRECISION;
ALTER TABLE "IncentiveBde" ALTER COLUMN "minimum" SET DATA TYPE DOUBLE PRECISION;
ALTER TABLE "IncentiveBde" ALTER COLUMN "target" SET DATA TYPE DOUBLE PRECISION;
ALTER TABLE "IncentiveBde" ALTER COLUMN "enrol" SET DATA TYPE DOUBLE PRECISION;
