import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { recordLeadActivity, type CrmActivityType } from "@/lib/crm-activity";
import { taskInclude, serializeTask, isActiveBde } from "@/lib/crm-leads";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; taskId: string } };

// PATCH /api/crm/leads/[id]/tasks/[taskId] — complete / reopen / edit fields
const PatchSchema = z.object({
  status: z.enum(["open", "done"]).optional(),
  subject: z.string().trim().min(1).max(500).optional(),
  dueAt: z.coerce.date().nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  assignedToId: z.string().nullable().optional(),
  note: z.string().trim().max(5000).nullable().optional(),
});

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const task = await prisma.crmTask.findUnique({
    where: { id: params.taskId },
    include: { ...taskInclude, lead: { select: { id: true, assignedToId: true } } },
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

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ task: serializeTask(task) });
  }

  const updated = await prisma.crmTask.update({
    where: { id: params.taskId },
    data: update,
    include: taskInclude,
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
  if (fieldChanges.length > 0) {
    await recordLeadActivity({
      leadId: params.id,
      actorId: userId,
      type: "TASK_UPDATED",
      summary: `Updated task: ${fieldChanges.join(", ")}`,
      metadata: { taskId: task.id, fields: fieldChanges },
    });
  }

  return NextResponse.json({ task: serializeTask(updated) });
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
