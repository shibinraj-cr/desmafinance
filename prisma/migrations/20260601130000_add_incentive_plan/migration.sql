-- CreateTable
CREATE TABLE "IncentivePlan" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "baseRate" INTEGER NOT NULL DEFAULT 1000,
    "boostThreshold" INTEGER NOT NULL DEFAULT 16,
    "boostRate" INTEGER NOT NULL DEFAULT 1500,
    "individualBonus" INTEGER NOT NULL DEFAULT 5000,
    "fastBonus" INTEGER NOT NULL DEFAULT 250,
    "refBonus" INTEGER NOT NULL DEFAULT 100,
    "teamTarget" INTEGER NOT NULL DEFAULT 30,
    "teamPool" INTEGER NOT NULL DEFAULT 15000,
    "distMethod" TEXT NOT NULL DEFAULT 'equal',
    "requireMin" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncentivePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncentiveBde" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minimum" INTEGER NOT NULL DEFAULT 8,
    "target" INTEGER NOT NULL DEFAULT 14,
    "enrol" INTEGER NOT NULL DEFAULT 0,
    "fast48" INTEGER NOT NULL DEFAULT 0,
    "selfRef" INTEGER NOT NULL DEFAULT 0,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IncentiveBde_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncentivePlan_period_key" ON "IncentivePlan"("period");

-- CreateIndex
CREATE INDEX "IncentiveBde_planId_idx" ON "IncentiveBde"("planId");

-- AddForeignKey
ALTER TABLE "IncentiveBde" ADD CONSTRAINT "IncentiveBde_planId_fkey" FOREIGN KEY ("planId") REFERENCES "IncentivePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
