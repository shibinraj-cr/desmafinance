-- Referral rewards (src/lib/crm-referral-reward.ts). Additive only: one new
-- table, plus master rows and a page grant that are skipped when present.
--
-- A reward is raised when a referred lead enrols, and Finance marks it paid,
-- which raises an Expense draft booked to Commissions › Commissions.

-- CreateTable
CREATE TABLE "CrmReferralReward" (
    "id" TEXT NOT NULL,
    "referredLeadId" TEXT,
    "referrerLeadId" TEXT,
    "referredName" TEXT NOT NULL,
    "referrerName" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'due',
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidOn" DATE,
    "paymentMode" TEXT,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "draftId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "unenrolledAfterPaidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmReferralReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmReferralReward_referredLeadId_key" ON "CrmReferralReward"("referredLeadId");

-- CreateIndex
CREATE INDEX "CrmReferralReward_status_dueAt_idx" ON "CrmReferralReward"("status", "dueAt");

-- CreateIndex
CREATE INDEX "CrmReferralReward_referrerLeadId_idx" ON "CrmReferralReward"("referrerLeadId");

-- AddForeignKey
ALTER TABLE "CrmReferralReward" ADD CONSTRAINT "CrmReferralReward_referredLeadId_fkey" FOREIGN KEY ("referredLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmReferralReward" ADD CONSTRAINT "CrmReferralReward_referrerLeadId_fkey" FOREIGN KEY ("referrerLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmReferralReward" ADD CONSTRAINT "CrmReferralReward_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The ledger line a paid reward is drafted to: Expense › Commissions ›
-- Commissions. It is in the catalog, but the transaction form and the draft
-- checks read the Category master, so make sure the rows exist. Idempotent.
INSERT INTO "Category" ("id", "name", "type", "isActive", "isSystem", "createdAt", "updatedAt")
SELECT 'rr_cat_commissions_exp', 'Commissions', 'Expense', true, false, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Category" WHERE "name" = 'Commissions' AND "type" IN ('Expense', 'Both')
);

INSERT INTO "SubCategory" ("id", "categoryId", "name", "isActive", "isSystem", "createdAt", "updatedAt")
SELECT 'rr_sub_commissions_' || substr(md5(c."id"), 1, 10), c."id", 'Commissions', true, false, NOW(), NOW()
FROM "Category" c
WHERE c."name" = 'Commissions' AND c."type" IN ('Expense', 'Both')
ON CONFLICT ("categoryId", "name") DO NOTHING;

-- Finance Manager and Finance Executive get the new page (admins see every page).
UPDATE "Role"
SET "pages" = array_append(COALESCE("pages", ARRAY[]::TEXT[]), '/finance/referral-rewards')
WHERE "name" IN ('Finance Manager', 'Finance Executive')
  AND NOT ('/finance/referral-rewards' = ANY(COALESCE("pages", ARRAY[]::TEXT[])));
