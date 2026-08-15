-- WaConversation.awaitingReply — "nobody has answered this candidate yet".
--
-- The /crm/inbox needs-reply filter. Denormalised rather than derived, because
-- Prisma cannot compare lastInboundAt to lastMessageAt inside a `where`, and
-- post-filtering a fetched page would silently break pagination (a page of 50
-- would arrive holding however many rows survived the filter).
ALTER TABLE "WaConversation" ADD COLUMN "awaitingReply" BOOLEAN NOT NULL DEFAULT false;

-- Backfill from the rule the column stores: every outbound send bumps
-- lastMessageAt and leaves lastInboundAt alone, so the two being equal means the
-- newest message on the thread was inbound. A thread with inbound activity and
-- no lastMessageAt at all also counts.
UPDATE "WaConversation"
SET "awaitingReply" = true
WHERE "lastInboundAt" IS NOT NULL
  AND ("lastMessageAt" IS NULL OR "lastInboundAt" >= "lastMessageAt");

-- The inbox's default landing query: unanswered threads, newest first.
CREATE INDEX "WaConversation_awaitingReply_lastMessageAt_idx" ON "WaConversation"("awaitingReply", "lastMessageAt");
