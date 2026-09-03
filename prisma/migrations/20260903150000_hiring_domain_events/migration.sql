-- CreateTable
CREATE TABLE "HiringDomainEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "consumedAt" TIMESTAMP(3),
    "consumedBy" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringDomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HiringDomainEvent_type_consumedAt_idx" ON "HiringDomainEvent"("type", "consumedAt");

-- CreateIndex
CREATE INDEX "HiringDomainEvent_occurredAt_idx" ON "HiringDomainEvent"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "HiringDomainEvent_type_subjectType_subjectId_key" ON "HiringDomainEvent"("type", "subjectType", "subjectId");

