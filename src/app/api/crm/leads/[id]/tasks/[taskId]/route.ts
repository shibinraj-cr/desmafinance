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
import {
  armTaskReminders,
  cancelTaskReminders,
  armedChannelsFor,
  getTaskReminderConfig,
  TASK_REMINDER_CHANNELS,
} from "@/lib/crm-task-reminders-engine";

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
  /** As on task creation: omitted means the admin's defaults, [] means none. */
  reminderChannels: z.array(z.enum(TASK_REMINDER_CHANNELS)).optional(),
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
  /**
   * Re-arm this task's reminder on exactly these channels. OMITTED means "leave
   * the reminder alone" — unlike creation, where omitting applies the defaults.
   * An edit that does not mention reminders must not silently re-arm one the
   * consultant deliberately turned off.
   */
  reminderChannels: z.array(z.enum(TASK_REMINDER_CHANNELS)).optional(),
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
      lead: { select: { id: true, assignedToId: true, status: { select: { kind: true, code: true, parked: true } } } },
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
  const reopening = data.status === "open" && task.status !== "open";
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
    if (
      requiresNextStepOnComplete({
        completing,
        leadKind: task.lead.status.kind,
        remainingOpenTasks,
        statusCode: task.lead.status.code,
        parked: task.lead.status.parked,
      })
    ) {
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

  // A request that only re-arms the reminder changes no task field, so the
  // shortcut has to let it through or un-ticking a channel would silently do
  // nothing.
  if (Object.keys(update).length === 0 && !data.reminderChannels) {
    return NextResponse.json({ task: serializeTask(task) });
  }

  // Complete (+ book the next task) in one transaction so an active lead is
  // never momentarily left with no open task.
  const config = await getTaskReminderConfig();
  const dueChanged = fieldChanges.includes("due date");

  const { updated, created } = await prisma.$transaction(async (tx) => {
    const u = Object.keys(update).length
      ? await tx.crmTask.update({ where: { id: params.taskId }, data: update, include: taskInclude })
      : task;
    const c = nextCreate ? await tx.crmTask.create({ data: nextCreate, include: taskInclude }) : null;

    // Disarming happens HERE, beside the completion that made it unnecessary.
    // If the two could drift apart the failure mode is a candidate being chased
    // for something they have already done.
    if (completing) {
      await cancelTaskReminders(params.taskId, tx);
    } else if (data.reminderChannels) {
      await armTaskReminders({ taskId: params.taskId, channels: data.reminderChannels, actorId: userId, tx });
    } else if (reopening || dueChanged) {
      // Re-arm it the way it was: a moved due date re-times the same channels,
      // and reopening a task restores the net it had before it was completed.
      const previous = await armedChannelsFor(params.taskId, tx);
      if (config.enabled && previous.length) {
        await armTaskReminders({ taskId: params.taskId, channels: previous, actorId: userId, tx });
      }
    }

    // The mandatory next task is a freshly created task and gets the defaults,
    // exactly as it would from the composer.
    if (c && config.enabled) {
      const nextChannels = data.nextTask?.reminderChannels ?? config.defaultChannels;
      if (nextChannels.length) {
        await armTaskReminders({ taskId: c.id, channels: nextChannels, actorId: userId, tx });
      }
    }

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
      metadata: { taskId: created.id, dueAt: created.dueAt, assignedToId: created.assignedToId, priority: created.priority, note: created.note },
    });
  }
  if (fieldChanges.length > 0) {
    await recordLeadActivity({
      leadId: params.id,
      actorId: userId,
      type: "TASK_UPDATED",
      summary: `Updated task: ${fieldChanges.join(", ")}`,
      // Surface the note's new text on the Timeline when it was one of the edited fields.
      metadata: { taskId: task.id, fields: fieldChanges, ...(fieldChanges.includes("note") ? { note: updated.note } : {}) },
    });
  }

  // Re-read rather than serializing `updated`: the reminder rows are rewritten
  // AFTER the task inside the transaction above, so the copy captured there
  // carries their pre-edit state and the row would render what the consultant
  // just changed away from.
  const fresh = await prisma.crmTask.findUnique({ where: { id: params.taskId }, include: taskInclude });

  return NextResponse.json({
    task: serializeTask(fresh ?? updated),
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
