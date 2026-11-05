-- CreateTable
CREATE TABLE "LeadPulseIncentive" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "minimum" INTEGER,
    "slab1From" INTEGER,
    "slab1Rate" INTEGER,
    "slab2From" INTEGER,
    "slab2Rate" INTEGER,
    "slab3From" INTEGER,
    "slab3Rate" INTEGER,
    "slab4From" INTEGER,
    "slab4Rate" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadPulseIncentive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulseIncentiveMonth" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "targetBonus" INTEGER NOT NULL DEFAULT 0,
    "fastCloseBonus" INTEGER NOT NULL DEFAULT 0,
    "referralBonus" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadPulseIncentiveMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulseTeam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadPulseTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulseTeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadPulseTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulseTeamTarget" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "periodType" TEXT NOT NULL,
    "period" INTEGER NOT NULL,
    "target" INTEGER NOT NULL,
    "pool" INTEGER NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadPulseTeamTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadPulseIncentive_userId_idx" ON "LeadPulseIncentive"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseIncentive_year_month_userId_key" ON "LeadPulseIncentive"("year", "month", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseIncentiveMonth_year_month_key" ON "LeadPulseIncentiveMonth"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseTeam_name_key" ON "LeadPulseTeam"("name");

-- CreateIndex
CREATE INDEX "LeadPulseTeamMember_teamId_year_month_idx" ON "LeadPulseTeamMember"("teamId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseTeamMember_year_month_userId_key" ON "LeadPulseTeamMember"("year", "month", "userId");

-- CreateIndex
CREATE INDEX "LeadPulseTeamTarget_year_periodType_period_idx" ON "LeadPulseTeamTarget"("year", "periodType", "period");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseTeamTarget_teamId_year_periodType_period_key" ON "LeadPulseTeamTarget"("teamId", "year", "periodType", "period");

-- AddForeignKey
ALTER TABLE "LeadPulseIncentive" ADD CONSTRAINT "LeadPulseIncentive_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseTeamMember" ADD CONSTRAINT "LeadPulseTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "LeadPulseTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseTeamMember" ADD CONSTRAINT "LeadPulseTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseTeamTarget" ADD CONSTRAINT "LeadPulseTeamTarget_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "LeadPulseTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

