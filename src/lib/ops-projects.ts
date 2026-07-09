import type { Prisma, PrismaClient } from "@prisma/client";
import { addBusinessDays, opsToday, opsDateKey, opsDateToPrisma } from "./ops-dates";

/**
 * Project-instance logic for the Operations module: snapshot a service's
 * process template into a per-candidate project + tasks at enroll time. The
 * snapshot (seq/name/phase/isRequired/slaDays) freezes the step definition
 * against later template edits — the precondition for trustworthy performance
 * analytics. See the CRM-enroll hook in `crm-enroll.ts`.
 *
 * Due dates use a ROLLING TURNAROUND model: `slaDays` on each step is the
 * per-step turnaround (working days), and a step's `dueAt` is measured from
 * where the *previous* step actually landed — not from a fixed offset at
 * enrolment. At creation the chain is projected forward from the start day;
 * every time a step is completed/skipped the open tail is recomputed
 * (`recomputeSchedule`) from the real completion date, so an external wait that
 * resolves early (or late) pulls the whole downstream plan with it.
 */

export type SnapshotStep = {
  id: string;
  seq: number;
  name: string;
  description: string | null;
  phase: string | null;
  isRequired: boolean;
  slaDays: number | null;
};

export type SnapshotTaskData = {
  templateStepId: string;
  seq: number;
  name: string;
  description: string | null;
  phase: string | null;
  isRequired: boolean;
  slaDays: number | null;
  dueAt: Date | null;
};

/**
 * Roll per-step turnarounds forward into due-date keys. Walk `steps` in the
 * given order from `anchorKey` (a YYYY-MM-DD IST date): each step advances the
 * running anchor by its `slaDays` working days and takes the advanced date as
 * its due date; the next step chains from there. A step with `slaDays == null`
 * gets no due date and does not advance the anchor. Pure — the caller supplies
 * the holiday set and pre-sorts by seq. This is the model's core: a deadline is
 * measured from where the previous step landed, so a wait that resolves early
 * pulls the whole tail in.
 */
export function rollForwardDueDates(
  anchorKey: string,
  steps: { slaDays: number | null }[],
  holidays: ReadonlySet<string>,
): (string | null)[] {
  let anchor = anchorKey;
  return steps.map((s) => {
    if (s.slaDays == null) return null;
    anchor = addBusinessDays(anchor, s.slaDays, holidays);
    return anchor;
  });
}

/**
 * Build the task rows for a new project by snapshotting the template's steps.
 * Pure (given the holiday set): each task copies the step's fields and gets a
 * `dueAt` from the rolling chain projected forward from `startKey` (null when
 * the step has no SLA). These are provisional — recomputed against reality as
 * steps complete (see `recomputeSchedule`).
 */
export function buildSnapshotTasks(
  steps: SnapshotStep[],
  startKey: string,
  holidays: ReadonlySet<string>,
): SnapshotTaskData[] {
  const ordered = [...steps].sort((a, b) => a.seq - b.seq);
  const dueKeys = rollForwardDueDates(startKey, ordered, holidays);
  return ordered.map((s, i) => ({
    templateStepId: s.id,
    seq: s.seq,
    name: s.name,
    description: s.description,
    phase: s.phase,
    isRequired: s.isRequired,
    slaDays: s.slaDays,
    dueAt: dueKeys[i] != null ? opsDateToPrisma(dueKeys[i] as string) : null,
  }));
}

export type ScheduleTask = {
  id: string;
  seq: number;
  status: string;
  slaDays: number | null;
  completedAt: Date | null;
};

const OPEN_TASK_STATUSES = new Set(["pending", "in_progress", "blocked"]);

/**
 * Recompute the rolling schedule for a project after a task transition. Walks
 * tasks in seq order keeping a running anchor: a completed task advances the
 * anchor to its ACTUAL completion date (so downstream deadlines re-base on
 * reality), a skipped task is passed over (no turnaround), and every still-open
 * task is rescheduled to anchor + its turnaround. Returns the `dueAt` patch for
 * the open tasks and the project-level `dueAt` (latest scheduled date, the live
 * ETA). Pure — no clock/DB; the caller persists only the tasks whose date moved.
 */
