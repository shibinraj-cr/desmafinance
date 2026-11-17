-- Enrollment confirmation (CRM Enroll sheet) and Finance verification.
-- Additive: a new table, plus the new Finance page for the finance roles.

-- CreateTable
CREATE TABLE "CrmEnrollment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "pipelineId" TEXT,
    "ownerUserId" TEXT,
    "submittedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "exception" TEXT,
    "exceptionById" TEXT,
    "exceptionAt" TIMESTAMP(3),
    "exceptionNote" TEXT,
    "billingName" TEXT NOT NULL,
    "billingCountry" TEXT NOT NULL,
    "billingState" TEXT,
    "billingAddress" TEXT,
    "billingPin" TEXT,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "firstAmount" DECIMAL(14,2),
    "paidOn" DATE,
    "paymentMode" TEXT,
    "utr" TEXT,
    "payerRelation" TEXT,
    "payerName" TEXT,
    "plan" JSONB NOT NULL DEFAULT '[]',
    "category" TEXT,
    "subItem" TEXT,
    "expDom" TEXT,
    "submitted" JSONB NOT NULL,
    "financeNote" TEXT,
    "transactionId" TEXT,
    "collectionPlanId" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmEnrollment_transactionId_key" ON "CrmEnrollment"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmEnrollment_collectionPlanId_key" ON "CrmEnrollment"("collectionPlanId");

-- CreateIndex
CREATE INDEX "CrmEnrollment_leadId_idx" ON "CrmEnrollment"("leadId");

-- CreateIndex
CREATE INDEX "CrmEnrollment_partyId_idx" ON "CrmEnrollment"("partyId");

-- CreateIndex
CREATE INDEX "CrmEnrollment_pipelineId_idx" ON "CrmEnrollment"("pipelineId");

-- CreateIndex
CREATE INDEX "CrmEnrollment_status_createdAt_idx" ON "CrmEnrollment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CrmEnrollment_ownerUserId_idx" ON "CrmEnrollment"("ownerUserId");

-- AddForeignKey
ALTER TABLE "CrmEnrollment" ADD CONSTRAINT "CrmEnrollment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnrollment" ADD CONSTRAINT "CrmEnrollment_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnrollment" ADD CONSTRAINT "CrmEnrollment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnrollment" ADD CONSTRAINT "CrmEnrollment_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "LeadPulsePipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnrollment" ADD CONSTRAINT "CrmEnrollment_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnrollment" ADD CONSTRAINT "CrmEnrollment_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnrollment" ADD CONSTRAINT "CrmEnrollment_exceptionById_fkey" FOREIGN KEY ("exceptionById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnrollment" ADD CONSTRAINT "CrmEnrollment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnrollment" ADD CONSTRAINT "CrmEnrollment_collectionPlanId_fkey" FOREIGN KEY ("collectionPlanId") REFERENCES "CollectionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnrollment" ADD CONSTRAINT "CrmEnrollment_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Finance › Verify enrollments for the finance roles (same pattern as Invoices).
UPDATE "Role"
SET "pages" = array_append(COALESCE("pages", ARRAY[]::TEXT[]), '/finance/enrollments')
WHERE "name" IN ('Finance Manager', 'Finance Executive')
  AND NOT ('/finance/enrollments' = ANY(COALESCE("pages", ARRAY[]::TEXT[])));
