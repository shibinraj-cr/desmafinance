-- Extend the re-marketing drip from 3 to 4 touch-points (default schedule now
-- days 5 / 19 / 33 / 45). Additive: one nullable timestamp column, no data
-- change. See src/lib/crm-remarketing.ts (TOTAL_TOUCHES = 4).
ALTER TABLE "CrmRemarketingCampaign" ADD COLUMN "touch4SentAt" TIMESTAMP(3);
