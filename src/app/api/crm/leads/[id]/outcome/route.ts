import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest, unprocessable, conflict } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { recordLeadActivity } from "@/lib/crm-activity";
import { NEW_LEAD_STATUS_CODE } from "@/lib/crm-leads";
import { FOLLOW_UP_STATUS_CODE } from "@/lib/crm-remarketing";
import { QUALITY_GATE_MESSAGE, QUALITY_REQUIRED_CODE, qualityGate } from "@/lib/crm-lead-quality";
import { armTaskReminders, getTaskReminderConfig } from "@/lib/crm-task-reminders-engine";
import { CALL_OUTCOME_LABEL, CALL_OUTCOMES, outcomeMovesNewLead } from "@/lib/crm-outcome";

export const dynamic = "force-dynamic";

const Schema = z.object({
  outcome: z.enum(CALL_OUTCOMES),
  durationMin: z.number().int().min(0).max(600).optional(),
  note: z.string().trim().max(2000).optional(),
  /** The conversation Status after this call; omitted = unchanged. */
  subStatusId: z.string().min(1).optional(),
  /** The next follow-up to book; omitted = none. */
  next: z
    .object({
      dueAt: z.coerce.date(),
      subject: z.string().trim().min(1).max(500),
    })
    .optional(),
});

/**
 * POST /api/crm/leads/[id]/outcome — log a call and everything that follows
 * from it in one step: the call itself, the conversation Status, a New lead
 * moving to Follow-Up once the candidate was actually reached, and the next
 * follow-up task (with its reminder armed, as the task routes do). Before this
 * a consultant made four separate saves — call, Status, stage, task — after
 * every single contact.
 *
 * The same rules as the individual routes: edit rights on the lead, an active
 * Status, the quality-rating gate for a stage move, and a stage write that
 * refuses to overwrite a change someone else made in between.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      assignedToId: true,
      statusId: true,
      subStatusId: true,
      qualityRating: true,
      qualityDueAt: true,
      status: { select: { code: true, label: true } },
      subStatus: { select: { label: true } },
    },
  });
  if (!lead) throw notFound();
  if (!canEditLead(access, lead, userId)) throw forbidden();

  const d = Schema.parse(await req.json().catch(() => null));
  const now = new Date();

  // Status (the conversation state).
  let subStatus: { id: string; label: string } | null = null;
  if (d.subStatusId && d.subStatusId !== lead.subStatusId) {
    subStatus = await prisma.crmLeadSubStatus.findFirst({
      where: { id: d.subStatusId, active: true },
      select: { id: true, label: true },
    });
    if (!subStatus) throw badRequest("Unknown or inactive status", "invalid_sub_status");
  }

  // Stage: a New lead the consultant actually reached is now being followed up.
  let followUp: { id: string; label: string } | null = null;
  if (outcomeMovesNewLead(d.outcome, lead.status.code)) {
    followUp = await prisma.crmLeadStatus.findFirst({
      where: { code: FOLLOW_UP_STATUS_CODE, active: true },
      select: { id: true, label: true },
    });
    if (followUp) {
      const gate = qualityGate(
        {
          qualityRating: lead.qualityRating,
          qualityDueAt: lead.qualityDueAt,
          assignedToId: lead.assignedToId,
          statusCode: lead.status.code,
        },
        { actorId: userId, now, nextStage: { code: FOLLOW_UP_STATUS_CODE, kind: "active" } },
      );
      if (gate) throw unprocessable(QUALITY_GATE_MESSAGE[gate], QUALITY_REQUIRED_CODE);
    }
  }

  if (subStatus || followUp) {
    await prisma.lead
      .update({
        where: { id: lead.id, ...(followUp ? { statusId: lead.statusId } : {}) },
        data: {
          ...(subStatus ? { subStatusId: subStatus.id, subStatusSince: now } : {}),
          ...(followUp ? { statusId: followUp.id } : {}),
        },
      })
      .catch((e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
          throw conflict("Someone else changed this lead's stage just now — reload and try again.", "stage_changed");
        }
        throw e;
      });
  }

  // The call first on the timeline, then what changed because of it.
  const durationSec = d.durationMin !== undefined ? d.durationMin * 60 : null;
  await recordLeadActivity({
    leadId: lead.id,
    actorId: userId,
    type: "CALL_LOGGED",
    summary: `Call logged: ${CALL_OUTCOME_LABEL[d.outcome]}${d.durationMin ? ` (${d.durationMin} min)` : ""}`,
    metadata: { outcome: d.outcome, durationSec, note: d.note || null, via: "outcome" },
  });
  if (subStatus) {
    await recordLeadActivity({
      leadId: lead.id,
      actorId: userId,
      type: "SUB_STATUS_CHANGED",
      summary: `Status: ${lead.subStatus?.label ?? "—"} → ${subStatus.label}`,
      metadata: { fromLabel: lead.subStatus?.label ?? "—", toLabel: subStatus.label },
    });
  }
  if (followUp) {
    await recordLeadActivity({
      leadId: lead.id,
      actorId: userId,
      type: "STATUS_CHANGED",
      summary: `Status changed: ${lead.status.label} → ${followUp.label}`,
      metadata: { from: lead.status.label, to: followUp.label, via: "outcome" },
    });
  }

  // The next follow-up, with the admin's default reminder channels — the same
  // contract as POST /api/crm/leads/[id]/tasks.
  let taskId: string | null = null;
  if (d.next) {
    const config = await getTaskReminderConfig();
    const channels = config.enabled ? config.defaultChannels : [];
    const assignedToId = lead.assignedToId ?? userId;
    const next = d.next;
    taskId = await prisma.$transaction(async (tx) => {
      const created = await tx.crmTask.create({
        data: { leadId: lead.id, subject: next.subject, dueAt: next.dueAt, assignedToId, createdById: userId },
        select: { id: true },
      });
      if (channels.length) await armTaskReminders({ taskId: created.id, channels, actorId: userId, tx });
      return created.id;
    });
    await recordLeadActivity({
      leadId: lead.id,
      actorId: userId,
      type: "TASK_CREATED",
      summary: `Task created: “${next.subject}”`,
      metadata: { taskId, dueAt: next.dueAt, assignedToId, via: "outcome" },
    });
  }

  return NextResponse.json({
    logged: true,
    movedToFollowUp: !!followUp,
    subStatusChanged: !!subStatus,
    taskId,
  });
});
