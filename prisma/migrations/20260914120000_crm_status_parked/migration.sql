-- Per-status "parked" flag: a deliberate resting stage (Centralised Marketing /
-- Re-marketing) whose leads are nurtured centrally on their own cadence rather
-- than worked day-to-day by a BDE.
--
-- A parked stage never nags on the Team Activity attention list (no SLA breach,
-- stuck, abandoned or no-next-step bucket) and never forces a follow-up task
-- when a BDE completes the lead's last open task. This replaces the hard-coded
-- PARKED_STATUS_CODES = {'re_marketing'} list with admin-editable data, so the
-- next parked stage is a checkbox in /crm/settings, not a deploy.
ALTER TABLE "CrmLeadStatus" ADD COLUMN "parked" BOOLEAN NOT NULL DEFAULT false;

-- Preserve today's behaviour exactly: re_marketing was parked in code.
UPDATE "CrmLeadStatus" SET "parked" = true WHERE "code" = 're_marketing';

-- Centralised Marketing: the new parked stage this migration exists for. Created
-- only if the CRM has no stage like it already (whatever code an admin gave it),
-- so re-running or deploying over a hand-made stage can never leave two.
INSERT INTO "CrmLeadStatus" ("id", "code", "label", "kind", "displayOrder", "color", "isDefault", "parked", "active", "createdAt", "updatedAt")
SELECT 'cstat_centralised_marketing', 'centralised_marketing', 'Centralised Marketing', 'active', 4, '#0ea5e9', false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "CrmLeadStatus"
  WHERE "code" IN ('centralised_marketing', 'centralized_marketing', 'central_marketing')
     OR lower("label") LIKE '%central%market%'
);

-- …and if an admin already made that stage by hand, park it rather than
-- duplicating it.
UPDATE "CrmLeadStatus"
SET "parked" = true
WHERE "code" IN ('centralised_marketing', 'centralized_marketing', 'central_marketing')
   OR lower("label") LIKE '%central%market%';
