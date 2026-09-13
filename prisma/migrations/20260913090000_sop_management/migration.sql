-- SOP Management module.
--
-- Two layers: `Sop` is the permanent identity (its OPS-SOP-001 number is minted
-- once and never reissued); `SopVersion` is one authored revision, carrying the
-- workflow status and every child record (steps, checklists, quality criteria,
-- exceptions, KPIs, attachments). A published version is frozen — `isLocked` —
-- and editing means creating the next version, so history is never overwritten.
--
-- Purely additive: no existing table is altered. The FKs point at the existing
-- User / Employee / HrDepartment / HrRole masters rather than duplicating them.

-- CreateTable
CREATE TABLE "SopCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sop" (
    "id" TEXT NOT NULL,
    "sopNumber" TEXT NOT NULL,
    "deptCode" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" TEXT,
    "categoryId" TEXT,
    "processFunction" TEXT,
    "ownerEmployeeId" TEXT NOT NULL,
    "confidentiality" TEXT NOT NULL DEFAULT 'general',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currentVersionId" TEXT,
    "draftVersionId" TEXT,
    "effectiveDate" DATE,
    "nextReviewDate" DATE,
    "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "archiveReason" TEXT,
    "replacementSopId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopVersion" (
    "id" TEXT NOT NULL,
    "sopId" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "major" INTEGER NOT NULL DEFAULT 1,
    "minor" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "departmentId" TEXT,
    "categoryId" TEXT,
    "processFunction" TEXT,
    "ownerEmployeeId" TEXT NOT NULL,
    "supportingRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidentiality" TEXT NOT NULL DEFAULT 'general',
    "reviewerId" TEXT,
    "approverId" TEXT,
    "purpose" TEXT,
    "triggerDescription" TEXT,
    "triggerType" TEXT,
    "triggerSource" TEXT,
    "triggerCondition" TEXT,
    "qualityStandard" TEXT,
    "reviewFrequency" TEXT,
    "reviewIntervalDays" INTEGER,
    "lastReviewDate" DATE,
    "nextReviewDate" DATE,
    "reviewOwnerEmployeeId" TEXT,
    "reviewReminderDays" INTEGER NOT NULL DEFAULT 15,
    "effectiveDate" DATE,
    "applicableDepartmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applicableRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applicableEmployeeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgementDeadline" DATE,
    "publishNotes" TEXT,
    "changeSummary" TEXT,
    "createdById" TEXT,
    "submittedForReviewAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "submittedForApprovalAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "previousVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopStep" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "instruction" TEXT,
    "responsibleRoleId" TEXT,
    "responsibleRoleName" TEXT,
    "responsibleDepartmentId" TEXT,
    "assignedEmployeeId" TEXT,
    "slaValue" INTEGER,
    "slaUnit" TEXT,
    "slaMinutes" INTEGER,
    "requiredInput" TEXT,
    "expectedOutput" TEXT,
    "evidence" TEXT,
    "supportingDocument" TEXT,
    "templateRef" TEXT,
    "linkUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopStepChecklist" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopStepChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopQualityCriterion" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "criterion" TEXT NOT NULL,
    "target" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopQualityCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopException" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "issue" TEXT NOT NULL,
    "condition" TEXT,
    "requiredAction" TEXT,
    "escalateToRoleId" TEXT,
    "escalateToRoleName" TEXT,
    "escalateToEmployeeId" TEXT,
    "escalationSla" INTEGER,
    "escalationUnit" TEXT,
    "escalationMinutes" INTEGER,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "notifyProcessOwner" BOOLEAN NOT NULL DEFAULT false,
    "notifyDepartmentHead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopKpi" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "target" TEXT,
    "unit" TEXT,
    "measurementMethod" TEXT,
    "dataSource" TEXT,
    "reviewFrequency" TEXT,
    "kpiOwnerEmployeeId" TEXT,
    "latestActual" TEXT,
    "latestStatus" TEXT,
    "latestReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopKpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopKpiReview" (
    "id" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "sopId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "actual" TEXT NOT NULL,
    "actualNumeric" DECIMAL(14,4),
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopKpiReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopReviewAction" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comments" TEXT,
    "actorId" TEXT,
    "actedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SopReviewAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopAcknowledgement" (
    "id" TEXT NOT NULL,
    "sopId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "userId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" DATE,
    "viewedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'not_viewed',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopAttachment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "docType" TEXT NOT NULL DEFAULT 'other',
    "fileUrl" TEXT,
    "linkUrl" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "docVersion" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopAuditLog" (
    "id" TEXT NOT NULL,
    "sopId" TEXT NOT NULL,
    "versionId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "versionLabel" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SopAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkUrl" TEXT,
    "sopId" TEXT,
    "versionId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SopNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SopCategory_name_key" ON "SopCategory"("name");

-- CreateIndex
CREATE INDEX "SopCategory_isActive_sortOrder_idx" ON "SopCategory"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Sop_sopNumber_key" ON "Sop"("sopNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Sop_currentVersionId_key" ON "Sop"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Sop_draftVersionId_key" ON "Sop"("draftVersionId");

-- CreateIndex
CREATE INDEX "Sop_isArchived_deletedAt_status_idx" ON "Sop"("isArchived", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "Sop_departmentId_idx" ON "Sop"("departmentId");

-- CreateIndex
CREATE INDEX "Sop_ownerEmployeeId_idx" ON "Sop"("ownerEmployeeId");

-- CreateIndex
CREATE INDEX "Sop_categoryId_idx" ON "Sop"("categoryId");

-- CreateIndex
CREATE INDEX "Sop_nextReviewDate_idx" ON "Sop"("nextReviewDate");

-- CreateIndex
CREATE INDEX "Sop_status_idx" ON "Sop"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Sop_deptCode_seq_key" ON "Sop"("deptCode", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "SopVersion_previousVersionId_key" ON "SopVersion"("previousVersionId");

-- CreateIndex
CREATE INDEX "SopVersion_sopId_status_idx" ON "SopVersion"("sopId", "status");

-- CreateIndex
CREATE INDEX "SopVersion_status_idx" ON "SopVersion"("status");

-- CreateIndex
CREATE INDEX "SopVersion_reviewerId_status_idx" ON "SopVersion"("reviewerId", "status");

-- CreateIndex
CREATE INDEX "SopVersion_approverId_status_idx" ON "SopVersion"("approverId", "status");

-- CreateIndex
CREATE INDEX "SopVersion_nextReviewDate_idx" ON "SopVersion"("nextReviewDate");

-- CreateIndex
CREATE UNIQUE INDEX "SopVersion_sopId_versionLabel_key" ON "SopVersion"("sopId", "versionLabel");

-- CreateIndex
CREATE INDEX "SopStep_versionId_idx" ON "SopStep"("versionId");

-- CreateIndex
CREATE INDEX "SopStep_responsibleRoleId_idx" ON "SopStep"("responsibleRoleId");

-- CreateIndex
CREATE INDEX "SopStep_assignedEmployeeId_idx" ON "SopStep"("assignedEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "SopStep_versionId_seq_key" ON "SopStep"("versionId", "seq");

-- CreateIndex
CREATE INDEX "SopStepChecklist_stepId_idx" ON "SopStepChecklist"("stepId");

-- CreateIndex
CREATE UNIQUE INDEX "SopStepChecklist_stepId_seq_key" ON "SopStepChecklist"("stepId", "seq");

-- CreateIndex
CREATE INDEX "SopQualityCriterion_versionId_idx" ON "SopQualityCriterion"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "SopQualityCriterion_versionId_seq_key" ON "SopQualityCriterion"("versionId", "seq");

-- CreateIndex
CREATE INDEX "SopException_versionId_idx" ON "SopException"("versionId");

-- CreateIndex
CREATE INDEX "SopException_priority_idx" ON "SopException"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "SopException_versionId_seq_key" ON "SopException"("versionId", "seq");

-- CreateIndex
CREATE INDEX "SopKpi_versionId_idx" ON "SopKpi"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "SopKpi_versionId_seq_key" ON "SopKpi"("versionId", "seq");

-- CreateIndex
CREATE INDEX "SopKpiReview_sopId_reviewedAt_idx" ON "SopKpiReview"("sopId", "reviewedAt");

-- CreateIndex
CREATE INDEX "SopKpiReview_versionId_idx" ON "SopKpiReview"("versionId");

-- CreateIndex
CREATE INDEX "SopKpiReview_status_idx" ON "SopKpiReview"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SopKpiReview_kpiId_periodStart_periodEnd_key" ON "SopKpiReview"("kpiId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "SopReviewAction_versionId_actedAt_idx" ON "SopReviewAction"("versionId", "actedAt");

-- CreateIndex
CREATE INDEX "SopReviewAction_actorId_idx" ON "SopReviewAction"("actorId");

-- CreateIndex
CREATE INDEX "SopAcknowledgement_employeeId_status_idx" ON "SopAcknowledgement"("employeeId", "status");

-- CreateIndex
CREATE INDEX "SopAcknowledgement_sopId_idx" ON "SopAcknowledgement"("sopId");

-- CreateIndex
CREATE INDEX "SopAcknowledgement_versionId_status_idx" ON "SopAcknowledgement"("versionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SopAcknowledgement_versionId_employeeId_key" ON "SopAcknowledgement"("versionId", "employeeId");

-- CreateIndex
CREATE INDEX "SopAttachment_versionId_idx" ON "SopAttachment"("versionId");

-- CreateIndex
CREATE INDEX "SopAuditLog_sopId_occurredAt_idx" ON "SopAuditLog"("sopId", "occurredAt");

-- CreateIndex
CREATE INDEX "SopAuditLog_userId_occurredAt_idx" ON "SopAuditLog"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "SopAuditLog_action_idx" ON "SopAuditLog"("action");

-- CreateIndex
CREATE INDEX "SopNotification_userId_readAt_idx" ON "SopNotification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "SopNotification_userId_createdAt_idx" ON "SopNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SopNotification_sopId_idx" ON "SopNotification"("sopId");

-- AddForeignKey
ALTER TABLE "Sop" ADD CONSTRAINT "Sop_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "HrDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sop" ADD CONSTRAINT "Sop_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SopCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sop" ADD CONSTRAINT "Sop_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sop" ADD CONSTRAINT "Sop_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "SopVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sop" ADD CONSTRAINT "Sop_draftVersionId_fkey" FOREIGN KEY ("draftVersionId") REFERENCES "SopVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sop" ADD CONSTRAINT "Sop_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sop" ADD CONSTRAINT "Sop_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sop" ADD CONSTRAINT "Sop_replacementSopId_fkey" FOREIGN KEY ("replacementSopId") REFERENCES "Sop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "Sop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "HrDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SopCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_reviewOwnerEmployeeId_fkey" FOREIGN KEY ("reviewOwnerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "SopVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopStep" ADD CONSTRAINT "SopStep_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SopVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopStep" ADD CONSTRAINT "SopStep_responsibleRoleId_fkey" FOREIGN KEY ("responsibleRoleId") REFERENCES "HrRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopStep" ADD CONSTRAINT "SopStep_responsibleDepartmentId_fkey" FOREIGN KEY ("responsibleDepartmentId") REFERENCES "HrDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopStep" ADD CONSTRAINT "SopStep_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopStepChecklist" ADD CONSTRAINT "SopStepChecklist_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SopStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopQualityCriterion" ADD CONSTRAINT "SopQualityCriterion_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SopVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopException" ADD CONSTRAINT "SopException_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SopVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopException" ADD CONSTRAINT "SopException_escalateToRoleId_fkey" FOREIGN KEY ("escalateToRoleId") REFERENCES "HrRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopException" ADD CONSTRAINT "SopException_escalateToEmployeeId_fkey" FOREIGN KEY ("escalateToEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopKpi" ADD CONSTRAINT "SopKpi_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SopVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopKpi" ADD CONSTRAINT "SopKpi_kpiOwnerEmployeeId_fkey" FOREIGN KEY ("kpiOwnerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopKpiReview" ADD CONSTRAINT "SopKpiReview_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "SopKpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopKpiReview" ADD CONSTRAINT "SopKpiReview_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SopVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopKpiReview" ADD CONSTRAINT "SopKpiReview_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "Sop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopKpiReview" ADD CONSTRAINT "SopKpiReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopReviewAction" ADD CONSTRAINT "SopReviewAction_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SopVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopReviewAction" ADD CONSTRAINT "SopReviewAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopAcknowledgement" ADD CONSTRAINT "SopAcknowledgement_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "Sop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopAcknowledgement" ADD CONSTRAINT "SopAcknowledgement_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SopVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopAcknowledgement" ADD CONSTRAINT "SopAcknowledgement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopAcknowledgement" ADD CONSTRAINT "SopAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopAttachment" ADD CONSTRAINT "SopAttachment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SopVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopAttachment" ADD CONSTRAINT "SopAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopAuditLog" ADD CONSTRAINT "SopAuditLog_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "Sop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopAuditLog" ADD CONSTRAINT "SopAuditLog_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SopVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopAuditLog" ADD CONSTRAINT "SopAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopNotification" ADD CONSTRAINT "SopNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopNotification" ADD CONSTRAINT "SopNotification_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "Sop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopNotification" ADD CONSTRAINT "SopNotification_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SopVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

