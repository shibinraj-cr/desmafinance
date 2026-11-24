-- The Finance Executive checks an enrollment and submits it; the Finance
-- Manager approves it from Approvals › Revenue. Additive only.
ALTER TABLE "CrmEnrollment" ADD COLUMN     "checkedAt" TIMESTAMP(3),
ADD COLUMN     "checkedById" TEXT,
ADD COLUMN     "returnNote" TEXT;

ALTER TABLE "CrmEnrollment" ADD CONSTRAINT "CrmEnrollment_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
