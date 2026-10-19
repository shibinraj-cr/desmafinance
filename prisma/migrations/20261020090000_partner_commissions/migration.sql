-- Partner Commissions (NCLEX / OSCE / GCAN). Additive only: new tables, plus
-- the Revenue sub-items commission receipts post to and the page grant for the
-- two Finance roles. No partner, rate or bank data here (the repository is
-- public) — that is entered on the Settings tab.

-- CreateTable
CREATE TABLE "CommissionPartner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "forLine" TEXT,
    "layout" TEXT NOT NULL DEFAULT 'compact',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "partyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionProgram" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "defaultFee" DECIMAL(12,2),
    "defaultPct" DECIMAL(5,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionEnrollment" (
    "id" TEXT NOT NULL,
    "program" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "candidateName" TEXT NOT NULL,
    "leadId" TEXT,
    "studentId" TEXT,
    "courseName" TEXT NOT NULL,
    "intakeMonth" TEXT NOT NULL,
    "courseFee" DECIMAL(12,2) NOT NULL,
    "commissionPct" DECIMAL(5,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "fullyPaidOn" DATE,
    "invoiceId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionFeePayment" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidOn" DATE NOT NULL,
    "reference" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionFeePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionInvoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "paymentTerm" TEXT NOT NULL DEFAULT 'Immediate',
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "billToName" TEXT NOT NULL,
    "billToAddress" TEXT NOT NULL DEFAULT '',
    "billToEmail" TEXT,
    "billToFor" TEXT,
    "amountWords" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "position" INTEGER NOT NULL,
    "program" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "studentId" TEXT,
    "courseName" TEXT NOT NULL,
    "intakeMonth" TEXT NOT NULL,
    "courseFee" DECIMAL(12,2) NOT NULL,
    "commissionPct" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "CommissionInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionReceipt" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "audSettled" DECIMAL(12,2) NOT NULL,
    "aedAmount" DECIMAL(14,2) NOT NULL,
    "inrAmount" DECIMAL(14,2) NOT NULL,
    "aedInrRate" DECIMAL(12,6) NOT NULL,
    "reference" TEXT,
    "settleInFull" BOOLEAN NOT NULL DEFAULT true,
    "skipLedger" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'awaiting',
    "recordedById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "postedTxIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "issuerName" TEXT NOT NULL DEFAULT '',
    "issuerAddress" TEXT NOT NULL DEFAULT '',
    "issuerRegLine" TEXT NOT NULL DEFAULT '',
    "bankAccountName" TEXT NOT NULL DEFAULT '',
    "bankCurrency" TEXT NOT NULL DEFAULT 'AED',
    "bankIban" TEXT NOT NULL DEFAULT '',
    "bankBic" TEXT NOT NULL DEFAULT '',
    "bankAccountNo" TEXT NOT NULL DEFAULT '',
    "signatoryName" TEXT NOT NULL DEFAULT '',
    "signaturePng" BYTEA,
    "signatureMime" TEXT,
    "numberPrefix" TEXT NOT NULL DEFAULT 'D/DLLC/',
    "runDay" INTEGER NOT NULL DEFAULT 20,
    "emailAlerts" BOOLEAN NOT NULL DEFAULT true,
    "bdePrograms" TEXT[] DEFAULT ARRAY['GCAN']::TEXT[],
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionEnrollGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "programs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionEnrollGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRun" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "CommissionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommissionPartner_name_key" ON "CommissionPartner"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionProgram_code_key" ON "CommissionProgram"("code");

-- CreateIndex
CREATE INDEX "CommissionEnrollment_program_idx" ON "CommissionEnrollment"("program");

-- CreateIndex
CREATE INDEX "CommissionEnrollment_partnerId_idx" ON "CommissionEnrollment"("partnerId");

-- CreateIndex
CREATE INDEX "CommissionEnrollment_invoiceId_idx" ON "CommissionEnrollment"("invoiceId");

-- CreateIndex
CREATE INDEX "CommissionEnrollment_status_fullyPaidOn_idx" ON "CommissionEnrollment"("status", "fullyPaidOn");

-- CreateIndex
CREATE INDEX "CommissionEnrollment_createdById_idx" ON "CommissionEnrollment"("createdById");

-- CreateIndex
CREATE INDEX "CommissionEnrollment_leadId_idx" ON "CommissionEnrollment"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionFeePayment_enrollmentId_seq_key" ON "CommissionFeePayment"("enrollmentId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionInvoice_number_key" ON "CommissionInvoice"("number");

-- CreateIndex
CREATE INDEX "CommissionInvoice_partnerId_idx" ON "CommissionInvoice"("partnerId");

-- CreateIndex
CREATE INDEX "CommissionInvoice_status_idx" ON "CommissionInvoice"("status");

-- CreateIndex
CREATE INDEX "CommissionInvoice_invoiceDate_idx" ON "CommissionInvoice"("invoiceDate");

-- CreateIndex
CREATE INDEX "CommissionInvoiceLine_invoiceId_idx" ON "CommissionInvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "CommissionInvoiceLine_enrollmentId_idx" ON "CommissionInvoiceLine"("enrollmentId");

-- CreateIndex
CREATE INDEX "CommissionReceipt_invoiceId_idx" ON "CommissionReceipt"("invoiceId");

-- CreateIndex
CREATE INDEX "CommissionReceipt_status_idx" ON "CommissionReceipt"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionEnrollGrant_userId_key" ON "CommissionEnrollGrant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionRun_month_key" ON "CommissionRun"("month");

-- AddForeignKey
ALTER TABLE "CommissionPartner" ADD CONSTRAINT "CommissionPartner_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionProgram" ADD CONSTRAINT "CommissionProgram_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "CommissionPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEnrollment" ADD CONSTRAINT "CommissionEnrollment_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "CommissionPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEnrollment" ADD CONSTRAINT "CommissionEnrollment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEnrollment" ADD CONSTRAINT "CommissionEnrollment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CommissionInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEnrollment" ADD CONSTRAINT "CommissionEnrollment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionFeePayment" ADD CONSTRAINT "CommissionFeePayment_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CommissionEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionFeePayment" ADD CONSTRAINT "CommissionFeePayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionInvoice" ADD CONSTRAINT "CommissionInvoice_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "CommissionPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionInvoice" ADD CONSTRAINT "CommissionInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionInvoiceLine" ADD CONSTRAINT "CommissionInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CommissionInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionInvoiceLine" ADD CONSTRAINT "CommissionInvoiceLine_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CommissionEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionReceipt" ADD CONSTRAINT "CommissionReceipt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CommissionInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionReceipt" ADD CONSTRAINT "CommissionReceipt_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionReceipt" ADD CONSTRAINT "CommissionReceipt_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEnrollGrant" ADD CONSTRAINT "CommissionEnrollGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The Revenue sub-items approved commission receipts post to:
-- Commissions › NCLEX / OSCE / GCAN Commission. NCLEX and OSCE usually exist
-- already (they are in the catalog); GCAN is new. Idempotent.
INSERT INTO "Category" ("id", "name", "type", "isActive", "isSystem", "createdAt", "updatedAt")
SELECT 'pc_cat_commissions_rev', 'Commissions', 'Revenue', true, false, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Category" WHERE "name" = 'Commissions' AND "type" IN ('Revenue', 'Both')
);

INSERT INTO "SubCategory" ("id", "categoryId", "name", "isActive", "isSystem", "createdAt", "updatedAt")
SELECT 'pc_sub_' || lower(s.code) || '_' || substr(md5(c."id"), 1, 10), c."id", s.code || ' Commission', true, false, NOW(), NOW()
FROM "Category" c
CROSS JOIN (VALUES ('NCLEX'), ('OSCE'), ('GCAN')) AS s(code)
WHERE c."name" = 'Commissions' AND c."type" IN ('Revenue', 'Both')
ON CONFLICT ("categoryId", "name") DO NOTHING;

-- Finance Manager and Finance Executive get the new page (admins see every page).
UPDATE "Role"
SET "pages" = array_append(COALESCE("pages", ARRAY[]::TEXT[]), '/finance/partner-commissions')
WHERE "name" IN ('Finance Manager', 'Finance Executive')
  AND NOT ('/finance/partner-commissions' = ANY(COALESCE("pages", ARRAY[]::TEXT[])));
