-- WaBroadcastRecipient: the moment Meta confirmed the message reached the handset
-- (delivered), distinct from sentAt ("accepted by Meta"). Set forward-only by the
-- delivery-status webhook. Null when no callback arrived / read receipts are off.
ALTER TABLE "WaBroadcastRecipient" ADD COLUMN "deliveredAt" TIMESTAMP(3);
