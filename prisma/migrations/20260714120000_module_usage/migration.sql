-- Active-engagement time per (user, module, page, IST day). Written by the
-- client heartbeat via POST /api/telemetry/activity, which only credits seconds
-- while the tab was visible AND the user interacted within the idle window, so a
-- merely-open tab is never counted. Aggregated at day grain so the table stays
-- small and the usage dashboards query cheaply.

-- CreateTable
CREATE TABLE "ModuleUsageDaily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleUsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModuleUsageDaily_userId_moduleId_page_day_key" ON "ModuleUsageDaily"("userId", "moduleId", "page", "day");

-- CreateIndex
CREATE INDEX "ModuleUsageDaily_day_moduleId_idx" ON "ModuleUsageDaily"("day", "moduleId");

-- CreateIndex
CREATE INDEX "ModuleUsageDaily_userId_day_idx" ON "ModuleUsageDaily"("userId", "day");

-- CreateIndex
CREATE INDEX "ModuleUsageDaily_moduleId_day_idx" ON "ModuleUsageDaily"("moduleId", "day");

-- AddForeignKey
ALTER TABLE "ModuleUsageDaily" ADD CONSTRAINT "ModuleUsageDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
