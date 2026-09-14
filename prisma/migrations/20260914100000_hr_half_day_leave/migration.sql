-- Half-day leave: let an employee apply for the FIRST or SECOND half of a day,
-- not just a whole one.
--
-- Both columns are nullable with no default and no backfill: every existing
-- row is a full-day leave request (NULL) or a biometric-derived half-day whose
-- half is still inferred from punch deviations (NULL), which is exactly what
-- NULL already means in the new code. Nothing to migrate.

-- Which half a LEAVE request is asking for: 'AM' (first half) | 'PM' (second
-- half) | NULL (full day). Always NULL on punch / note requests.
ALTER TABLE "HrAttendanceRegularization" ADD COLUMN "halfSession" TEXT;

-- Which half of an HD day the employee DECLARED, carried over when a half-day
-- leave request is approved. NULL on biometric-derived HDs, where the half is
-- inferred from lateMinutes / earlyOutMinutes instead (inferHdLeaveHalf). A
-- declared half wins over that inference for the sandwich rule.
ALTER TABLE "HrAttendanceDay" ADD COLUMN "halfSession" TEXT;
