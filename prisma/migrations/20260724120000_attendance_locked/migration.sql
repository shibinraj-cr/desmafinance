-- AlterTable: mark an attendance day as an authoritative HR MANUAL override
-- (a regularization approval or a decide/override action) that the automatic
-- eTimeOffice biometric sync must never delete, replace, or recompute. Without
-- this, every sync tick (which delete-and-replaces the whole cycle window) was
-- silently reverting approved regularizations and HR decisions back to the raw
-- biometric value. Sandwich-rule flips are derived, so they stay UNLOCKED.
ALTER TABLE "HrAttendanceDay" ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: lock every day that already carries an HR manual decision so the
-- next sync after deploy doesn't wipe corrections made before this column
-- existed. A sandwich flip is the ONLY decidedAt-bearing day that is derived
-- (note starts with 'Sandwich') — it must stay sync-managed, so it is excluded.
-- `reset` days have decidedAt cleared, so they're naturally excluded.
UPDATE "HrAttendanceDay"
SET "locked" = true
WHERE "decidedAt" IS NOT NULL
  AND ("decisionNote" IS NULL OR "decisionNote" NOT LIKE 'Sandwich%');
