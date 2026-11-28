-- "Bot replied": nobody answered the candidate, but an automated message went
-- out after their last one. Split out of "Needs reply" (awaitingReply).
ALTER TABLE "WaConversation" ADD COLUMN "autoReplied" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "WaConversation_autoReplied_lastMessageAt_idx" ON "WaConversation"("autoReplied", "lastMessageAt");

-- Backfill. Only automated sends move `lastMessageAt` without clearing
-- `awaitingReply` (a person's send clears it), so a waiting thread whose newest
-- message is newer than the candidate's newest is exactly a thread where only a
-- bot spoke after them.
UPDATE "WaConversation"
SET "autoReplied" = true, "awaitingReply" = false
WHERE "awaitingReply" = true
  AND "lastInboundAt" IS NOT NULL
  AND "lastMessageAt" > "lastInboundAt";
