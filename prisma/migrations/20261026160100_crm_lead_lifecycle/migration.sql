-- Lead lifecycle clock: when the lead entered its current stage, plus the
-- Marketing Admin's Follow-Up extension. Additive and backward-compatible: two
-- nullable columns, an index, and a trigger the old build never notices.
ALTER TABLE "Lead" ADD COLUMN "stageEnteredAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "followUpExtendedUntil" TIMESTAMP(3);

-- Backfill from history: the later of the last stage change and the last
-- re-inquiry revival (revival moves a lead into Re-marketing without writing
-- STATUS_CHANGED), else creation. One aggregate pass, then one update.
WITH entered AS (
  SELECT a."leadId", MAX(a."occurredAt") AS at
  FROM "LeadActivity" a
  WHERE a."type" = 'STATUS_CHANGED'
     OR (a."type" = 'RE_INQUIRY' AND a."metadata"->>'revived' = 'true')
  GROUP BY a."leadId"
)
UPDATE "Lead" l
SET "stageEnteredAt" = GREATEST(l."createdAt", e.at)
FROM entered e
WHERE e."leadId" = l."id";

UPDATE "Lead" SET "stageEnteredAt" = "createdAt" WHERE "stageEnteredAt" IS NULL;

CREATE INDEX "Lead_statusId_stageEnteredAt_idx" ON "Lead"("statusId", "stageEnteredAt");

-- Every write that changes the stage restarts the clock and drops any
-- Follow-Up extension, whichever code path made it.
CREATE FUNCTION lead_stage_entered() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."stageEnteredAt" := COALESCE(NEW."stageEnteredAt", NEW."createdAt", now() AT TIME ZONE 'UTC');
  ELSIF NEW."statusId" IS DISTINCT FROM OLD."statusId" THEN
    NEW."stageEnteredAt" := now() AT TIME ZONE 'UTC';
    NEW."followUpExtendedUntil" := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Lead_stage_entered"
  BEFORE INSERT OR UPDATE OF "statusId" ON "Lead"
  FOR EACH ROW EXECUTE FUNCTION lead_stage_entered();
