-- CreateTable
CREATE TABLE "HiringMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "baseRole" TEXT NOT NULL DEFAULT 'employee',
    "customRoleName" TEXT,
    "extraPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deniedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "invitedById" TEXT,
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringJobRole" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "defaultSeniority" TEXT NOT NULL DEFAULT 'mid',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringJobRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringJob" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "jobRoleId" TEXT,
    "department" TEXT NOT NULL,
    "locationId" TEXT,
    "workType" TEXT NOT NULL DEFAULT 'onsite',
    "employmentType" TEXT NOT NULL DEFAULT 'full_time',
    "seniority" TEXT NOT NULL DEFAULT 'mid',
    "compMinLakh" DECIMAL(6,2),
    "compMaxLakh" DECIMAL(6,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "compVisible" BOOLEAN NOT NULL DEFAULT false,
    "descriptionMd" TEXT,
    "mustHaves" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "niceToHaves" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "openings" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "ownerId" TEXT,
    "hiringManagerId" TEXT,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "resumeMode" TEXT NOT NULL DEFAULT 'required',
    "askScreeningQs" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringJobStage" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'open',
    "slaDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringJobStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringScreeningQuestion" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "helperText" TEXT,
    "answerType" TEXT NOT NULL DEFAULT 'short_text',
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringScreeningQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringJobRubric" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "criterion" TEXT NOT NULL,
    "description" TEXT,
    "weight" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringJobRubric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringCandidate" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "whatsappOptIn" BOOLEAN NOT NULL DEFAULT true,
    "currentTitle" TEXT,
    "currentEmployer" TEXT,
    "locationText" TEXT,
    "totalExperienceYears" DECIMAL(4,1),
    "noticePeriodDays" INTEGER,
    "currentCtcLakh" DECIMAL(6,2),
    "expectedCtcLakh" DECIMAL(6,2),
    "resumeUrl" TEXT,
    "portfolioUrl" TEXT,
    "linkedinUrl" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceDetail" TEXT,
    "sourceAttributionId" TEXT,
    "ownerId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "humanEditedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consentAt" TIMESTAMP(3),
    "dataRetentionUntil" TIMESTAMP(3),
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringApplication" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "aiScore" INTEGER,
    "aiScoreBreakdown" JSONB,
    "aiScoredAt" TIMESTAMP(3),
    "aiModel" TEXT,
    "aiPromptVersion" TEXT,
    "answers" JSONB,
    "screenedOutReason" TEXT,
    "rejectionReason" TEXT,
    "needsAttention" BOOLEAN NOT NULL DEFAULT false,
    "lastContactedAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hiredAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringApplicationEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT,
    "actorId" TEXT,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringNote" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "candidateId" TEXT,
    "bodyMd" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'team',
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringInterviewTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'phone_screen',
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "questionSet" JSONB,
    "rubric" JSONB,
    "isDefaultForStage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringInterviewTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringInterview" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "templateId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'phone_screen',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "mode" TEXT NOT NULL DEFAULT 'video',
    "locationOrLink" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "panel" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prepPacketMd" TEXT,
    "recordingUrl" TEXT,
    "transcriptText" TEXT,
    "transcriptSource" TEXT,
    "nudged2hAt" TIMESTAMP(3),
    "nudged24hAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringScorecard" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "ratings" JSONB,
    "overall" TEXT NOT NULL,
    "notesMd" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringScorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringOffer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "department" TEXT,
    "locationId" TEXT,
    "startDate" TIMESTAMP(3),
    "baseLakh" DECIMAL(6,2) NOT NULL,
    "variableLakh" DECIMAL(6,2),
    "joiningBonusLakh" DECIMAL(6,2),
    "otherTermsMd" TEXT,
    "probationMonths" INTEGER,
    "noticePeriodDays" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "expiryNudgedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringOfferEnvelope" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "documentHtml" TEXT NOT NULL,
    "pdfUrl" TEXT,
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "signatureImageUrl" TEXT,
    "signerTypedName" TEXT,
    "signerIp" TEXT,
    "signerUserAgent" TEXT,
    "auditTrail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringOfferEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringReferral" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "relationship" TEXT,
    "pitchMd" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "bonusAmount" DECIMAL(10,2),
    "bonusStatus" TEXT NOT NULL DEFAULT 'pending',
    "bonusPaidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringTalentPool" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'new',
    "interestAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastTouchAt" TIMESTAMP(3),
    "nextTouchAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "notesMd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringTalentPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringPartner" (
    "id" TEXT NOT NULL,
    "agencyName" TEXT NOT NULL,
    "primaryContactName" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "focusAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "feePercent" DECIMAL(5,2),
    "status" TEXT NOT NULL DEFAULT 'invited',
    "invitedById" TEXT,
    "invitedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringPartnerJobAccess" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "grantedById" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringPartnerJobAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringPartnerSession" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "sessionExpiresAt" TIMESTAMP(3),
    "createdIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringPartnerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringPartnerSubmission" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "applicationId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feePercentAtSubmission" DECIMAL(5,2),
    "placementStatus" TEXT NOT NULL DEFAULT 'submitted',
    "invoiceStatus" TEXT NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringPartnerSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringAutomation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "trigger" JSONB NOT NULL,
    "conditions" JSONB,
    "actions" JSONB NOT NULL,
    "lastFiredAt" TIMESTAMP(3),
    "fireCount" INTEGER NOT NULL DEFAULT 0,
    "errorStreak" INTEGER NOT NULL DEFAULT 0,
    "pausedAt" TIMESTAMP(3),
    "pauseReason" TEXT,
    "ownerId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringAutomationRun" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "applicationId" TEXT,
    "status" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "durationMs" INTEGER,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringAutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringSavedView" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "rail" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "sort" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringSavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringCompanyProfile" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "summaryMd" TEXT NOT NULL,
    "tone" TEXT,
    "values" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringCompanyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringAiCall" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "model" TEXT,
    "promptVersion" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "userId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringAiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HiringMember_userId_key" ON "HiringMember"("userId");

-- CreateIndex
CREATE INDEX "HiringMember_baseRole_isActive_idx" ON "HiringMember"("baseRole", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "HiringLocation_name_key" ON "HiringLocation"("name");

-- CreateIndex
CREATE INDEX "HiringLocation_isActive_idx" ON "HiringLocation"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "HiringJobRole_title_key" ON "HiringJobRole"("title");

-- CreateIndex
CREATE INDEX "HiringJobRole_department_isActive_idx" ON "HiringJobRole"("department", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "HiringJob_slug_key" ON "HiringJob"("slug");

-- CreateIndex
CREATE INDEX "HiringJob_status_publishedAt_idx" ON "HiringJob"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "HiringJob_department_idx" ON "HiringJob"("department");

-- CreateIndex
CREATE INDEX "HiringJob_ownerId_idx" ON "HiringJob"("ownerId");

-- CreateIndex
CREATE INDEX "HiringJob_hiringManagerId_idx" ON "HiringJob"("hiringManagerId");

-- CreateIndex
CREATE INDEX "HiringJob_deletedAt_idx" ON "HiringJob"("deletedAt");

-- CreateIndex
CREATE INDEX "HiringJobStage_jobId_kind_idx" ON "HiringJobStage"("jobId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "HiringJobStage_jobId_position_key" ON "HiringJobStage"("jobId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "HiringScreeningQuestion_jobId_position_key" ON "HiringScreeningQuestion"("jobId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "HiringJobRubric_jobId_position_key" ON "HiringJobRubric"("jobId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "HiringCandidate_email_key" ON "HiringCandidate"("email");

-- CreateIndex
CREATE UNIQUE INDEX "HiringCandidate_phone_key" ON "HiringCandidate"("phone");

-- CreateIndex
CREATE INDEX "HiringCandidate_source_idx" ON "HiringCandidate"("source");

-- CreateIndex
CREATE INDEX "HiringCandidate_ownerId_idx" ON "HiringCandidate"("ownerId");

-- CreateIndex
CREATE INDEX "HiringCandidate_deletedAt_idx" ON "HiringCandidate"("deletedAt");

-- CreateIndex
CREATE INDEX "HiringCandidate_fullName_idx" ON "HiringCandidate"("fullName");

-- CreateIndex
CREATE INDEX "HiringApplication_jobId_status_idx" ON "HiringApplication"("jobId", "status");

-- CreateIndex
CREATE INDEX "HiringApplication_stageId_idx" ON "HiringApplication"("stageId");

-- CreateIndex
CREATE INDEX "HiringApplication_status_nextFollowUpAt_idx" ON "HiringApplication"("status", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "HiringApplication_needsAttention_idx" ON "HiringApplication"("needsAttention");

-- CreateIndex
CREATE INDEX "HiringApplication_deletedAt_idx" ON "HiringApplication"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HiringApplication_candidateId_jobId_key" ON "HiringApplication"("candidateId", "jobId");

-- CreateIndex
CREATE INDEX "HiringApplicationEvent_applicationId_occurredAt_idx" ON "HiringApplicationEvent"("applicationId", "occurredAt");

-- CreateIndex
CREATE INDEX "HiringApplicationEvent_type_occurredAt_idx" ON "HiringApplicationEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "HiringApplicationEvent_occurredAt_idx" ON "HiringApplicationEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "HiringNote_applicationId_createdAt_idx" ON "HiringNote"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "HiringNote_candidateId_createdAt_idx" ON "HiringNote"("candidateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HiringInterviewTemplate_name_key" ON "HiringInterviewTemplate"("name");

-- CreateIndex
CREATE INDEX "HiringInterview_applicationId_scheduledAt_idx" ON "HiringInterview"("applicationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "HiringInterview_status_scheduledAt_idx" ON "HiringInterview"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "HiringInterview_scheduledAt_idx" ON "HiringInterview"("scheduledAt");

-- CreateIndex
CREATE INDEX "HiringScorecard_reviewerId_idx" ON "HiringScorecard"("reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "HiringScorecard_interviewId_reviewerId_key" ON "HiringScorecard"("interviewId", "reviewerId");

-- CreateIndex
CREATE INDEX "HiringOffer_applicationId_status_idx" ON "HiringOffer"("applicationId", "status");

-- CreateIndex
CREATE INDEX "HiringOffer_status_expiresAt_idx" ON "HiringOffer"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "HiringOfferEnvelope_accessTokenHash_key" ON "HiringOfferEnvelope"("accessTokenHash");

-- CreateIndex
CREATE INDEX "HiringOfferEnvelope_offerId_idx" ON "HiringOfferEnvelope"("offerId");

-- CreateIndex
CREATE INDEX "HiringReferral_referrerId_status_idx" ON "HiringReferral"("referrerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HiringReferral_jobId_candidateId_key" ON "HiringReferral"("jobId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "HiringTalentPool_candidateId_key" ON "HiringTalentPool"("candidateId");

-- CreateIndex
CREATE INDEX "HiringTalentPool_state_nextTouchAt_idx" ON "HiringTalentPool"("state", "nextTouchAt");

-- CreateIndex
CREATE UNIQUE INDEX "HiringPartner_contactEmail_key" ON "HiringPartner"("contactEmail");

-- CreateIndex
CREATE INDEX "HiringPartner_status_idx" ON "HiringPartner"("status");

-- CreateIndex
CREATE INDEX "HiringPartnerJobAccess_jobId_idx" ON "HiringPartnerJobAccess"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "HiringPartnerJobAccess_partnerId_jobId_key" ON "HiringPartnerJobAccess"("partnerId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "HiringPartnerSession_tokenHash_key" ON "HiringPartnerSession"("tokenHash");

-- CreateIndex
CREATE INDEX "HiringPartnerSession_partnerId_expiresAt_idx" ON "HiringPartnerSession"("partnerId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "HiringPartnerSubmission_applicationId_key" ON "HiringPartnerSubmission"("applicationId");

-- CreateIndex
CREATE INDEX "HiringPartnerSubmission_partnerId_placementStatus_idx" ON "HiringPartnerSubmission"("partnerId", "placementStatus");

-- CreateIndex
CREATE UNIQUE INDEX "HiringPartnerSubmission_partnerId_jobId_candidateId_key" ON "HiringPartnerSubmission"("partnerId", "jobId", "candidateId");

-- CreateIndex
CREATE INDEX "HiringAutomation_isActive_idx" ON "HiringAutomation"("isActive");

-- CreateIndex
CREATE INDEX "HiringAutomationRun_automationId_ranAt_idx" ON "HiringAutomationRun"("automationId", "ranAt");

-- CreateIndex
CREATE INDEX "HiringAutomationRun_status_ranAt_idx" ON "HiringAutomationRun"("status", "ranAt");

-- CreateIndex
CREATE INDEX "HiringSavedView_rail_userId_idx" ON "HiringSavedView"("rail", "userId");

-- CreateIndex
CREATE INDEX "HiringSavedView_rail_isShared_idx" ON "HiringSavedView"("rail", "isShared");

-- CreateIndex
CREATE INDEX "HiringAuditLog_entityType_entityId_createdAt_idx" ON "HiringAuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "HiringAuditLog_createdAt_idx" ON "HiringAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "HiringCompanyProfile_isActive_idx" ON "HiringCompanyProfile"("isActive");

-- CreateIndex
CREATE INDEX "HiringAiCall_feature_createdAt_idx" ON "HiringAiCall"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "HiringAiCall_createdAt_idx" ON "HiringAiCall"("createdAt");

-- AddForeignKey
ALTER TABLE "HiringMember" ADD CONSTRAINT "HiringMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringMember" ADD CONSTRAINT "HiringMember_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringJob" ADD CONSTRAINT "HiringJob_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "HiringJobRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringJob" ADD CONSTRAINT "HiringJob_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "HiringLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringJob" ADD CONSTRAINT "HiringJob_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringJob" ADD CONSTRAINT "HiringJob_hiringManagerId_fkey" FOREIGN KEY ("hiringManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringJob" ADD CONSTRAINT "HiringJob_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringJob" ADD CONSTRAINT "HiringJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringJobStage" ADD CONSTRAINT "HiringJobStage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "HiringJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringScreeningQuestion" ADD CONSTRAINT "HiringScreeningQuestion_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "HiringJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringJobRubric" ADD CONSTRAINT "HiringJobRubric_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "HiringJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringCandidate" ADD CONSTRAINT "HiringCandidate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringCandidate" ADD CONSTRAINT "HiringCandidate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringApplication" ADD CONSTRAINT "HiringApplication_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "HiringCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringApplication" ADD CONSTRAINT "HiringApplication_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "HiringJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringApplication" ADD CONSTRAINT "HiringApplication_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "HiringJobStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringApplicationEvent" ADD CONSTRAINT "HiringApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "HiringApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringApplicationEvent" ADD CONSTRAINT "HiringApplicationEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringNote" ADD CONSTRAINT "HiringNote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "HiringApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringNote" ADD CONSTRAINT "HiringNote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "HiringCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringNote" ADD CONSTRAINT "HiringNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringInterviewTemplate" ADD CONSTRAINT "HiringInterviewTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringInterview" ADD CONSTRAINT "HiringInterview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "HiringApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringInterview" ADD CONSTRAINT "HiringInterview_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "HiringInterviewTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringInterview" ADD CONSTRAINT "HiringInterview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringScorecard" ADD CONSTRAINT "HiringScorecard_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "HiringInterview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringScorecard" ADD CONSTRAINT "HiringScorecard_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringOffer" ADD CONSTRAINT "HiringOffer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "HiringApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringOffer" ADD CONSTRAINT "HiringOffer_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "HiringLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringOffer" ADD CONSTRAINT "HiringOffer_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringOffer" ADD CONSTRAINT "HiringOffer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringOfferEnvelope" ADD CONSTRAINT "HiringOfferEnvelope_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "HiringOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringReferral" ADD CONSTRAINT "HiringReferral_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "HiringJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringReferral" ADD CONSTRAINT "HiringReferral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringReferral" ADD CONSTRAINT "HiringReferral_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "HiringCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringTalentPool" ADD CONSTRAINT "HiringTalentPool_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "HiringCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringTalentPool" ADD CONSTRAINT "HiringTalentPool_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPartner" ADD CONSTRAINT "HiringPartner_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPartnerJobAccess" ADD CONSTRAINT "HiringPartnerJobAccess_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "HiringPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPartnerJobAccess" ADD CONSTRAINT "HiringPartnerJobAccess_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "HiringJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPartnerJobAccess" ADD CONSTRAINT "HiringPartnerJobAccess_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPartnerSession" ADD CONSTRAINT "HiringPartnerSession_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "HiringPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPartnerSubmission" ADD CONSTRAINT "HiringPartnerSubmission_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "HiringPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPartnerSubmission" ADD CONSTRAINT "HiringPartnerSubmission_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "HiringJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPartnerSubmission" ADD CONSTRAINT "HiringPartnerSubmission_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "HiringCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPartnerSubmission" ADD CONSTRAINT "HiringPartnerSubmission_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "HiringApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringAutomation" ADD CONSTRAINT "HiringAutomation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringAutomation" ADD CONSTRAINT "HiringAutomation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringAutomationRun" ADD CONSTRAINT "HiringAutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "HiringAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringSavedView" ADD CONSTRAINT "HiringSavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringAuditLog" ADD CONSTRAINT "HiringAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringCompanyProfile" ADD CONSTRAINT "HiringCompanyProfile_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringAiCall" ADD CONSTRAINT "HiringAiCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

