-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PsychDimension" AS ENUM ('O', 'C', 'E', 'A', 'N', 'VALIDITY');

-- CreateEnum
CREATE TYPE "PsychStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'INVALIDATED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'executive',
    "roleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "draftFirst" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "canApprove" BOOLEAN NOT NULL DEFAULT false,
    "needsApproval" BOOLEAN NOT NULL DEFAULT true,
    "pages" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "month" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subItem" TEXT NOT NULL,
    "description" TEXT,
    "paymentMode" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "flow" TEXT NOT NULL,
    "expDom" TEXT,
    "partyId" TEXT,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubCategory" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "serviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "showInL2Targets" BOOLEAN NOT NULL DEFAULT true,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "groupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyService" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulseRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "regionFocus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "displayName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadPulseRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulseSource" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadPulseSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulseRegion" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadPulseRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulseDailyEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "sourceId" TEXT NOT NULL,
    "roleAtEntry" TEXT NOT NULL,
    "leadsReceived" INTEGER,
    "connectedCalls" INTEGER,
    "disqualified" INTEGER,
    "transferredToL2" INTEGER,
    "receivedFromL1" INTEGER,
    "directLeads" INTEGER,
    "connected" INTEGER,
    "quoteSent" INTEGER,
    "closedWon" INTEGER,
    "closedLost" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMP(3),
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadPulseDailyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulseDailyClose" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadPulseDailyClose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulsePipeline" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "candidateName" TEXT NOT NULL,
    "candidatePhone" TEXT,
    "partyId" TEXT,
    "serviceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "expectedCloseDate" DATE NOT NULL,
    "expectedFirstInstallment" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "closedDate" DATE,
    "dailyCloseId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadPulsePipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulseDailyMeta" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "totalFollowups" INTEGER,
    "referredToDoc" INTEGER,
    "referredToAbroad" INTEGER,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMP(3),
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadPulseDailyMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulseUnlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlockedById" TEXT,

    CONSTRAINT "LeadPulseUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulseAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadPulseAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulseMonthlySnapshot" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "userId" TEXT,
    "role" TEXT NOT NULL,
    "sourceId" TEXT,
    "totalLeads" INTEGER NOT NULL DEFAULT 0,
    "totalWon" INTEGER NOT NULL DEFAULT 0,
    "conversionPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadPulseMonthlySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulseTarget" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceId" TEXT,
    "groupId" TEXT,
    "target" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadPulseTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "notes" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "txTypes" TEXT NOT NULL DEFAULT 'Both',
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceId" TEXT,
    "assignedL2BdeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingApproval" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "targetTxId" TEXT,
    "proposed" JSONB,
    "submittedById" TEXT,
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "collectionInstallmentId" TEXT,

    CONSTRAINT "PendingApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionDraft" (
    "id" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "month" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subItem" TEXT NOT NULL,
    "description" TEXT,
    "paymentMode" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "flow" TEXT NOT NULL,
    "partyId" TEXT,
    "expDom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoxbayUpload" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT,
    "filename" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoxbayUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoxbayCall" (
    "id" TEXT NOT NULL,
    "signature" TEXT,
    "slNo" INTEGER,
    "contactName" TEXT,
    "sourceNumber" TEXT,
    "didNumber" TEXT,
    "cost" DOUBLE PRECISION,
    "dtmfSeq" TEXT,
    "callStartTime" TIMESTAMP(3),
    "callConnectedTime" TIMESTAMP(3),
    "callStatus" TEXT,
    "userStatus" TEXT,
    "stickyStatus" TEXT,
    "holdTime" TEXT,
    "callRecordFile" TEXT,
    "application" TEXT,
    "extNumber" TEXT,
    "appName" TEXT,
    "agentName" TEXT,
    "lastTriedName" TEXT,
    "firstTriedName" TEXT,
    "totalDurationSec" INTEGER NOT NULL DEFAULT 0,
    "totalDurationDisplay" TEXT,
    "answeredDurationSec" INTEGER NOT NULL DEFAULT 0,
    "answeredDurationDisplay" TEXT,
    "deptName" TEXT,
    "disposition" TEXT,
    "latestComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoxbayCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPulseBdeInsight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "analysis" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "answers" JSONB,
    "feedback" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadPulseBdeInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionPlan" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "serviceId" TEXT,
    "label" TEXT NOT NULL,
    "category" TEXT,
    "subItem" TEXT,
    "paymentMode" TEXT,
    "expDom" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionPlanInstallment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "expectedDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "category" TEXT,
    "subItem" TEXT,
    "paymentMode" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "pendingApprovalId" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionPlanInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrShift" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 0,
    "halfDayCutoffTime" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "empCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dob" DATE,
    "photoUrl" TEXT,
    "designation" TEXT,
    "department" TEXT,
    "designationId" TEXT,
    "email" TEXT,
    "officialEmail" TEXT,
    "phone" TEXT,
    "emergencyContact" TEXT,
    "officeNumber" TEXT,
    "address" TEXT,
    "highestEducation" TEXT,
    "maritalStatus" TEXT,
    "experienceNotes" TEXT,
    "yearsOfExperience" TEXT,
    "aadhar" TEXT,
    "pan" TEXT,
    "accountNumber" TEXT,
    "ifsc" TEXT,
    "bankName" TEXT,
    "branch" TEXT,
    "joinDate" DATE,
    "shiftId" TEXT,
    "reportsToId" TEXT,
    "halfHourConcession" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDesignation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrDesignation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDepartment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "headEmployeeId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrEmployeeDepartment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrEmployeeDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrEmployeeRole" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrEmployeeRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSalaryStructure" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "basic" DECIMAL(12,2) NOT NULL,
    "hraPct" DECIMAL(5,2) NOT NULL DEFAULT 40,
    "conveyancePct" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "medicalPct" DECIMAL(5,2) NOT NULL DEFAULT 25,
    "specialPct" DECIMAL(5,2) NOT NULL DEFAULT 15,
    "esiApplicable" BOOLEAN NOT NULL DEFAULT true,
    "pfApplicable" BOOLEAN NOT NULL DEFAULT true,
    "professionalTax" DECIMAL(8,2) NOT NULL DEFAULT 125,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrSalaryStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrLeavePolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyAccrual" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "annualEntitlement" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "carryForward" BOOLEAN NOT NULL DEFAULT true,
    "carryForwardCap" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrLeavePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrLeaveBalance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "opening" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "accrued" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "used" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrLeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrLeaveRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "days" DECIMAL(5,2) NOT NULL,
    "leaveType" TEXT NOT NULL DEFAULT 'CL',
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrLeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAttendanceUpload" (
    "id" TEXT NOT NULL,
    "filename" TEXT,
    "monthKey" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "HrAttendanceUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAttendanceDay" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shiftCode" TEXT,
    "inTime" TEXT,
    "outTime" TEXT,
    "workMinutes" INTEGER,
    "breakMinutes" INTEGER,
    "otMinutes" INTEGER,
    "lateMinutes" INTEGER,
    "earlyOutMinutes" INTEGER,
    "status" TEXT NOT NULL,
    "remark" TEXT,
    "rawName" TEXT,
    "rawStatus" TEXT,
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "HrAttendanceDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSalaryRun" (
    "id" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "workingDaysBase" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totalNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "axisExportName" TEXT,
    "axisExportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrSalaryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSalaryRunLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "totalWorkingDays" DECIMAL(5,2) NOT NULL,
    "daysAttended" DECIMAL(5,2) NOT NULL,
    "paidLeave" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "unpaidLeave" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "halfDayLeave" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "totalLeaveForLop" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "monthlySalary" DECIMAL(12,2) NOT NULL,
    "basicSalary" DECIMAL(12,2) NOT NULL,
    "basicAfterLop" DECIMAL(12,2) NOT NULL,
    "dailyBasis" DECIMAL(12,2) NOT NULL,
    "salaryBeforeEsi" DECIMAL(12,2) NOT NULL,
    "esiEmployee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pfEmployee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "professionalTax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netSalary" DECIMAL(12,2) NOT NULL,
    "esiEmployer" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pfEmployer" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "esiTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pfTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "adjustments" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "adjustmentNote" TEXT,
    "bankAccount" TEXT,
    "bankIfsc" TEXT,
    "bankName" TEXT,
    "bankBranch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrSalaryRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPolicy" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "body" TEXT NOT NULL,
    "externalUrl" TEXT,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "requiresAck" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPolicyAcknowledgement" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "signatureName" TEXT NOT NULL,
    "signatureImage" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrPolicyAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrTraining" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "videoUrl" TEXT,
    "quiz" JSONB,
    "passingScore" INTEGER NOT NULL DEFAULT 70,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrTraining_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrTrainingProgress" (
    "id" TEXT NOT NULL,
    "trainingId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "watchedPct" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "answers" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrTrainingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrNotification" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkUrl" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'announcement',
    "requiresAck" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrNotificationReceipt" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrNotificationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrShiftAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrLeaveEligibility" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency" TEXT NOT NULL DEFAULT 'monthly',
    "effectiveFrom" DATE NOT NULL,
    "leavesPerPeriod" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "leaveType" TEXT NOT NULL DEFAULT 'CL',
    "carryForward" BOOLEAN NOT NULL DEFAULT true,
    "carryForwardCap" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "expiryMonths" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrLeaveEligibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrLeaveAccrual" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "delta" DECIMAL(5,2) NOT NULL,
    "source" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL DEFAULT 'CL',
    "reason" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrLeaveAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAttendanceRegularization" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceDayId" TEXT,
    "date" DATE NOT NULL,
    "reasonType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "proposedIn" TEXT,
    "proposedOut" TEXT,
    "attachmentUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrAttendanceRegularization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSandwichPolicy" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "includeHolidays" BOOLEAN NOT NULL DEFAULT true,
    "includeWeekOffs" BOOLEAN NOT NULL DEFAULT true,
    "maxGapDays" INTEGER NOT NULL DEFAULT 7,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrSandwichPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrBirthdaySettings" (
    "id" TEXT NOT NULL,
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "autoWishEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reminderDays" INTEGER NOT NULL DEFAULT 1,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "template" TEXT NOT NULL DEFAULT 'Happy birthday, {{name}}! Wishing you a wonderful year ahead. — Team DESGRO',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrBirthdaySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrBirthdayWish" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "payload" JSONB,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrBirthdayWish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrEssCredentialEvent" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "channel" TEXT,
    "tempPasswordHash" TEXT,
    "actorUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrEssCredentialEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PsychTest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PsychTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PsychQuestion" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "dimension" "PsychDimension" NOT NULL,
    "textEn" TEXT NOT NULL,
    "textMl" TEXT,
    "reverseScored" BOOLEAN NOT NULL DEFAULT false,
    "validityPairId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PsychQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PsychAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenSalt" TEXT NOT NULL,
    "status" "PsychStatus" NOT NULL DEFAULT 'ASSIGNED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "ipHash" TEXT,
    "startAttempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PsychAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PsychResponse" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PsychResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PsychReport" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "oceanRaw" JSONB NOT NULL,
    "oceanNormalized" JSONB NOT NULL,
    "oceanPercentile" JSONB NOT NULL,
    "attitudeIndex" INTEGER NOT NULL,
    "attitudeClass" TEXT NOT NULL,
    "profileType" TEXT NOT NULL,
    "profileLabel" TEXT NOT NULL,
    "riskFlags" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "validityPassed" BOOLEAN NOT NULL,
    "validityNotes" TEXT,
    "durationSeconds" INTEGER,
    "suspiciousFlags" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PsychReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PartyToService" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PartyToService_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_month_idx" ON "Transaction"("month");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE INDEX "Transaction_category_idx" ON "Transaction"("category");

-- CreateIndex
CREATE INDEX "Transaction_deletedAt_idx" ON "Transaction"("deletedAt");

-- CreateIndex
CREATE INDEX "Transaction_month_type_idx" ON "Transaction"("month", "type");

-- CreateIndex
CREATE INDEX "Transaction_paymentMode_type_idx" ON "Transaction"("paymentMode", "type");

-- CreateIndex
CREATE INDEX "Transaction_partyId_idx" ON "Transaction"("partyId");

-- CreateIndex
CREATE INDEX "Category_type_idx" ON "Category"("type");

-- CreateIndex
CREATE INDEX "Category_isActive_idx" ON "Category"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_type_key" ON "Category"("name", "type");

-- CreateIndex
CREATE INDEX "SubCategory_categoryId_idx" ON "SubCategory"("categoryId");

-- CreateIndex
CREATE INDEX "SubCategory_isActive_idx" ON "SubCategory"("isActive");

-- CreateIndex
CREATE INDEX "SubCategory_serviceId_idx" ON "SubCategory"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "SubCategory_categoryId_name_key" ON "SubCategory"("categoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Service_name_key" ON "Service"("name");

-- CreateIndex
CREATE INDEX "Service_isActive_idx" ON "Service"("isActive");

-- CreateIndex
CREATE INDEX "Service_groupId_idx" ON "Service"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceGroup_name_key" ON "ServiceGroup"("name");

-- CreateIndex
CREATE INDEX "ServiceGroup_isActive_idx" ON "ServiceGroup"("isActive");

-- CreateIndex
CREATE INDEX "ServiceGroup_displayOrder_idx" ON "ServiceGroup"("displayOrder");

-- CreateIndex
CREATE INDEX "PartyService_partyId_idx" ON "PartyService"("partyId");

-- CreateIndex
CREATE INDEX "PartyService_serviceId_idx" ON "PartyService"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyService_partyId_serviceId_key" ON "PartyService"("partyId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseRole_userId_key" ON "LeadPulseRole"("userId");

-- CreateIndex
CREATE INDEX "LeadPulseRole_role_idx" ON "LeadPulseRole"("role");

-- CreateIndex
CREATE INDEX "LeadPulseRole_active_idx" ON "LeadPulseRole"("active");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseSource_code_key" ON "LeadPulseSource"("code");

-- CreateIndex
CREATE INDEX "LeadPulseSource_active_idx" ON "LeadPulseSource"("active");

-- CreateIndex
CREATE INDEX "LeadPulseSource_displayOrder_idx" ON "LeadPulseSource"("displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseRegion_code_key" ON "LeadPulseRegion"("code");

-- CreateIndex
CREATE INDEX "LeadPulseRegion_active_idx" ON "LeadPulseRegion"("active");

-- CreateIndex
CREATE INDEX "LeadPulseDailyEntry_entryDate_idx" ON "LeadPulseDailyEntry"("entryDate");

-- CreateIndex
CREATE INDEX "LeadPulseDailyEntry_userId_entryDate_idx" ON "LeadPulseDailyEntry"("userId", "entryDate");

-- CreateIndex
CREATE INDEX "LeadPulseDailyEntry_sourceId_idx" ON "LeadPulseDailyEntry"("sourceId");

-- CreateIndex
CREATE INDEX "LeadPulseDailyEntry_status_idx" ON "LeadPulseDailyEntry"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseDailyEntry_userId_entryDate_sourceId_key" ON "LeadPulseDailyEntry"("userId", "entryDate", "sourceId");

-- CreateIndex
CREATE INDEX "LeadPulseDailyClose_entryId_idx" ON "LeadPulseDailyClose"("entryId");

-- CreateIndex
CREATE INDEX "LeadPulseDailyClose_serviceId_idx" ON "LeadPulseDailyClose"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulsePipeline_dailyCloseId_key" ON "LeadPulsePipeline"("dailyCloseId");

-- CreateIndex
CREATE INDEX "LeadPulsePipeline_userId_expectedCloseDate_status_idx" ON "LeadPulsePipeline"("userId", "expectedCloseDate", "status");

-- CreateIndex
CREATE INDEX "LeadPulsePipeline_partyId_idx" ON "LeadPulsePipeline"("partyId");

-- CreateIndex
CREATE INDEX "LeadPulsePipeline_serviceId_idx" ON "LeadPulsePipeline"("serviceId");

-- CreateIndex
CREATE INDEX "LeadPulsePipeline_sourceId_idx" ON "LeadPulsePipeline"("sourceId");

-- CreateIndex
CREATE INDEX "LeadPulsePipeline_status_expectedCloseDate_idx" ON "LeadPulsePipeline"("status", "expectedCloseDate");

-- CreateIndex
CREATE INDEX "LeadPulseDailyMeta_entryDate_idx" ON "LeadPulseDailyMeta"("entryDate");

-- CreateIndex
CREATE INDEX "LeadPulseDailyMeta_status_idx" ON "LeadPulseDailyMeta"("status");

-- CreateIndex
CREATE INDEX "LeadPulseDailyMeta_reviewedById_idx" ON "LeadPulseDailyMeta"("reviewedById");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseDailyMeta_userId_entryDate_key" ON "LeadPulseDailyMeta"("userId", "entryDate");

-- CreateIndex
CREATE INDEX "LeadPulseUnlock_userId_idx" ON "LeadPulseUnlock"("userId");

-- CreateIndex
CREATE INDEX "LeadPulseUnlock_entryDate_idx" ON "LeadPulseUnlock"("entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseUnlock_userId_entryDate_key" ON "LeadPulseUnlock"("userId", "entryDate");

-- CreateIndex
CREATE INDEX "LeadPulseAuditLog_eventType_idx" ON "LeadPulseAuditLog"("eventType");

-- CreateIndex
CREATE INDEX "LeadPulseAuditLog_occurredAt_idx" ON "LeadPulseAuditLog"("occurredAt");

-- CreateIndex
CREATE INDEX "LeadPulseAuditLog_actorUserId_idx" ON "LeadPulseAuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "LeadPulseMonthlySnapshot_year_month_idx" ON "LeadPulseMonthlySnapshot"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseMonthlySnapshot_year_month_userId_role_sourceId_key" ON "LeadPulseMonthlySnapshot"("year", "month", "userId", "role", "sourceId");

-- CreateIndex
CREATE INDEX "LeadPulseTarget_year_month_idx" ON "LeadPulseTarget"("year", "month");

-- CreateIndex
CREATE INDEX "LeadPulseTarget_userId_idx" ON "LeadPulseTarget"("userId");

-- CreateIndex
CREATE INDEX "LeadPulseTarget_groupId_idx" ON "LeadPulseTarget"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseTarget_year_month_userId_serviceId_key" ON "LeadPulseTarget"("year", "month", "userId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseTarget_year_month_userId_groupId_key" ON "LeadPulseTarget"("year", "month", "userId", "groupId");

-- CreateIndex
CREATE INDEX "Holiday_date_idx" ON "Holiday"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Party_name_key" ON "Party"("name");

-- CreateIndex
CREATE INDEX "Party_group_idx" ON "Party"("group");

-- CreateIndex
CREATE INDEX "Party_isActive_idx" ON "Party"("isActive");

-- CreateIndex
CREATE INDEX "Party_sourceId_idx" ON "Party"("sourceId");

-- CreateIndex
CREATE INDEX "Party_assignedL2BdeId_idx" ON "Party"("assignedL2BdeId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PendingApproval_collectionInstallmentId_key" ON "PendingApproval"("collectionInstallmentId");

-- CreateIndex
CREATE INDEX "PendingApproval_status_createdAt_idx" ON "PendingApproval"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PendingApproval_submittedById_idx" ON "PendingApproval"("submittedById");

-- CreateIndex
CREATE INDEX "PendingApproval_targetTxId_idx" ON "PendingApproval"("targetTxId");

-- CreateIndex
CREATE INDEX "TransactionDraft_submittedById_idx" ON "TransactionDraft"("submittedById");

-- CreateIndex
CREATE INDEX "TransactionDraft_createdAt_idx" ON "TransactionDraft"("createdAt");

-- CreateIndex
CREATE INDEX "VoxbayUpload_uploadedAt_idx" ON "VoxbayUpload"("uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoxbayCall_signature_key" ON "VoxbayCall"("signature");

-- CreateIndex
CREATE INDEX "VoxbayCall_callStartTime_idx" ON "VoxbayCall"("callStartTime");

-- CreateIndex
CREATE INDEX "VoxbayCall_callStatus_idx" ON "VoxbayCall"("callStatus");

-- CreateIndex
CREATE INDEX "VoxbayCall_userStatus_idx" ON "VoxbayCall"("userStatus");

-- CreateIndex
CREATE INDEX "VoxbayCall_agentName_idx" ON "VoxbayCall"("agentName");

-- CreateIndex
CREATE INDEX "VoxbayCall_lastTriedName_idx" ON "VoxbayCall"("lastTriedName");

-- CreateIndex
CREATE INDEX "LeadPulseBdeInsight_userId_idx" ON "LeadPulseBdeInsight"("userId");

-- CreateIndex
CREATE INDEX "LeadPulseBdeInsight_year_month_idx" ON "LeadPulseBdeInsight"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseBdeInsight_userId_year_month_key" ON "LeadPulseBdeInsight"("userId", "year", "month");

-- CreateIndex
CREATE INDEX "CollectionPlan_partyId_idx" ON "CollectionPlan"("partyId");

-- CreateIndex
CREATE INDEX "CollectionPlan_serviceId_idx" ON "CollectionPlan"("serviceId");

-- CreateIndex
CREATE INDEX "CollectionPlan_status_idx" ON "CollectionPlan"("status");

-- CreateIndex
CREATE INDEX "CollectionPlan_createdById_idx" ON "CollectionPlan"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPlanInstallment_pendingApprovalId_key" ON "CollectionPlanInstallment"("pendingApprovalId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPlanInstallment_transactionId_key" ON "CollectionPlanInstallment"("transactionId");

-- CreateIndex
CREATE INDEX "CollectionPlanInstallment_planId_idx" ON "CollectionPlanInstallment"("planId");

-- CreateIndex
CREATE INDEX "CollectionPlanInstallment_status_idx" ON "CollectionPlanInstallment"("status");

-- CreateIndex
CREATE INDEX "CollectionPlanInstallment_expectedDate_idx" ON "CollectionPlanInstallment"("expectedDate");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPlanInstallment_planId_seq_key" ON "CollectionPlanInstallment"("planId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "HrShift_code_key" ON "HrShift"("code");

-- CreateIndex
CREATE INDEX "HrShift_active_idx" ON "HrShift"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_empCode_key" ON "Employee"("empCode");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_active_idx" ON "Employee"("active");

-- CreateIndex
CREATE INDEX "Employee_shiftId_idx" ON "Employee"("shiftId");

-- CreateIndex
CREATE INDEX "Employee_department_idx" ON "Employee"("department");

-- CreateIndex
CREATE INDEX "Employee_designationId_idx" ON "Employee"("designationId");

-- CreateIndex
CREATE INDEX "Employee_reportsToId_idx" ON "Employee"("reportsToId");

-- CreateIndex
CREATE UNIQUE INDEX "HrDesignation_name_key" ON "HrDesignation"("name");

-- CreateIndex
CREATE INDEX "HrDesignation_active_idx" ON "HrDesignation"("active");

-- CreateIndex
CREATE INDEX "HrDesignation_level_idx" ON "HrDesignation"("level");

-- CreateIndex
CREATE UNIQUE INDEX "HrDepartment_name_key" ON "HrDepartment"("name");

-- CreateIndex
CREATE INDEX "HrDepartment_active_idx" ON "HrDepartment"("active");

-- CreateIndex
CREATE INDEX "HrEmployeeDepartment_departmentId_idx" ON "HrEmployeeDepartment"("departmentId");

-- CreateIndex
CREATE INDEX "HrEmployeeDepartment_employeeId_idx" ON "HrEmployeeDepartment"("employeeId");

-- CreateIndex
CREATE INDEX "HrEmployeeDepartment_employeeId_isPrimary_idx" ON "HrEmployeeDepartment"("employeeId", "isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "HrEmployeeDepartment_employeeId_departmentId_key" ON "HrEmployeeDepartment"("employeeId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "HrRole_name_key" ON "HrRole"("name");

-- CreateIndex
CREATE INDEX "HrRole_active_idx" ON "HrRole"("active");

-- CreateIndex
CREATE INDEX "HrEmployeeRole_employeeId_idx" ON "HrEmployeeRole"("employeeId");

-- CreateIndex
CREATE INDEX "HrEmployeeRole_roleId_idx" ON "HrEmployeeRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "HrEmployeeRole_employeeId_roleId_key" ON "HrEmployeeRole"("employeeId", "roleId");

-- CreateIndex
CREATE INDEX "HrSalaryStructure_employeeId_idx" ON "HrSalaryStructure"("employeeId");

-- CreateIndex
CREATE INDEX "HrSalaryStructure_effectiveFrom_idx" ON "HrSalaryStructure"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "HrSalaryStructure_employeeId_effectiveFrom_key" ON "HrSalaryStructure"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "HrLeavePolicy_name_key" ON "HrLeavePolicy"("name");

-- CreateIndex
CREATE INDEX "HrLeaveBalance_year_idx" ON "HrLeaveBalance"("year");

-- CreateIndex
CREATE UNIQUE INDEX "HrLeaveBalance_employeeId_year_key" ON "HrLeaveBalance"("employeeId", "year");

-- CreateIndex
CREATE INDEX "HrLeaveRequest_employeeId_fromDate_idx" ON "HrLeaveRequest"("employeeId", "fromDate");

-- CreateIndex
CREATE INDEX "HrLeaveRequest_status_idx" ON "HrLeaveRequest"("status");

-- CreateIndex
CREATE INDEX "HrAttendanceUpload_monthKey_idx" ON "HrAttendanceUpload"("monthKey");

-- CreateIndex
CREATE INDEX "HrAttendanceUpload_uploadedAt_idx" ON "HrAttendanceUpload"("uploadedAt");

-- CreateIndex
CREATE INDEX "HrAttendanceDay_date_idx" ON "HrAttendanceDay"("date");

-- CreateIndex
CREATE INDEX "HrAttendanceDay_status_idx" ON "HrAttendanceDay"("status");

-- CreateIndex
CREATE UNIQUE INDEX "HrAttendanceDay_employeeId_date_key" ON "HrAttendanceDay"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HrSalaryRun_monthKey_key" ON "HrSalaryRun"("monthKey");

-- CreateIndex
CREATE INDEX "HrSalaryRun_status_idx" ON "HrSalaryRun"("status");

-- CreateIndex
CREATE INDEX "HrSalaryRunLine_employeeId_idx" ON "HrSalaryRunLine"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "HrSalaryRunLine_runId_employeeId_key" ON "HrSalaryRunLine"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "HrPolicy_status_idx" ON "HrPolicy"("status");

-- CreateIndex
CREATE INDEX "HrPolicyAcknowledgement_employeeId_idx" ON "HrPolicyAcknowledgement"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "HrPolicyAcknowledgement_policyId_employeeId_key" ON "HrPolicyAcknowledgement"("policyId", "employeeId");

-- CreateIndex
CREATE INDEX "HrTraining_status_idx" ON "HrTraining"("status");

-- CreateIndex
CREATE INDEX "HrTrainingProgress_employeeId_idx" ON "HrTrainingProgress"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "HrTrainingProgress_trainingId_employeeId_key" ON "HrTrainingProgress"("trainingId", "employeeId");

-- CreateIndex
CREATE INDEX "HrNotification_kind_idx" ON "HrNotification"("kind");

-- CreateIndex
CREATE INDEX "HrNotificationReceipt_employeeId_idx" ON "HrNotificationReceipt"("employeeId");

-- CreateIndex
CREATE INDEX "HrNotificationReceipt_acknowledgedAt_idx" ON "HrNotificationReceipt"("acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrNotificationReceipt_notificationId_employeeId_key" ON "HrNotificationReceipt"("notificationId", "employeeId");

-- CreateIndex
CREATE INDEX "HrAuditLog_eventType_idx" ON "HrAuditLog"("eventType");

-- CreateIndex
CREATE INDEX "HrAuditLog_occurredAt_idx" ON "HrAuditLog"("occurredAt");

-- CreateIndex
CREATE INDEX "HrAuditLog_actorUserId_idx" ON "HrAuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "HrShiftAssignment_employeeId_effectiveFrom_idx" ON "HrShiftAssignment"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "HrShiftAssignment_shiftId_idx" ON "HrShiftAssignment"("shiftId");

-- CreateIndex
CREATE INDEX "HrShiftAssignment_status_idx" ON "HrShiftAssignment"("status");

-- CreateIndex
CREATE INDEX "HrShiftAssignment_effectiveFrom_effectiveTo_idx" ON "HrShiftAssignment"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "HrLeaveEligibility_employeeId_key" ON "HrLeaveEligibility"("employeeId");

-- CreateIndex
CREATE INDEX "HrLeaveEligibility_enabled_idx" ON "HrLeaveEligibility"("enabled");

-- CreateIndex
CREATE INDEX "HrLeaveAccrual_employeeId_createdAt_idx" ON "HrLeaveAccrual"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "HrLeaveAccrual_periodKey_idx" ON "HrLeaveAccrual"("periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "HrLeaveAccrual_employeeId_periodKey_source_key" ON "HrLeaveAccrual"("employeeId", "periodKey", "source");

-- CreateIndex
CREATE INDEX "HrAttendanceRegularization_employeeId_date_idx" ON "HrAttendanceRegularization"("employeeId", "date");

-- CreateIndex
CREATE INDEX "HrAttendanceRegularization_status_createdAt_idx" ON "HrAttendanceRegularization"("status", "createdAt");

-- CreateIndex
CREATE INDEX "HrSandwichPolicy_enabled_idx" ON "HrSandwichPolicy"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "HrSandwichPolicy_departmentId_key" ON "HrSandwichPolicy"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "HrBirthdaySettings_singleton_key" ON "HrBirthdaySettings"("singleton");

-- CreateIndex
CREATE INDEX "HrBirthdayWish_year_idx" ON "HrBirthdayWish"("year");

-- CreateIndex
CREATE UNIQUE INDEX "HrBirthdayWish_employeeId_year_key" ON "HrBirthdayWish"("employeeId", "year");

-- CreateIndex
CREATE INDEX "HrEssCredentialEvent_employeeId_createdAt_idx" ON "HrEssCredentialEvent"("employeeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PsychTest_name_key" ON "PsychTest"("name");

-- CreateIndex
CREATE INDEX "PsychTest_active_idx" ON "PsychTest"("active");

-- CreateIndex
CREATE INDEX "PsychQuestion_testId_dimension_idx" ON "PsychQuestion"("testId", "dimension");

-- CreateIndex
CREATE INDEX "PsychQuestion_validityPairId_idx" ON "PsychQuestion"("validityPairId");

-- CreateIndex
CREATE UNIQUE INDEX "PsychQuestion_testId_order_key" ON "PsychQuestion"("testId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PsychAssignment_tokenHash_key" ON "PsychAssignment"("tokenHash");

-- CreateIndex
CREATE INDEX "PsychAssignment_employeeId_idx" ON "PsychAssignment"("employeeId");

-- CreateIndex
CREATE INDEX "PsychAssignment_testId_idx" ON "PsychAssignment"("testId");

-- CreateIndex
CREATE INDEX "PsychAssignment_status_idx" ON "PsychAssignment"("status");

-- CreateIndex
CREATE INDEX "PsychAssignment_expiresAt_idx" ON "PsychAssignment"("expiresAt");

-- CreateIndex
CREATE INDEX "PsychResponse_assignmentId_idx" ON "PsychResponse"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PsychResponse_assignmentId_questionId_key" ON "PsychResponse"("assignmentId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "PsychReport_assignmentId_key" ON "PsychReport"("assignmentId");

-- CreateIndex
CREATE INDEX "PsychReport_employeeId_idx" ON "PsychReport"("employeeId");

-- CreateIndex
CREATE INDEX "PsychReport_generatedAt_idx" ON "PsychReport"("generatedAt");

-- CreateIndex
CREATE INDEX "_PartyToService_B_index" ON "_PartyToService"("B");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubCategory" ADD CONSTRAINT "SubCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubCategory" ADD CONSTRAINT "SubCategory_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ServiceGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyService" ADD CONSTRAINT "PartyService_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyService" ADD CONSTRAINT "PartyService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseRole" ADD CONSTRAINT "LeadPulseRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseDailyEntry" ADD CONSTRAINT "LeadPulseDailyEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseDailyEntry" ADD CONSTRAINT "LeadPulseDailyEntry_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadPulseSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseDailyClose" ADD CONSTRAINT "LeadPulseDailyClose_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "LeadPulseDailyEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseDailyClose" ADD CONSTRAINT "LeadPulseDailyClose_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulsePipeline" ADD CONSTRAINT "LeadPulsePipeline_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulsePipeline" ADD CONSTRAINT "LeadPulsePipeline_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulsePipeline" ADD CONSTRAINT "LeadPulsePipeline_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulsePipeline" ADD CONSTRAINT "LeadPulsePipeline_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadPulseSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulsePipeline" ADD CONSTRAINT "LeadPulsePipeline_dailyCloseId_fkey" FOREIGN KEY ("dailyCloseId") REFERENCES "LeadPulseDailyClose"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseDailyMeta" ADD CONSTRAINT "LeadPulseDailyMeta_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseDailyMeta" ADD CONSTRAINT "LeadPulseDailyMeta_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseUnlock" ADD CONSTRAINT "LeadPulseUnlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseUnlock" ADD CONSTRAINT "LeadPulseUnlock_unlockedById_fkey" FOREIGN KEY ("unlockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseAuditLog" ADD CONSTRAINT "LeadPulseAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseMonthlySnapshot" ADD CONSTRAINT "LeadPulseMonthlySnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadPulseSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseTarget" ADD CONSTRAINT "LeadPulseTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseTarget" ADD CONSTRAINT "LeadPulseTarget_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseTarget" ADD CONSTRAINT "LeadPulseTarget_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ServiceGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseTarget" ADD CONSTRAINT "LeadPulseTarget_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadPulseSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_assignedL2BdeId_fkey" FOREIGN KEY ("assignedL2BdeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingApproval" ADD CONSTRAINT "PendingApproval_targetTxId_fkey" FOREIGN KEY ("targetTxId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingApproval" ADD CONSTRAINT "PendingApproval_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingApproval" ADD CONSTRAINT "PendingApproval_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingApproval" ADD CONSTRAINT "PendingApproval_collectionInstallmentId_fkey" FOREIGN KEY ("collectionInstallmentId") REFERENCES "CollectionPlanInstallment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionDraft" ADD CONSTRAINT "TransactionDraft_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionDraft" ADD CONSTRAINT "TransactionDraft_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoxbayUpload" ADD CONSTRAINT "VoxbayUpload_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPulseBdeInsight" ADD CONSTRAINT "LeadPulseBdeInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionPlan" ADD CONSTRAINT "CollectionPlan_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionPlan" ADD CONSTRAINT "CollectionPlan_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionPlan" ADD CONSTRAINT "CollectionPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionPlanInstallment" ADD CONSTRAINT "CollectionPlanInstallment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CollectionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionPlanInstallment" ADD CONSTRAINT "CollectionPlanInstallment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "HrDesignation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "HrShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDepartment" ADD CONSTRAINT "HrDepartment_headEmployeeId_fkey" FOREIGN KEY ("headEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployeeDepartment" ADD CONSTRAINT "HrEmployeeDepartment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployeeDepartment" ADD CONSTRAINT "HrEmployeeDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "HrDepartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployeeRole" ADD CONSTRAINT "HrEmployeeRole_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployeeRole" ADD CONSTRAINT "HrEmployeeRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "HrRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSalaryStructure" ADD CONSTRAINT "HrSalaryStructure_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrLeaveBalance" ADD CONSTRAINT "HrLeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrLeaveRequest" ADD CONSTRAINT "HrLeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrLeaveRequest" ADD CONSTRAINT "HrLeaveRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendanceUpload" ADD CONSTRAINT "HrAttendanceUpload_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendanceDay" ADD CONSTRAINT "HrAttendanceDay_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "HrAttendanceUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendanceDay" ADD CONSTRAINT "HrAttendanceDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendanceDay" ADD CONSTRAINT "HrAttendanceDay_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSalaryRun" ADD CONSTRAINT "HrSalaryRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSalaryRun" ADD CONSTRAINT "HrSalaryRun_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSalaryRunLine" ADD CONSTRAINT "HrSalaryRunLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "HrSalaryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSalaryRunLine" ADD CONSTRAINT "HrSalaryRunLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrPolicy" ADD CONSTRAINT "HrPolicy_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrPolicyAcknowledgement" ADD CONSTRAINT "HrPolicyAcknowledgement_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "HrPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrPolicyAcknowledgement" ADD CONSTRAINT "HrPolicyAcknowledgement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrTraining" ADD CONSTRAINT "HrTraining_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrTrainingProgress" ADD CONSTRAINT "HrTrainingProgress_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "HrTraining"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrTrainingProgress" ADD CONSTRAINT "HrTrainingProgress_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrNotification" ADD CONSTRAINT "HrNotification_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrNotificationReceipt" ADD CONSTRAINT "HrNotificationReceipt_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "HrNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrNotificationReceipt" ADD CONSTRAINT "HrNotificationReceipt_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAuditLog" ADD CONSTRAINT "HrAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrShiftAssignment" ADD CONSTRAINT "HrShiftAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrShiftAssignment" ADD CONSTRAINT "HrShiftAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "HrShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrLeaveEligibility" ADD CONSTRAINT "HrLeaveEligibility_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrLeaveAccrual" ADD CONSTRAINT "HrLeaveAccrual_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendanceRegularization" ADD CONSTRAINT "HrAttendanceRegularization_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSandwichPolicy" ADD CONSTRAINT "HrSandwichPolicy_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "HrDepartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrBirthdayWish" ADD CONSTRAINT "HrBirthdayWish_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychTest" ADD CONSTRAINT "PsychTest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychQuestion" ADD CONSTRAINT "PsychQuestion_testId_fkey" FOREIGN KEY ("testId") REFERENCES "PsychTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychAssignment" ADD CONSTRAINT "PsychAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychAssignment" ADD CONSTRAINT "PsychAssignment_testId_fkey" FOREIGN KEY ("testId") REFERENCES "PsychTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychAssignment" ADD CONSTRAINT "PsychAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychResponse" ADD CONSTRAINT "PsychResponse_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "PsychAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychResponse" ADD CONSTRAINT "PsychResponse_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "PsychQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychReport" ADD CONSTRAINT "PsychReport_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "PsychAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychReport" ADD CONSTRAINT "PsychReport_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PartyToService" ADD CONSTRAINT "_PartyToService_A_fkey" FOREIGN KEY ("A") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PartyToService" ADD CONSTRAINT "_PartyToService_B_fkey" FOREIGN KEY ("B") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

