-- Lead quality: the consultant's verdict on the enquiry itself (Good / Average /
-- Poor / Junk), mandatory five days after a lead enters the system.

-- AlterTable: the rating and who gave it.
ALTER TABLE "Lead" ADD COLUMN     "qualityNote" TEXT,
ADD COLUMN     "qualityRatedAt" TIMESTAMP(3),
ADD COLUMN     "qualityRatedById" TEXT,
ADD COLUMN     "qualityRating" TEXT,
ADD COLUMN     "qualityReasonId" TEXT;

-- AlterTable: when rating becomes mandatory. Added WITHOUT a default first and
-- the default set in a second statement, on purpose: Postgres evaluates a
-- non-volatile default given in ADD COLUMN once and writes it into every
-- EXISTING row, which would make the whole backlog due five days after this
-- deploy. This way existing leads stay NULL (never mandatory) and only rows
-- inserted from now on get "inserted + 5 days".
ALTER TABLE "Lead" ADD COLUMN     "qualityDueAt" TIMESTAMP(3);
ALTER TABLE "Lead" ALTER COLUMN "qualityDueAt" SET DEFAULT (CURRENT_TIMESTAMP + '5 days'::interval);

-- CreateTable
CREATE TABLE "CrmLeadQualityReason" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLeadQualityReason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmLeadQualityReason_label_key" ON "CrmLeadQualityReason"("label");

-- CreateIndex
CREATE INDEX "CrmLeadQualityReason_active_idx" ON "CrmLeadQualityReason"("active");

-- CreateIndex
CREATE INDEX "CrmLeadQualityReason_displayOrder_idx" ON "CrmLeadQualityReason"("displayOrder");

-- CreateIndex
CREATE INDEX "Lead_qualityRating_idx" ON "Lead"("qualityRating");

-- CreateIndex
CREATE INDEX "Lead_qualityReasonId_idx" ON "Lead"("qualityReasonId");

-- CreateIndex
CREATE INDEX "Lead_qualityDueAt_qualityRating_idx" ON "Lead"("qualityDueAt", "qualityRating");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_qualityReasonId_fkey" FOREIGN KEY ("qualityReasonId") REFERENCES "CrmLeadQualityReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_qualityRatedById_fkey" FOREIGN KEY ("qualityRatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the starting reasons so the Poor / Junk pickers work the moment this
-- deploys. Admins edit the list at CRM Settings → Lead Quality.
INSERT INTO "CrmLeadQualityReason" ("id", "label", "displayOrder", "active", "createdAt", "updatedAt") VALUES
  ('crmlqr_wrong_number',   'Wrong / invalid number',           10, true, NOW(), NOW()),
  ('crmlqr_unreachable',    'Never reachable',                  20, true, NOW(), NOW()),
  ('crmlqr_fake',           'Fake / spam / test entry',         30, true, NOW(), NOW()),
  ('crmlqr_never_enquired', 'Says they never enquired',         40, true, NOW(), NOW()),
  ('crmlqr_not_eligible',   'Not eligible',                     50, true, NOW(), NOW()),
  ('crmlqr_wrong_service',  'Not a service we offer',           60, true, NOW(), NOW()),
  ('crmlqr_outside_target', 'Outside our target location',      70, true, NOW(), NOW()),
  ('crmlqr_no_intent',      'No real intent, just browsing',    80, true, NOW(), NOW()),
  ('crmlqr_existing',       'Already a DESMA candidate',        90, true, NOW(), NOW())
ON CONFLICT ("label") DO NOTHING;
