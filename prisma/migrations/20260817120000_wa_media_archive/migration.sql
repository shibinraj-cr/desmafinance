-- Our own copy of a WhatsApp attachment.
--
-- Every media reference we hold today is BORROWED. A Cloud API `mediaId` stops
-- resolving seven days after Meta delivers the message, and an imported row's
-- `mediaUrl` points at Wabis's storage, which is theirs and not ours. Both
-- clocks are already running: the seven-day one is losing voice notes now, and
-- the Wabis one empties the day that subscription ends.
--
-- `mediaStoredAt` is what the sweep selects on — a message holding a media
-- reference with no stored copy is work still to do — so it is indexed rather
-- than scanned across every message ever received.
ALTER TABLE "WaMessage" ADD COLUMN "mediaStoredUrl" TEXT;
ALTER TABLE "WaMessage" ADD COLUMN "mediaStoredAt" TIMESTAMP(3);

CREATE INDEX "WaMessage_mediaStoredAt_idx" ON "WaMessage"("mediaStoredAt");