export function recomputeSchedule(
  tasks: ScheduleTask[],
  projectStartKey: string,
  holidays: ReadonlySet<string>,
): { updates: { id: string; dueAt: Date | null }[]; projectDueAt: Date | null } {
  const ordered = [...tasks].sort((a, b) => a.seq - b.seq);
  let anchor = projectStartKey;
  let latestKey: string | null = null;
  const updates: { id: string; dueAt: Date | null }[] = [];

  for (const t of ordered) {
    if (t.status === "completed" && t.completedAt) {
      const k = opsDateKey(t.completedAt);
      if (k > anchor) anchor = k;
      if (!latestKey || k > latestKey) latestKey = k;
      continue;
    }
    if (!OPEN_TASK_STATUSES.has(t.status)) continue; // skipped (or other terminal) — no turnaround
    if (t.slaDays == null) {
      updates.push({ id: t.id, dueAt: null });
      continue;
    }
    anchor = addBusinessDays(anchor, t.slaDays, holidays);
    if (!latestKey || anchor > latestKey) latestKey = anchor;
    updates.push({ id: t.id, dueAt: opsDateToPrisma(anchor) });
  }

  return { updates, projectDueAt: latestKey ? opsDateToPrisma(latestKey) : null };
}

/**
 * The default operations owner for a new project: the sole active operations
 * user, if exactly one exists; otherwise null (the project lands in the
 * Unassigned bucket for a manager to triage). "Operations user" = a non-admin
 * role granted the operations workspace page. Returns null today (the role
 * ships in Phase 3) — forward-compatible. Round-robin/load-based routing is a
 * future enhancement.
 */
export async function resolveDefaultOpsAssignee(
  client: PrismaClient | Prisma.TransactionClient,
): Promise<string | null> {
  const users = await client.user.findMany({
    where: { roleRef: { isAdmin: false, pages: { has: "/operations/projects" } } },
    select: { id: true },
    take: 2,
  });
  return users.length === 1 ? users[0].id : null;
}

type TemplateForInstantiation = {
  id: string;
  steps: SnapshotStep[];
};

export type EnrollProjectResult = { projectId: string; taskCount: number; created: boolean };

/**
 * Create the operations project for a freshly-enrolled (candidate, service).
 * Runs INSIDE the enroll transaction so a candidate is never enrolled without
 * their project. Behaviour:
 *   - Idempotent on `partyServiceId` (1:1): if a project already exists, no-op
 *     (never duplicates tasks on re-enroll).
 *   - Soft no-op when the service has no active template — returns null so
 *     enrollment still succeeds (the candidate-service can be backfilled once a
 *     template is authored); enrollment must never fail on a missing process.
 *   - Otherwise snapshots the template steps into tasks with business-day due
 *     dates and assigns the default operations owner.
 */
export async function createProjectForEnrollment(
  tx: Prisma.TransactionClient,
  args: {
    partyServiceId: string;
    partyId: string;
    serviceId: string;
    leadId: string | null;
    actorId: string | null;
    template: TemplateForInstantiation | null;
    holidays: ReadonlySet<string>;
    assigneeId: string | null;
  },
): Promise<EnrollProjectResult | null> {
  const existing = await tx.opsProject.findUnique({
    where: { partyServiceId: args.partyServiceId },
    select: { id: true },
  });
  if (existing) return { projectId: existing.id, taskCount: 0, created: false };

  if (!args.template) {
    console.warn(
      `[ops] no active ProcessTemplate for service ${args.serviceId}; enrolled party ${args.partyId} without an operations project (backfill later).`,
    );
    return null;
  }

  const startKey = opsToday();
  const tasks = buildSnapshotTasks(args.template.steps, startKey, args.holidays);
  // Project due date = the latest task due date (rolled up from step SLAs).
  const dueAt = tasks.reduce<Date | null>(
    (max, t) => (t.dueAt && (!max || t.dueAt > max) ? t.dueAt : max),
    null,
  );
  const assignedAt = args.assigneeId ? new Date() : null;

  const project = await tx.opsProject.create({
    data: {
      partyServiceId: args.partyServiceId,
      partyId: args.partyId,
      serviceId: args.serviceId,
      templateId: args.template.id,
      leadId: args.leadId,
      assignedToId: args.assigneeId,
      assignedAt,
      status: "active",
      dueAt,
      createdById: args.actorId,
      tasks: {
        create: tasks.map((t) => ({
          templateStepId: t.templateStepId,
          seq: t.seq,
          name: t.name,
          description: t.description,
          phase: t.phase,
          isRequired: t.isRequired,
          slaDays: t.slaDays,
          dueAt: t.dueAt,
          assignedToId: args.assigneeId,
        })),
      },
    },
    select: { id: true },
  });

  return { projectId: project.id, taskCount: tasks.length, created: true };
}
