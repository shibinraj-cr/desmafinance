-- Per-consultant Wabis routing.
--
-- Wabis's "assign conversation to a user" action is static per workflow, so one
-- callback URL can only ever route to one agent. Routing each candidate to the
-- consultant who owns them therefore needs one workflow per consultant, which
-- is what this table registers. A row with consultantId IS NULL and isDefault
-- is the fallback for consultants not explicitly mapped.
--
-- The agent name/phone overrides move here from the wabis_agent_overrides
-- AppSetting blob, so everything governing how one consultant's message routes
-- and reads lives in a single row.

-- CreateTable
CREATE TABLE "WabisWebhookEndpoint" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "consultantId" TEXT,
    "webhookUrl" TEXT NOT NULL,
    "agentName" TEXT,
    "agentPhone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WabisWebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WabisWebhookEndpoint_consultantId_idx" ON "WabisWebhookEndpoint"("consultantId");

-- CreateIndex
CREATE INDEX "WabisWebhookEndpoint_isActive_idx" ON "WabisWebhookEndpoint"("isActive");

-- AddForeignKey
ALTER TABLE "WabisWebhookEndpoint" ADD CONSTRAINT "WabisWebhookEndpoint_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity, enforced in the database rather than only in application code so a
-- concurrent double-submit can't produce two live routes. Both indexes are
-- PARTIAL because superseded rows are deactivated, not deleted: only the live
-- ones must be unique. Prisma cannot express partial indexes, so they are
-- declared here and documented on the model.
CREATE UNIQUE INDEX "WabisWebhookEndpoint_one_active_per_consultant"
    ON "WabisWebhookEndpoint"("consultantId")
    WHERE "isActive" AND "consultantId" IS NOT NULL;

-- Every row this index covers has isDefault = true, so uniqueness on that
-- column admits exactly one live default.
CREATE UNIQUE INDEX "WabisWebhookEndpoint_one_active_default"
    ON "WabisWebhookEndpoint"("isDefault")
    WHERE "isActive" AND "isDefault";

-- Delivery log records which endpoint was used, denormalised so the history
-- still reads correctly after an endpoint is renamed or removed.
ALTER TABLE "CrmWebhookDelivery" ADD COLUMN "endpointLabel" TEXT;

-- Carry the existing single-URL setup over, so the integration keeps working
-- across this deploy without anyone re-entering configuration.
--
-- Wrapped in an exception handler because it parses a user-editable settings
-- value: wabis_agent_overrides holds admin-entered JSON, and a malformed value
-- must not be able to fail a production deploy. If anything here raises, the
-- table is simply left empty and the admin re-enters the config in the new UI.
-- Step 1: the previously-configured URL becomes the default/fallback endpoint.
DO $$
DECLARE
    default_url TEXT;
BEGIN
    SELECT NULLIF(TRIM(value), '') INTO default_url
    FROM "AppSetting" WHERE key = 'wabis_webhook_url';

    IF default_url IS NULL THEN
        RETURN; -- nothing was configured; nothing to carry over
    END IF;

    INSERT INTO "WabisWebhookEndpoint" (
        "id", "label", "consultantId", "webhookUrl", "isActive", "isDefault", "createdAt", "updatedAt"
    ) VALUES (
        md5(random()::text || clock_timestamp()::text),
        'Default workflow (migrated)', NULL, default_url, true, true, now(), now()
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Wabis default endpoint not migrated: %', SQLERRM;
END $$;

-- Step 2: each consultant that had a name/phone override becomes their own
-- endpoint, pre-filled with the default URL. Behaviour is unchanged on day one,
-- and the admin only has to swap in that consultant's own workflow URL.
--
-- Deliberately a SEPARATE block from step 1: this one parses admin-entered JSON
-- (wabis_agent_overrides), and a malformed value must not roll back the default
-- endpoint alongside it.
DO $$
BEGIN
    INSERT INTO "WabisWebhookEndpoint" (
        "id", "label", "consultantId", "webhookUrl", "agentName", "agentPhone",
        "isActive", "isDefault", "createdAt", "updatedAt"
    )
    SELECT
        md5(random()::text || clock_timestamp()::text || kv.key),
        'Migrated override: ' || COALESCE(lpr."displayName", kv.key),
        kv.key,
        (SELECT "webhookUrl" FROM "WabisWebhookEndpoint" WHERE "isDefault" LIMIT 1),
        NULLIF(kv.value ->> 'agent', ''),
        NULLIF(kv.value ->> 'phone', ''),
        true, false, now(), now()
    FROM jsonb_each(
        (SELECT NULLIF(TRIM(value), '')::jsonb FROM "AppSetting" WHERE key = 'wabis_agent_overrides')
    ) AS kv
    JOIN "User" u ON u.id = kv.key
    LEFT JOIN "LeadPulseRole" lpr ON lpr."userId" = kv.key
    WHERE jsonb_typeof(kv.value) = 'object'
      AND EXISTS (SELECT 1 FROM "WabisWebhookEndpoint" WHERE "isDefault");
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Wabis agent overrides not migrated: %', SQLERRM;
END $$;
