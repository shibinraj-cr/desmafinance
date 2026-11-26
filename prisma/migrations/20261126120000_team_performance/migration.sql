-- Team Performance module: after-hours WhatsApp candidate-support scores.

-- CreateTable
CREATE TABLE "PerfWaStaffDaily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "staff" TEXT NOT NULL,
    "queriesAnswered" INTEGER NOT NULL DEFAULT 0,
    "medianResponseMin" DOUBLE PRECISION,
    "avgAccuracy" DOUBLE PRECISION,
    "avgCompleteness" DOUBLE PRECISION,
    "avgTone" DOUBLE PRECISION,
    "avgNextStep" DOUBLE PRECISION,
    "closuresDone" INTEGER NOT NULL DEFAULT 0,
    "closuresNeeded" INTEGER NOT NULL DEFAULT 0,
    "sundayHolidayActive" BOOLEAN,
    "source" TEXT NOT NULL DEFAULT 'auto',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfWaStaffDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerfWaUnanswered" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "groupName" TEXT NOT NULL,
    "queryAt" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfWaUnanswered_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PerfWaStaffDaily_date_staff_key" ON "PerfWaStaffDaily"("date", "staff");
CREATE INDEX "PerfWaStaffDaily_date_idx" ON "PerfWaStaffDaily"("date");
CREATE INDEX "PerfWaStaffDaily_staff_idx" ON "PerfWaStaffDaily"("staff");
CREATE UNIQUE INDEX "PerfWaUnanswered_groupName_queryAt_key" ON "PerfWaUnanswered"("groupName", "queryAt");
CREATE INDEX "PerfWaUnanswered_date_idx" ON "PerfWaUnanswered"("date");
