-- Send policy: a per-phone ledger of automated WhatsApp sends, and a hold-back
-- time on broadcast recipients. Additive; the old build ignores both.
CREATE TABLE "WaContactLog" (
    "id" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "leadId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaContactLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WaContactLog_phoneE164_sentAt_idx" ON "WaContactLog"("phoneE164", "sentAt");

ALTER TABLE "WaBroadcastRecipient" ADD COLUMN "notBefore" TIMESTAMP(3);
