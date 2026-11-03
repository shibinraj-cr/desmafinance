-- Per-status "pacedByTask" flag: a waiting stage (Long Followup — the candidate
-- is awaiting a certificate or exam result) whose leads are contacted on the
-- date the consultant set, not on a fixed stage clock.
--
-- In a task-paced stage a lead with an open task due today or later — however
-- far out — is on track: no SLA breach, stuck or abandoned flag. Once that due
-- date passes the lead is Stuck, and Abandoned 30 days after it. A lead with no
-- task is judged as before (no-next-step, stuck after 14 days in stage).
ALTER TABLE "CrmLeadStatus" ADD COLUMN "pacedByTask" BOOLEAN NOT NULL DEFAULT false;

-- Long Followup is the stage this exists for. It was made by hand in
-- /crm/settings, so match it by its label or the obvious codes. Parked stages
-- are skipped: parked already clears every flag.
UPDATE "CrmLeadStatus"
SET "pacedByTask" = true
WHERE "parked" = false
  AND (
    "code" IN ('long_followup', 'long_follow_up', 'long_fu')
    OR lower("label") LIKE '%long%follow%'
  );
