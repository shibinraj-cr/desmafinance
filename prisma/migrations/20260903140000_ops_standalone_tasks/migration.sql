-- OpsActionItem: let an ad-hoc task stand alone. Until now every task had to
-- hang off a candidate project (and, in practice, a step); an ops user creating
-- a to-do from /operations/my-tasks may now leave the project blank — a purely
-- personal, scheduled task. Widening only: every existing row keeps its project.
ALTER TABLE "OpsActionItem" ALTER COLUMN "projectId" DROP NOT NULL;

-- Backs the standalone folder query: an ops user's own open tasks, soonest due
-- first. `projectId` alone can no longer serve it now that it is nullable.
CREATE INDEX "OpsActionItem_createdById_status_dueAt_idx" ON "OpsActionItem"("createdById", "status", "dueAt");
