-- AlterTable: regularization requests now carry a type — "punch" (correct a
-- missing/wrong punch, the existing behavior) or "leave" (request paid leave for
-- an absence). One employee-submitted queue covers both kinds of correction.
ALTER TABLE "HrAttendanceRegularization" ADD COLUMN "requestType" TEXT NOT NULL DEFAULT 'punch';
