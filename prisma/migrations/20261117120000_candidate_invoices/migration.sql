-- Candidate GST invoices (src/lib/invoices/).
--
-- Additive only: new tables and nullable Party columns, so the running
-- deployment is unaffected while this applies. Nothing is invoiced until a
-- Finance Manager fills in Invoice settings and sets the cut-over date.
--
-- The seeded rows below are structure only (which companies, which banks,
-- which number series). Company details, bank details and signatures are
-- entered in the app and never stored in the repository.

-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "billingAddress" TEXT,
ADD COLUMN     "billingCountry" TEXT,
ADD COLUMN     "billingName" TEXT,
ADD COLUMN     "billingPin" TEXT,
ADD COLUMN     "billingState" TEXT;

-- CreateTable
CREATE TABLE "InvoiceEntity" (
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL DEFAULT '',
    "headerLines" TEXT NOT NULL DEFAULT '',
    "signFor" TEXT NOT NULL DEFAULT '',
    "thanksLine" TEXT NOT NULL DEFAULT '',
    "gstin" TEXT,
    "sacCode" TEXT NOT NULL DEFAULT '',
    "lutArn" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "signatoryName" TEXT NOT NULL DEFAULT '',
    "signaturePng" BYTEA,
    "signatureMime" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceEntity_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "InvoiceBank" (
    "paymentMode" TEXT NOT NULL,
    "entityCode" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceBank_pkey" PRIMARY KEY ("paymentMode")
);

-- CreateTable
CREATE TABLE "InvoiceSeries" (
    "key" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "fyStyle" TEXT NOT NULL DEFAULT 'dash',
    "padding" INTEGER NOT NULL DEFAULT 3,
    "nextNumber" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceSeries_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "seriesKey" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "entityCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "invoiceDate" DATE NOT NULL,
    "transactionId" TEXT NOT NULL,
    "partyId" TEXT,
    "paymentMode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "taxableAmount" DECIMAL(14,2) NOT NULL,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "receivedInr" DECIMAL(14,2) NOT NULL,
    "exchangeRate" DECIMAL(14,6) NOT NULL DEFAULT 1,
    "billToName" TEXT NOT NULL,
    "billToAddress" TEXT NOT NULL,
    "placeOfSupply" TEXT,
    "description" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceFile" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_transactionId_idx" ON "Invoice"("transactionId");

-- CreateIndex
CREATE INDEX "Invoice_partyId_idx" ON "Invoice"("partyId");

-- CreateIndex
CREATE INDEX "Invoice_invoiceDate_idx" ON "Invoice"("invoiceDate");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_seriesKey_fy_seq_key" ON "Invoice"("seriesKey", "fy", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceFile_invoiceId_kind_key" ON "InvoiceFile"("invoiceId", "kind");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceFile" ADD CONSTRAINT "InvoiceFile_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one live (issued) invoice per payment. Partial, because cancelled
-- invoices stay on the row with their numbers. Prisma can't express partial
-- indexes: see the WARNING on model Invoice in schema.prisma.
CREATE UNIQUE INDEX "Invoice_transactionId_live_key" ON "Invoice"("transactionId") WHERE "status" = 'issued';

-- The two issuing companies, empty until Finance fills them in.
INSERT INTO "InvoiceEntity" ("code", "updatedAt")
VALUES ('DIPL', CURRENT_TIMESTAMP), ('DLLC', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Invoicing banks and the company that invoices each one's payments.
INSERT INTO "InvoiceBank" ("paymentMode", "entityCode", "updatedAt")
VALUES ('Axis Bank', 'DIPL', CURRENT_TIMESTAMP),
       ('HDFC Bank', 'DIPL', CURRENT_TIMESTAMP),
       ('Wio Bank', 'DLLC', CURRENT_TIMESTAMP)
ON CONFLICT ("paymentMode") DO NOTHING;

-- Number series in the shape of DESMA's existing invoices: D/DIPL/26-27/0525,
-- E/DIPL/26-27/068, D/DLLC/26-27/023. Starting numbers are set in the app.
INSERT INTO "InvoiceSeries" ("key", "prefix", "fyStyle", "padding", "updatedAt")
VALUES ('DIPL-DOM', 'D/DIPL/', 'dash', 4, CURRENT_TIMESTAMP),
       ('DIPL-EXP', 'E/DIPL/', 'dash', 3, CURRENT_TIMESTAMP),
       ('DLLC-DOM', 'D/DLLC/', 'dash', 3, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Finance › Invoices for the finance roles (same pattern as Partner Commissions).
UPDATE "Role"
SET "pages" = array_append(COALESCE("pages", ARRAY[]::TEXT[]), '/finance/invoices')
WHERE "name" IN ('Finance Manager', 'Finance Executive')
  AND NOT ('/finance/invoices' = ANY(COALESCE("pages", ARRAY[]::TEXT[])));
