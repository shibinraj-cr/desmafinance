-- Executive Meeting Notes — sharing and action-item reminders.
--
-- 1. ExecMeetingShare: a meeting shared with specific users, who read it under
--    My Workspace → Meetings.
-- 2. ExecMeetingAction.ownerUserId / snoozedUntil: an action item's owner can
--    be a login, who then gets a reminder pop-up from the due date until they
--    update it ("remind me tomorrow" sets snoozedUntil).
--
-- Additive only: one new table and two nullable columns; existing rows keep
-- their free-text owner and simply get no reminders until linked.

-- AlterTable
ALTER TABLE "ExecMeetingAction" ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "snoozedUntil" DATE;

-- CreateTable
CREATE TABLE "ExecMeetingShare" (
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sharedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecMeetingShare_pkey" PRIMARY KEY ("meetingId","userId")
);

-- CreateIndex
CREATE INDEX "ExecMeetingShare_userId_idx" ON "ExecMeetingShare"("userId");

-- CreateIndex
CREATE INDEX "ExecMeetingAction_ownerUserId_doneAt_idx" ON "ExecMeetingAction"("ownerUserId", "doneAt");

-- AddForeignKey
ALTER TABLE "ExecMeetingShare" ADD CONSTRAINT "ExecMeetingShare_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "ExecMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
