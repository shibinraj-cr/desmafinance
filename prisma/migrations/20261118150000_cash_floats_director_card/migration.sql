-- CreateTable
CREATE TABLE "CashWithdrawal" (
    "id" TEXT NOT NULL,
    "bankTransactionId" TEXT,
    "kind" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "heldBy" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutdoorMarketingVoucher" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "voucherNo" TEXT,
    "paidTo" TEXT NOT NULL,
    "purpose" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutdoorMarketingVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectorClaimSettlement" (
    "id" TEXT NOT NULL,
    "bankTransactionId" TEXT,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectorClaimSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashWithdrawal_bankTransactionId_key" ON "CashWithdrawal"("bankTransactionId");

-- CreateIndex
CREATE INDEX "CashWithdrawal_kind_date_idx" ON "CashWithdrawal"("kind", "date");

-- CreateIndex
CREATE UNIQUE INDEX "OutdoorMarketingVoucher_rowHash_key" ON "OutdoorMarketingVoucher"("rowHash");

-- CreateIndex
CREATE INDEX "OutdoorMarketingVoucher_date_idx" ON "OutdoorMarketingVoucher"("date");

-- CreateIndex
CREATE INDEX "OutdoorMarketingVoucher_batchId_idx" ON "OutdoorMarketingVoucher"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectorClaimSettlement_bankTransactionId_key" ON "DirectorClaimSettlement"("bankTransactionId");

-- CreateIndex
CREATE INDEX "DirectorClaimSettlement_date_idx" ON "DirectorClaimSettlement"("date");

-- AddForeignKey
ALTER TABLE "CashWithdrawal" ADD CONSTRAINT "CashWithdrawal_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectorClaimSettlement" ADD CONSTRAINT "DirectorClaimSettlement_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Page grants: Cash Floats to the Finance roles, Director's Card to the Finance Manager.
UPDATE "Role" SET pages = array_append(pages, '/finance/cash-floats')
WHERE name IN ('Finance Manager', 'Finance Executive') AND NOT ('/finance/cash-floats' = ANY(pages));
UPDATE "Role" SET pages = array_append(pages, '/finance/director-card')
WHERE name = 'Finance Manager' AND NOT ('/finance/director-card' = ANY(pages));
