-- AlterTable: free-text detail for the catch-all "Others" qualification. Held
-- on the lead rather than as a new master row per answer, because the whole
-- point of "Others" is that the value is a one-off outside the reference list.
-- Only ever set while the lead's qualification IS "Others" (enforced in the
-- API, which clears it on any move off that row), so it can never sit behind a
-- qualification that contradicts it.
ALTER TABLE "Lead" ADD COLUMN "qualificationOther" TEXT;

-- Seed the "Others" row itself so the field has something to hang off the
-- moment this deploys. Guarded: if the CRM already has an "Other"/"Others"
-- qualification (the db:seed-crm list carries one), this is a no-op rather
-- than a second, near-identical master row. `displayOrder` 999 keeps it last
-- in every dropdown, which is where a catch-all belongs.
INSERT INTO "CrmQualification" ("id", "label", "displayOrder", "active", "createdAt", "updatedAt")
SELECT 'crmqual_others_seed', 'Others', 999, true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "CrmQualification" WHERE lower("label") IN ('other', 'others')
);
