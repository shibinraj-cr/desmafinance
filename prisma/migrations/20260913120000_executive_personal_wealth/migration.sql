-- Personal Wealth (Executive) — the owner's own investments, gold, borrowings
-- and renewal dates. Deliberately separate from company Finance: nothing here
-- reads or writes revenue, payroll or any reporting table.
--
-- Purely additive: seven new tables, no ALTER on anything that already exists,
-- so applying it on production cannot disturb live data.
--
-- Every table carries ownerUserId and every query filters on the signed-in
-- user, which makes the page multi-tenant by construction — a second admin
-- opening /executive/wealth gets their own empty desk, not this one's.
--
-- WealthHolding.portalSecretEnc holds AES-256-GCM ciphertext (lib/wealth-crypto)
-- and is never selected by a list query; WealthSecretReveal records every read.

-- CreateTable
CREATE TABLE "WealthHolding" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL DEFAULT 'other',
    "scope" TEXT NOT NULL DEFAULT 'personal',
    "holderLabel" TEXT NOT NULL DEFAULT 'Self',
    "institution" TEXT,
    "policyNo" TEXT,
    "investedAmount" DECIMAL(14,2),
    "contributionAmount" DECIMAL(14,2),
    "frequency" TEXT NOT NULL DEFAULT 'none',
    "dueDayOfMonth" INTEGER,
    "renewalOn" DATE,
    "termYears" INTEGER,
    "sumAssured" DECIMAL(14,2),
    "reminderLeadDays" INTEGER NOT NULL DEFAULT 7,
    "portalUrl" TEXT,
    "portalUsername" TEXT,
    "portalSecretEnc" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WealthHolding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WealthValuation" (
    "id" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "asOn" DATE NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WealthValuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WealthLiability" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "scope" TEXT NOT NULL DEFAULT 'personal',
    "lender" TEXT,
    "principal" DECIMAL(14,2),
    "outstanding" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "interestRate" DECIMAL(6,3),
    "emiAmount" DECIMAL(14,2),
    "emiDayOfMonth" INTEGER,
    "startedOn" DATE,
    "tenureMonths" INTEGER,
    "notes" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WealthLiability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WealthGoldItem" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grams" DECIMAL(10,3) NOT NULL,
    "holderLabel" TEXT NOT NULL DEFAULT 'Self',
    "purityKarat" INTEGER,
    "notes" TEXT,
    "dueOn" DATE,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WealthGoldItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WealthReminder" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "holdingId" TEXT,
    "liabilityId" TEXT,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "dueOn" DATE NOT NULL,
    "amount" DECIMAL(14,2),
    "status" TEXT NOT NULL DEFAULT 'open',
    "paidOn" DATE,
    "paidAmount" DECIMAL(14,2),
    "notifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WealthReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WealthSetting" (
    "ownerUserId" TEXT NOT NULL,
    "goldRatePerGram" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "goldRateAsOn" DATE,
    "hideBusinessScope" BOOLEAN NOT NULL DEFAULT false,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WealthSetting_pkey" PRIMARY KEY ("ownerUserId")
);

-- CreateTable
CREATE TABLE "WealthSecretReveal" (
    "id" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WealthSecretReveal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WealthHolding_ownerUserId_archivedAt_idx" ON "WealthHolding"("ownerUserId", "archivedAt");

-- CreateIndex
CREATE INDEX "WealthHolding_ownerUserId_assetClass_idx" ON "WealthHolding"("ownerUserId", "assetClass");

-- CreateIndex
CREATE INDEX "WealthValuation_holdingId_asOn_idx" ON "WealthValuation"("holdingId", "asOn");

-- CreateIndex
CREATE UNIQUE INDEX "WealthValuation_holdingId_asOn_key" ON "WealthValuation"("holdingId", "asOn");

-- CreateIndex
CREATE INDEX "WealthLiability_ownerUserId_closedAt_idx" ON "WealthLiability"("ownerUserId", "closedAt");

-- CreateIndex
CREATE INDEX "WealthGoldItem_ownerUserId_archivedAt_idx" ON "WealthGoldItem"("ownerUserId", "archivedAt");

-- CreateIndex
CREATE INDEX "WealthReminder_ownerUserId_status_dueOn_idx" ON "WealthReminder"("ownerUserId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "WealthReminder_ownerUserId_dueOn_idx" ON "WealthReminder"("ownerUserId", "dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "WealthReminder_holdingId_dueOn_kind_key" ON "WealthReminder"("holdingId", "dueOn", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "WealthReminder_liabilityId_dueOn_kind_key" ON "WealthReminder"("liabilityId", "dueOn", "kind");

-- CreateIndex
CREATE INDEX "WealthSecretReveal_holdingId_createdAt_idx" ON "WealthSecretReveal"("holdingId", "createdAt");

-- CreateIndex
CREATE INDEX "WealthSecretReveal_actorUserId_createdAt_idx" ON "WealthSecretReveal"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "WealthHolding" ADD CONSTRAINT "WealthHolding_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WealthValuation" ADD CONSTRAINT "WealthValuation_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "WealthHolding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WealthLiability" ADD CONSTRAINT "WealthLiability_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WealthGoldItem" ADD CONSTRAINT "WealthGoldItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WealthReminder" ADD CONSTRAINT "WealthReminder_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WealthReminder" ADD CONSTRAINT "WealthReminder_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "WealthHolding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WealthReminder" ADD CONSTRAINT "WealthReminder_liabilityId_fkey" FOREIGN KEY ("liabilityId") REFERENCES "WealthLiability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WealthSetting" ADD CONSTRAINT "WealthSetting_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WealthSecretReveal" ADD CONSTRAINT "WealthSecretReveal_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "WealthHolding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WealthSecretReveal" ADD CONSTRAINT "WealthSecretReveal_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

