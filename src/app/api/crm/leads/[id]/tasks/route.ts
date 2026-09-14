import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { recordLeadActivity } from "@/lib/crm-activity";
import { taskInclude, serializeTask, taskOrderBy, isActiveBde } from "@/lib/crm-leads";
import {
  armTaskReminders,
  getTaskReminderConfig,
  TASK_REMINDER_CHANNELS,
} from "@/lib/crm-task-reminders-engine";

export const dynamic = "force-dynamic";

// GET /api/crm/leads/[id]/tasks — list tasks (any CRM viewer)
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const tasks = await prisma.crmTask.findMany({
    where: { leadId: params.id },
    orderBy: taskOrderBy,
    include: taskInclude,
  });
  return NextResponse.json({ tasks: tasks.map(serializeTask) });
});

// POST /api/crm/leads/[id]/tasks — create a task (assigned BDE or admin)
const CreateSchema = z.object({
  subject: z.string().trim().min(1).max(500),
  dueAt: z.coerce.date().optional().nullable(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  assignedToId: z.string().optional().nullable(),
  note: z.string().trim().max(5000).optional().nullable(),
  /**
   * Channels to arm the candidate-facing reminder on. OMITTED means "the admin's
   * defaults" rather than "none" — that is what makes the safety net on by
   * default, and it is why a caller that has never heard of reminders (the
   * mobile API, the mandatory next-step dialog) still gets one. An explicit
   * empty array is the consultant saying no.
   */
  reminderChannels: z.array(z.enum(TASK_REMINDER_CHANNELS)).optional(),
});

export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, assignedToId: true },
  });
  if (!lead) throw notFound();
  if (!canEditLead(access, lead, userId)) throw forbidden();

  const data = CreateSchema.parse(await req.json().catch(() => null));

  // Resolve the responsible BDE: explicit choice (must be an active BDE) or the
  // lead's owner, else the creator.
  if (data.assignedToId && !(await isActiveBde(data.assignedToId))) {
    throw badRequest("The selected assignee is not an active BDE.", "assignee_not_bde");
  }
  const assignedToId = data.assignedToId ?? lead.assignedToId ?? userId;

  // The reminder is armed in the SAME transaction as the task. A task that
  // claims to have a safety net but does not is worse than one that plainly has
  // none, so if arming cannot be done the task is not created either.
  const config = await getTaskReminderConfig();
  const channels = data.reminderChannels ?? (config.enabled ? config.defaultChannels : []);

  const { task, arm } = await prisma.$transaction(async (tx) => {
    const created = await tx.crmTask.create({
      data: {
        leadId: params.id,
        subject: data.subject,
        dueAt: data.dueAt ?? null,
        priority: data.priority ?? "normal",
        note: data.note?.trim() ? data.note.trim() : null,
        assignedToId,
        createdById: userId,
      },
      include: taskInclude,
    });
    const armed =
      config.enabled && channels.length
        ? await armTaskReminders({ taskId: created.id, channels, actorId: userId, tx })
        : { armed: [], skipped: [] };
    return { task: created, arm: armed };
  });

  await recordLeadActivity({
    leadId: params.id,
    actorId: userId,
    type: "TASK_CREATED",
    summary: `Task created: “${task.subject}”`,
    metadata: {
      taskId: task.id,
      dueAt: task.dueAt,
      assignedToId: task.assignedToId,
      priority: task.priority,
      note: task.note,
      ...(arm.armed.length ? { reminderChannels: arm.armed } : {}),
    },
  });

  // Re-read for the same reason the PATCH route does: `task` was captured before
  // the reminders were armed inside the transaction, so its `reminders` array is
  // empty and the new row would render as having no safety net.
  const fresh = await prisma.crmTask.findUnique({ where: { id: task.id }, include: taskInclude });

  return NextResponse.json({ task: serializeTask(fresh ?? task), reminders: arm }, { status: 201 });
});
