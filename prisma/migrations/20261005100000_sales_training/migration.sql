-- CreateTable
CREATE TABLE "SalesTrainingModule" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "videos" JSONB NOT NULL DEFAULT '[]',
    "passMark" INTEGER NOT NULL DEFAULT 70,
    "maxAttempts" INTEGER,
    "requireWatch" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTrainingModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTrainingQuestion" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'single',
    "prompt" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct" JSONB NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,
    "explanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTrainingQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTrainingLearner" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "dueDate" TIMESTAMP(3),
    "enrolledById" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTrainingLearner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTrainingAttempt" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "graded" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "maxScore" INTEGER NOT NULL,
    "percent" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,

    CONSTRAINT "SalesTrainingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTrainingWatch" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "ranges" JSONB NOT NULL DEFAULT '[]',
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "watchedPct" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTrainingWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesTrainingModule_status_sortOrder_idx" ON "SalesTrainingModule"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "SalesTrainingQuestion_moduleId_sortOrder_idx" ON "SalesTrainingQuestion"("moduleId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SalesTrainingLearner_employeeId_key" ON "SalesTrainingLearner"("employeeId");

-- CreateIndex
CREATE INDEX "SalesTrainingLearner_active_idx" ON "SalesTrainingLearner"("active");

-- CreateIndex
CREATE INDEX "SalesTrainingAttempt_moduleId_employeeId_idx" ON "SalesTrainingAttempt"("moduleId", "employeeId");

-- CreateIndex
CREATE INDEX "SalesTrainingAttempt_employeeId_idx" ON "SalesTrainingAttempt"("employeeId");

-- CreateIndex
CREATE INDEX "SalesTrainingWatch_employeeId_idx" ON "SalesTrainingWatch"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesTrainingWatch_moduleId_employeeId_videoId_key" ON "SalesTrainingWatch"("moduleId", "employeeId", "videoId");

-- AddForeignKey
ALTER TABLE "SalesTrainingQuestion" ADD CONSTRAINT "SalesTrainingQuestion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "SalesTrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTrainingLearner" ADD CONSTRAINT "SalesTrainingLearner_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTrainingAttempt" ADD CONSTRAINT "SalesTrainingAttempt_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "SalesTrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTrainingAttempt" ADD CONSTRAINT "SalesTrainingAttempt_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTrainingWatch" ADD CONSTRAINT "SalesTrainingWatch_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "SalesTrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTrainingWatch" ADD CONSTRAINT "SalesTrainingWatch_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

