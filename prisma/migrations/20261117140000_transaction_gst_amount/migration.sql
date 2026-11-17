-- Revenue is reported net of GST (src/lib/finance-gst.ts). `amount` stays the
-- money that moved; `gstAmount` is the GST inside it.
--
-- Additive with a default, so the running deployment is unaffected while
-- this applies.
ALTER TABLE "Transaction" ADD COLUMN "gstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Backfill with the rule Finance › Revenue already uses for its GST Liability
-- line: revenue into Axis or HDFC tagged DOM carries 18% GST inside the
-- amount. Revenue falls by exactly that figure; nothing else changes.
-- 18/118 never lands on a half paisa, so ROUND agrees with the app's rounding.
UPDATE "Transaction"
SET "gstAmount" = "amount" - ROUND("amount" / 1.18, 2)
WHERE "type" = 'Revenue'
  AND "expDom" = 'DOM'
  AND "paymentMode" IN ('Axis Bank', 'HDFC Bank')
  AND "amount" > 0;
