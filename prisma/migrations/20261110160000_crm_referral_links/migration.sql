-- Candidate referral links (src/lib/crm-referral.ts). Purely additive: three new
-- tables, one nullable column on Lead and one lead source, so the live
-- deployment keeps serving while this applies.
--
-- CrmReferralLink is a lead's shareable /r/<code> link; CrmReferralSubmission
-- logs every form sent through one (new lead, already in the CRM, own number);
-- CrmReferralVisitDay counts page opens per IST day. Lead.referredByLeadId files
-- a new lead under the candidate whose link brought it in.

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "referredByLeadId" TEXT;

-- CreateTable
CREATE TABLE "CrmReferralLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referrerLeadId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmReferralLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmReferralSubmission" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "leadId" TEXT,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmReferralSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmReferralVisitDay" (
    "linkId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CrmReferralVisitDay_pkey" PRIMARY KEY ("linkId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmReferralLink_code_key" ON "CrmReferralLink"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CrmReferralLink_referrerLeadId_key" ON "CrmReferralLink"("referrerLeadId");

-- CreateIndex
CREATE INDEX "CrmReferralSubmission_linkId_createdAt_idx" ON "CrmReferralSubmission"("linkId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmReferralSubmission_leadId_idx" ON "CrmReferralSubmission"("leadId");

-- CreateIndex
CREATE INDEX "Lead_referredByLeadId_idx" ON "Lead"("referredByLeadId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_referredByLeadId_fkey" FOREIGN KEY ("referredByLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmReferralLink" ADD CONSTRAINT "CrmReferralLink_referrerLeadId_fkey" FOREIGN KEY ("referrerLeadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmReferralLink" ADD CONSTRAINT "CrmReferralLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmReferralSubmission" ADD CONSTRAINT "CrmReferralSubmission_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "CrmReferralLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmReferralSubmission" ADD CONSTRAINT "CrmReferralSubmission_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmReferralVisitDay" ADD CONSTRAINT "CrmReferralVisitDay_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "CrmReferralLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The "Referral Link" source every lead from the form is stamped with. Kept
-- apart from "Candidate Referral" (a referral a person types in) so the two
-- channels read separately in every source report. Skipped when an admin has
-- already made a source by that name; the code then finds it by label.
INSERT INTO "LeadPulseSource" ("id", "code", "label", "displayOrder", "active", "createdAt", "updatedAt")
SELECT 'lpsrc_referral_link_seed', 'referral_link', 'Referral Link', 7, true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "LeadPulseSource" WHERE "code" = 'referral_link' OR lower("label") = 'referral link'
);
