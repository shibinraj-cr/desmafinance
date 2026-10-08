-- CreateTable
CREATE TABLE "MktChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "ledgerSubItems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "leadSourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MktChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MktBudgetAllocation" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "fy" INTEGER NOT NULL,
    "monthIdx" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MktBudgetAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MktCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "channelId" TEXT,
    "ownerId" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "budget" INTEGER NOT NULL DEFAULT 0,
    "code" TEXT,
    "brief" TEXT,
    "audience" TEXT,
    "services" TEXT,
    "targetLeads" INTEGER,
    "targetEnrollments" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MktCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MktBudgetLine" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "vendor" TEXT,
    "planned" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MktBudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MktCommitment" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "lineId" TEXT,
    "amount" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'quote',
    "vendor" TEXT,
    "dueDate" DATE,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MktCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MktSpendTag" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "campaignId" TEXT,
    "lineId" TEXT,
    "taggedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MktSpendTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MktDeliverable" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "ownerId" TEXT,
    "dueDate" DATE,
    "doneAt" TIMESTAMP(3),
    "remindedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MktDeliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MktReallocation" (
    "id" TEXT NOT NULL,
    "fy" INTEGER NOT NULL,
    "fromChannelId" TEXT NOT NULL,
    "fromMonthIdx" INTEGER NOT NULL,
    "toChannelId" TEXT NOT NULL,
    "toMonthIdx" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MktReallocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MktCampaignEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MktCampaignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MktChannel_name_key" ON "MktChannel"("name");

-- CreateIndex
CREATE INDEX "MktChannel_active_sortOrder_idx" ON "MktChannel"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "MktBudgetAllocation_fy_idx" ON "MktBudgetAllocation"("fy");

-- CreateIndex
CREATE UNIQUE INDEX "MktBudgetAllocation_channelId_fy_monthIdx_key" ON "MktBudgetAllocation"("channelId", "fy", "monthIdx");

-- CreateIndex
CREATE UNIQUE INDEX "MktCampaign_code_key" ON "MktCampaign"("code");

-- CreateIndex
CREATE INDEX "MktCampaign_status_startDate_idx" ON "MktCampaign"("status", "startDate");

-- CreateIndex
CREATE INDEX "MktCampaign_channelId_idx" ON "MktCampaign"("channelId");

-- CreateIndex
CREATE INDEX "MktCampaign_startDate_endDate_idx" ON "MktCampaign"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "MktBudgetLine_campaignId_seq_idx" ON "MktBudgetLine"("campaignId", "seq");

-- CreateIndex
CREATE INDEX "MktCommitment_campaignId_status_idx" ON "MktCommitment"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MktSpendTag_transactionId_key" ON "MktSpendTag"("transactionId");

-- CreateIndex
CREATE INDEX "MktSpendTag_campaignId_idx" ON "MktSpendTag"("campaignId");

-- CreateIndex
CREATE INDEX "MktDeliverable_campaignId_seq_idx" ON "MktDeliverable"("campaignId", "seq");

-- CreateIndex
CREATE INDEX "MktDeliverable_doneAt_dueDate_idx" ON "MktDeliverable"("doneAt", "dueDate");

-- CreateIndex
CREATE INDEX "MktReallocation_fy_status_idx" ON "MktReallocation"("fy", "status");

-- CreateIndex
CREATE INDEX "MktCampaignEvent_campaignId_createdAt_idx" ON "MktCampaignEvent"("campaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "MktBudgetAllocation" ADD CONSTRAINT "MktBudgetAllocation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "MktChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MktCampaign" ADD CONSTRAINT "MktCampaign_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "MktChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MktCampaign" ADD CONSTRAINT "MktCampaign_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MktBudgetLine" ADD CONSTRAINT "MktBudgetLine_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MktCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MktCommitment" ADD CONSTRAINT "MktCommitment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MktCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MktCommitment" ADD CONSTRAINT "MktCommitment_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "MktBudgetLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MktSpendTag" ADD CONSTRAINT "MktSpendTag_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MktSpendTag" ADD CONSTRAINT "MktSpendTag_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MktCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MktSpendTag" ADD CONSTRAINT "MktSpendTag_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "MktBudgetLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MktDeliverable" ADD CONSTRAINT "MktDeliverable_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MktCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MktDeliverable" ADD CONSTRAINT "MktDeliverable_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MktReallocation" ADD CONSTRAINT "MktReallocation_fromChannelId_fkey" FOREIGN KEY ("fromChannelId") REFERENCES "MktChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MktReallocation" ADD CONSTRAINT "MktReallocation_toChannelId_fkey" FOREIGN KEY ("toChannelId") REFERENCES "MktChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MktCampaignEvent" ADD CONSTRAINT "MktCampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MktCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed the default spend channels. Ledger sub-items are the four that exist
-- under "Marketing" today; the other channels start unmapped until Finance adds
-- matching sub-items (Master Data › Categories) and an Admin maps them on the
-- planner's Channels page. Lead sources are matched by label so a renamed or
-- missing source simply leaves the channel unmapped rather than failing.
INSERT INTO "MktChannel" ("id", "name", "sortOrder", "ledgerSubItems", "leadSourceIds", "active", "createdAt", "updatedAt")
VALUES
  ('mktch_meta',       'Meta Ads',                     0, ARRAY['Digital Advertisement - Meta'],
     ARRAY(SELECT "id" FROM "LeadPulseSource" WHERE "label" ILIKE '%meta%' OR "label" ILIKE '%facebook%' OR "label" ILIKE '%instagram%'),
     true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mktch_google',     'Google Ads',                   1, ARRAY['Digital Advertisement - Google'],
     ARRAY(SELECT "id" FROM "LeadPulseSource" WHERE "label" ILIKE '%google%'),
     true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mktch_content',    'YouTube & content production', 2, ARRAY['Designs & Editing'],
     ARRAY(SELECT "id" FROM "LeadPulseSource" WHERE "label" ILIKE '%youtube%'),
     true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mktch_agency',     'Agency retainer',              3, ARRAY['Digital Marketing Management Fee'], ARRAY[]::TEXT[],
     true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mktch_events',     'Events & seminars',            4, ARRAY[]::TEXT[], ARRAY[]::TEXT[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mktch_print',      'Print & OOH',                  5, ARRAY[]::TEXT[], ARRAY[]::TEXT[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mktch_brand',      'Brand identity & collateral',  6, ARRAY[]::TEXT[], ARRAY[]::TEXT[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mktch_influencer', 'Influencers & creators',       7, ARRAY[]::TEXT[], ARRAY[]::TEXT[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
