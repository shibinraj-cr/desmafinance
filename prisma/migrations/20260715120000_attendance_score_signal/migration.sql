-- CreateTable
CREATE TABLE "HrAttendanceScoreSignal" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "inTime" TEXT,
    "outTime" TEXT,
    "lateMinutes" INTEGER,
    "earlyOutMinutes" INTEGER,
    "rawStatus" TEXT,
    "shiftCode" TEXT,
    "remark" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrAttendanceScoreSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrAttendanceScoreSignal_date_idx" ON "HrAttendanceScoreSignal"("date");

-- CreateIndex
CREATE UNIQUE INDEX "HrAttendanceScoreSignal_employeeId_date_key" ON "HrAttendanceScoreSignal"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "HrAttendanceScoreSignal" ADD CONSTRAINT "HrAttendanceScoreSignal_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

