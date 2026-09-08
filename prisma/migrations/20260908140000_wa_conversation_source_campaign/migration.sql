-- WaConversation: the broadcast campaign a thread most recently replied to,
-- stamped on reply. Powers the inbox "broadcast replies" / per-campaign filter
-- and the row label. Null for threads that never replied to a broadcast.
ALTER TABLE "WaConversation" ADD COLUMN "sourceCampaign" TEXT;
ALTER TABLE "WaConversation" ADD COLUMN "sourceCampaignAt" TIMESTAMP(3);

CREATE INDEX "WaConversation_sourceCampaign_idx" ON "WaConversation"("sourceCampaign");
