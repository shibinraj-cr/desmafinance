-- CreateTable
CREATE TABLE "ProcessTemplate" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessTemplateStep" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "phase" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "slaDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessTemplateStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsProject" (
    "id" TEXT NOT NULL,
    "partyServiceId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "templateId" TEXT,
    "leadId" TEXT,
    "assignedToId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "externalSource" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "templateStepId" TEXT,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "phase" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "slaDays" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assignedToId" TEXT,
    "dueAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "blockedReason" TEXT,
    "notes" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsDocument" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsTaskActivity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "summary" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsTaskActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessTemplate_serviceId_isActive_idx" ON "ProcessTemplate"("serviceId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessTemplate_serviceId_version_key" ON "ProcessTemplate"("serviceId", "version");

-- CreateIndex
CREATE INDEX "ProcessTemplateStep_templateId_idx" ON "ProcessTemplateStep"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessTemplateStep_templateId_seq_key" ON "ProcessTemplateStep"("templateId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "OpsProject_partyServiceId_key" ON "OpsProject"("partyServiceId");

-- CreateIndex
CREATE INDEX "OpsProject_assignedToId_status_idx" ON "OpsProject"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "OpsProject_status_dueAt_idx" ON "OpsProject"("status", "dueAt");

-- CreateIndex
CREATE INDEX "OpsProject_partyId_idx" ON "OpsProject"("partyId");

-- CreateIndex
CREATE INDEX "OpsProject_serviceId_idx" ON "OpsProject"("serviceId");

-- CreateIndex
CREATE INDEX "OpsProject_templateId_idx" ON "OpsProject"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "OpsProject_externalSource_externalId_key" ON "OpsProject"("externalSource", "externalId");

-- CreateIndex
CREATE INDEX "OpsTask_assignedToId_status_dueAt_idx" ON "OpsTask"("assignedToId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "OpsTask_status_completedAt_idx" ON "OpsTask"("status", "completedAt");

-- CreateIndex
CREATE INDEX "OpsTask_projectId_idx" ON "OpsTask"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "OpsTask_projectId_seq_key" ON "OpsTask"("projectId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "OpsTask_externalId_key" ON "OpsTask"("externalId");

-- CreateIndex
CREATE INDEX "OpsDocument_taskId_idx" ON "OpsDocument"("taskId");

-- CreateIndex
CREATE INDEX "OpsTaskActivity_projectId_occurredAt_idx" ON "OpsTaskActivity"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "OpsTaskActivity_actorId_type_occurredAt_idx" ON "OpsTaskActivity"("actorId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "OpsTaskActivity_type_idx" ON "OpsTaskActivity"("type");

-- AddForeignKey
ALTER TABLE "ProcessTemplate" ADD CONSTRAINT "ProcessTemplate_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessTemplate" ADD CONSTRAINT "ProcessTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessTemplateStep" ADD CONSTRAINT "ProcessTemplateStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProcessTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsProject" ADD CONSTRAINT "OpsProject_partyServiceId_fkey" FOREIGN KEY ("partyServiceId") REFERENCES "PartyService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsProject" ADD CONSTRAINT "OpsProject_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsProject" ADD CONSTRAINT "OpsProject_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsProject" ADD CONSTRAINT "OpsProject_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProcessTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsProject" ADD CONSTRAINT "OpsProject_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsProject" ADD CONSTRAINT "OpsProject_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsProject" ADD CONSTRAINT "OpsProject_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsTask" ADD CONSTRAINT "OpsTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "OpsProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsTask" ADD CONSTRAINT "OpsTask_templateStepId_fkey" FOREIGN KEY ("templateStepId") REFERENCES "ProcessTemplateStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsTask" ADD CONSTRAINT "OpsTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsTask" ADD CONSTRAINT "OpsTask_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsDocument" ADD CONSTRAINT "OpsDocument_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OpsTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsDocument" ADD CONSTRAINT "OpsDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsTaskActivity" ADD CONSTRAINT "OpsTaskActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "OpsProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsTaskActivity" ADD CONSTRAINT "OpsTaskActivity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OpsTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsTaskActivity" ADD CONSTRAINT "OpsTaskActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

