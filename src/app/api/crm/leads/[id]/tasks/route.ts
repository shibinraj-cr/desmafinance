import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { recordLeadActivity } from "@/lib/crm-activity";
import { taskInclude, serializeTask, taskOrderBy, isActiveBde } from "@/lib/crm-leads";

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

  const task = await prisma.crmTask.create({
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

  await recordLeadActivity({
    leadId: params.id,
    actorId: userId,
    type: "TASK_CREATED",
    summary: `Task created: “${task.subject}”`,
    metadata: { taskId: task.id, dueAt: task.dueAt, assignedToId: task.assignedToId, priority: task.priority },
  });

  return NextResponse.json({ task: serializeTask(task) }, { status: 201 });
});
