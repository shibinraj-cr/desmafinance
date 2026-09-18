-- Planned leave: a leave request may span a date RANGE, decided once.
-- Nullable and additive — every existing row keeps its meaning (a request
-- covering `date` alone), so no backfill is needed.
ALTER TABLE "HrAttendanceRegularization" ADD COLUMN     "toDate" DATE;
