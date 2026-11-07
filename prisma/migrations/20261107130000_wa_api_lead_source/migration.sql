-- Leads the WhatsApp Business API creates — a number we have never seen
-- messaging us — are attributed to the "Wabis" source, renamed "WA API".
-- Before this they looked up a "WhatsApp Inbound" source that only the seed
-- script made, so where it was never seeded they got no source at all.

-- 1. Rename the source.
UPDATE "LeadPulseSource"
SET "label" = 'WA API', "updatedAt" = NOW()
WHERE "code" = 'wabis' OR lower("label") = 'wabis';

-- 2. Create it where missing. Guarded on code AND label: if an admin already
-- made it in Master Data, that row is used instead of a second one — see
-- resolveWaInboundSourceId.
INSERT INTO "LeadPulseSource" ("id", "code", "label", "displayOrder", "active", "createdAt", "updatedAt")
SELECT 'lpsrc_wa_api_seed', 'wabis', 'WA API', 2, true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "LeadPulseSource" WHERE "code" = 'wabis' OR lower("label") IN ('wabis', 'wa api')
);

-- 3. Leads the WhatsApp mirror already created (externalKey 'wa:<phone>') move
-- to WA API when they have no source, or the "WhatsApp Inbound" one this
-- replaces. A source a person picked by hand is left alone, and so are
-- enrollment (LeadPulsePipeline) rows.
UPDATE "Lead" l
SET "sourceId" = w."id", "updatedAt" = NOW()
FROM (
  SELECT "id" FROM "LeadPulseSource"
  WHERE "code" = 'wabis' OR lower("label") = 'wa api'
  ORDER BY ("code" = 'wabis') DESC, "createdAt"
  LIMIT 1
) w
WHERE l."externalKey" LIKE 'wa:%'
  AND (
    l."sourceId" IS NULL
    OR l."sourceId" IN (SELECT "id" FROM "LeadPulseSource" WHERE "code" = 'whatsapp_inbound')
  );
