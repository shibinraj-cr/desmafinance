-- The first due date a task was given, kept for "completed on time".
-- Additive: a nullable column plus a trigger; safe while the old build serves.
ALTER TABLE "CrmTask" ADD COLUMN "originalDueAt" TIMESTAMP(3);

-- Existing tasks: the original is unknown, the current due date is the best
-- available answer.
UPDATE "CrmTask" SET "originalDueAt" = "dueAt" WHERE "originalDueAt" IS NULL AND "dueAt" IS NOT NULL;

-- Every path that creates or reschedules a task (the task routes, complete-and-
-- book-next, re-inquiry, reminders) gets this for free: the first non-null
-- due date is captured once and never overwritten.
CREATE FUNCTION crm_task_original_due() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."originalDueAt" IS NULL AND NEW."dueAt" IS NOT NULL THEN
    NEW."originalDueAt" := NEW."dueAt";
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."originalDueAt" IS NOT NULL THEN
    NEW."originalDueAt" := OLD."originalDueAt";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "CrmTask_original_due"
  BEFORE INSERT OR UPDATE ON "CrmTask"
  FOR EACH ROW EXECUTE FUNCTION crm_task_original_due();
