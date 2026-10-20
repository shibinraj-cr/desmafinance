-- Partner Commissions: "Next invoice number". Invoices raised outside DesGro
-- share the D/DLLC series, so DesGro must never suggest a number below the next
-- free one within that financial year. Additive: one nullable column.
ALTER TABLE "CommissionSettings" ADD COLUMN "nextNumber" TEXT;

-- D/DLLC/26-27/001–024 were raised before DesGro, so the next is 025. Creates
-- the settings row if nobody has opened the page yet; never overwrites a value
-- Finance has already set.
INSERT INTO "CommissionSettings" ("id", "nextNumber", "updatedAt")
VALUES ('default', 'D/DLLC/26-27/025', NOW())
ON CONFLICT ("id") DO UPDATE SET "nextNumber" = EXCLUDED."nextNumber"
WHERE "CommissionSettings"."nextNumber" IS NULL;
