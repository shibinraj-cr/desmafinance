-- Executive Meeting Notes — leadership meetings with notes, decisions and
-- action items. Purely additive: two new tables, no ALTER on anything that
-- already exists, so applying it on production cannot disturb live data.

-- CreateTable
CREATE TABLE "ExecMeeting" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "meetingOn" DATE NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'leadership',
    "attendees" TEXT,
    "agenda" TEXT,
    "notes" TEXT,
    "decisions" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecMeetingAction" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "owner" TEXT,
    "dueOn" DATE,
    "doneAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecMeetingAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExecMeeting_meetingOn_idx" ON "ExecMeeting"("meetingOn");

-- CreateIndex
CREATE INDEX "ExecMeetingAction_meetingId_idx" ON "ExecMeetingAction"("meetingId");

-- CreateIndex
CREATE INDEX "ExecMeetingAction_doneAt_dueOn_idx" ON "ExecMeetingAction"("doneAt", "dueOn");

-- AddForeignKey
ALTER TABLE "ExecMeetingAction" ADD CONSTRAINT "ExecMeetingAction_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "ExecMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
