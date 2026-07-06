import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest, unprocessable } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { recordLeadActivity, type CrmActivityType } from "@/lib/crm-activity";
import { taskInclude, serializeTask, isActiveBde, requiresNextStepOnComplete } from "@/lib/crm-leads";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; taskId: string } };

// The replacement follow-up sent when completing an active lead's last open
// task (mirrors the task-create payload). Enforces the "active leads always have
// a next step" rule — see the completion block below.
const NextTaskSchema = z.object({
  subject: z.string().trim().min(1).max(500),
  dueAt: z.coerce.date().nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  assignedToId: z.string().nullable().optional(),
  note: z.string().trim().max(5000).nullable().optional(),
});

// PATCH /api/crm/leads/[id]/tasks/[taskId] — complete / reopen / edit fields
const PatchSchema = z.object({
  status: z.enum(["open", "done"]).optional(),
  subject: z.string().trim().min(1).max(500).optional(),
  dueAt: z.coerce.date().nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  assignedToId: z.string().nullable().optional(),
  note: z.string().trim().max(5000).nullable().optional(),
  /** Next follow-up to schedule when this completion would otherwise leave an active lead with no open task. */
  nextTask: NextTaskSchema.optional(),
});

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const task = await prisma.crmTask.findUnique({
    where: { id: params.taskId },
    include: {
      ...taskInclude,
      lead: { select: { id: true, assignedToId: true, status: { select: { kind: true } } } },
    },
  });
  if (!task || task.leadId !== params.id) throw notFound();
  if (!canEditLead(access, task.lead, userId)) throw forbidden();

  const data = PatchSchema.parse(await req.json().catch(() => null));

  if (data.assignedToId && !(await isActiveBde(data.assignedToId))) {
    throw badRequest("The selected assignee is not an active BDE.", "assignee_not_bde");
  }

  const update: Prisma.CrmTaskUpdateInput = {};
  const fieldChanges: string[] = [];

  if (data.subject !== undefined && data.subject !== task.subject) {
    update.subject = data.subject;
    fieldChanges.push("subject");
  }
  if (data.priority !== undefined && data.priority !== task.priority) {
    update.priority = data.priority;
    fieldChanges.push("priority");
  }
  if (data.note !== undefined) {
    const next = data.note?.trim() ? data.note.trim() : null;
    if (next !== task.note) {
      update.note = next;
      fieldChanges.push("note");
    }
  }
  if (data.dueAt !== undefined) {
    const a = data.dueAt ? data.dueAt.getTime() : null;
    const b = task.dueAt ? task.dueAt.getTime() : null;
    if (a !== b) {
      update.dueAt = data.dueAt ?? null;
      fieldChanges.push("due date");
    }
  }
  if (data.assignedToId !== undefined && data.assignedToId !== task.assignedToId) {
    update.assignedTo = data.assignedToId
      ? { connect: { id: data.assignedToId } }
      : { disconnect: true };
    fieldChanges.push("assignee");
  }

  // Status transition (complete / reopen) — tracked as its own activity.
  let statusActivity: { type: CrmActivityType; summary: string } | null = null;
  const completing = data.status === "done" && task.status !== "done";
  if (data.status !== undefined && data.status !== task.status) {
    if (data.status === "done") {
      update.status = "done";
      update.completedAt = new Date();
      update.completedBy = { connect: { id: userId } };
      statusActivity = { type: "TASK_COMPLETED", summary: `Task completed: “${task.subject}”` };
    } else {
      update.status = "open";
      update.completedAt = null;
      update.completedBy = { disconnect: true };
      statusActivity = { type: "TASK_REOPENED", summary: `Task reopened: “${task.subject}”` };
    }
  }

  // Mandatory next step: an ACTIVE lead must always have an open task. If this
  // completion would leave it with none, require a replacement follow-up in the
  // same request (created atomically below). Won/lost leads and completions that
  // still leave another open task are exempt.
  let nextCreate: Prisma.CrmTaskUncheckedCreateInput | null = null;
  if (completing && task.lead.status?.kind === "active") {
    const remainingOpenTasks = await prisma.crmTask.count({
      where: { leadId: params.id, status: "open", id: { not: params.taskId } },
    });
    if (requiresNextStepOnComplete({ completing, leadKind: task.lead.status.kind, remainingOpenTasks })) {
      if (!data.nextTask) {
        throw unprocessable(
          "This lead is still active and this is its last open task. Schedule the next follow-up to complete it.",
          "next_task_required",
        );
      }
      if (data.nextTask.assignedToId && !(await isActiveBde(data.nextTask.assignedToId))) {
        throw badRequest("The next task's assignee is not an active BDE.", "assignee_not_bde");
      }
      nextCreate = {
        leadId: params.id,
        subject: data.nextTask.subject,
        dueAt: data.nextTask.dueAt ?? null,
        priority: data.nextTask.priority ?? "normal",
        note: data.nextTask.note?.trim() ? data.nextTask.note.trim() : null,
        assignedToId: data.nextTask.assignedToId ?? task.lead.assignedToId ?? userId,
        createdById: userId,
      };
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ task: serializeTask(task) });
  }

  // Complete (+ book the next task) in one transaction so an active lead is
  // never momentarily left with no open task.
  const { updated, created } = await prisma.$transaction(async (tx) => {
    const u = await tx.crmTask.update({ where: { id: params.taskId }, data: update, include: taskInclude });
    const c = nextCreate ? await tx.crmTask.create({ data: nextCreate, include: taskInclude }) : null;
    return { updated: u, created: c };
  });

  if (statusActivity) {
    await recordLeadActivity({
      leadId: params.id,
      actorId: userId,
      type: statusActivity.type,
      summary: statusActivity.summary,
      metadata: { taskId: task.id },
    });
  }
  if (created) {
    await recordLeadActivity({
      leadId: params.id,
      actorId: userId,
      type: "TASK_CREATED",
      summary: `Task created: “${created.subject}”`,
      metadata: { taskId: created.id, dueAt: created.dueAt, assignedToId: created.assignedToId, priority: created.priority },
    });
  }
  if (fieldChanges.length > 0) {
    await recordLeadActivity({
      leadId: params.id,
      actorId: userId,
      type: "TASK_UPDATED",
      summary: `Updated task: ${fieldChanges.join(", ")}`,
      metadata: { taskId: task.id, fields: fieldChanges },
    });
  }

  return NextResponse.json({
    task: serializeTask(updated),
    nextTask: created ? serializeTask(created) : undefined,
  });
});

// DELETE /api/crm/leads/[id]/tasks/[taskId] — assigned BDE or admin
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const task = await prisma.crmTask.findUnique({
    where: { id: params.taskId },
    select: { id: true, leadId: true, subject: true, lead: { select: { id: true, assignedToId: true } } },
  });
  if (!task || task.leadId !== params.id) throw notFound();
  if (!canEditLead(access, task.lead, userId)) throw forbidden();

  await prisma.crmTask.delete({ where: { id: params.taskId } });
  await recordLeadActivity({
    leadId: params.id,
    actorId: userId,
    type: "TASK_DELETED",
    summary: `Deleted task: “${task.subject}”`,
    metadata: { taskId: task.id, subject: task.subject },
  });

  return NextResponse.json({ ok: true });
});
