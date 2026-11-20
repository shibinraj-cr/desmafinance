-- Partner Commissions: volume bonus. A partner can pay more commission once
-- enough enrollments are billed in an Australian financial year (July–June),
-- e.g. +5% from the 51st and +10% from the 101st. Additive only: two JSON
-- columns with defaults on the partner (tiers, and the count billed outside
-- DesGro per year) and three nullable columns on the invoice line recording
-- what was applied. The tiers themselves are set on the Settings tab.
-- AlterTable
ALTER TABLE "CommissionPartner" ADD COLUMN     "volumeOpening" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "volumeTiers" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "CommissionInvoiceLine" ADD COLUMN     "volumeBonusPct" DECIMAL(5,2),
ADD COLUMN     "volumeFy" TEXT,
ADD COLUMN     "volumeSeq" INTEGER;
