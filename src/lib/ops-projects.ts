import type { Prisma, PrismaClient } from "@prisma/client";
import { addBusinessDays, opsToday, opsDateToPrisma } from "./ops-dates";

/**
 * Project-instance logic for the Operations module: snapshot a service's
 * process template into a per-candidate project + tasks at enroll time. The
 * snapshot (seq/name/phase/isRequired/slaDays + computed dueAt) freezes each
 * task against later template edits — the precondition for trustworthy
 * performance analytics. See the CRM-enroll hook in `crm-enroll.ts`.
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
 * Build the task rows for a new project by snapshotting the template's steps.
 * Pure (given the holiday set): each task copies the step's fields and gets a
 * business-day `dueAt = start + slaDays` (null when the step has no SLA).
 */
export function buildSnapshotTasks(
  steps: SnapshotStep[],
  startKey: string,
  holidays: ReadonlySet<string>,
): SnapshotTaskData[] {
  return steps.map((s) => ({
    templateStepId: s.id,
    seq: s.seq,
    name: s.name,
    description: s.description,
    phase: s.phase,
    isRequired: s.isRequired,
    slaDays: s.slaDays,
    dueAt: s.slaDays != null ? opsDateToPrisma(addBusinessDays(startKey, s.slaDays, holidays)) : null,
  }));
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
    leadId: string;
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
