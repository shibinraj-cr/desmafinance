import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { isActionOnlyStatus, bulkStageSkipReason } from "@/lib/crm-leads";
import { openRemarketingCampaign, stopRemarketingCampaigns } from "@/lib/crm-remarketing";
import { isLostStatusCode, REMARKETING_STATUS_CODE } from "@/lib/crm-reinquiry";
import { todayIst, toPrismaDate } from "@/lib/lead-pulse-dates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One request moves at most this many leads; the client chunks larger
// selections so each request stays well inside the function timeout. The status
// write itself is set-based (one updateMany + one createMany), so the per-lead
// cost is only the Re-marketing campaign lifecycle — which runs solely when the
// move enters or leaves that one stage.
const MAX_PER_REQUEST = 200;

const BodySchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(MAX_PER_REQUEST),
  statusId: z.string().min(1),
});

// POST /api/crm/leads/bulk-status — move many leads to one pipeline stage.
//
// Same rules as the single-lead PATCH (src/app/api/crm/leads/[id]/route.ts), so
// the two paths can never disagree:
//   - the target status must exist, be active, and not be action-only
//     (`pipeline` / `enrolled` / `duplicate` are set by an action, never a picker);
//   - an ENROLLED lead is never moved — its Party / pipeline row / finance draft /
//     Ops project would silently desync. Those are reported as skipped, not fatal,
//     because a bulk selection legitimately sweeps some enrolled leads up;
//   - a lead already in the target stage is a no-op (no activity, no churn);
//   - entering Re-marketing opens a nurturing campaign, leaving it closes one;
//   - the Marketing forecast mirror follows a lost/revived lead.
//
// Restricted to users who may edit ANY lead (system admins + Lead Pulse
// supervisors, i.e. the Marketing Admin) — see CrmAccess.canBulkStatus.
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canBulkStatus) throw forbidden();

  const parsed = BodySchema.parse(await req.json().catch(() => null));
  // Dedupe so a repeated id can't be counted (or logged) twice.
  const leadIds = Array.from(new Set(parsed.leadIds));

  const target = await prisma.crmLeadStatus.findFirst({
    where: { id: parsed.statusId, active: true },
    select: { id: true, code: true, label: true },
  });
  if (!target) throw badRequest("Unknown or inactive status", "invalid_status");
  if (isActionOnlyStatus(target.code)) {
    throw badRequest(
      `"${target.label}" is set by an action (Set deal / Enroll), not a stage change.`,
      "status_action_only",
    );
  }

  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: {
      id: true,
      statusId: true,
      assignedToId: true,
      status: { select: { code: true, label: true } },
      pipeline: { select: { id: true, status: true } },
    },
  });

  type Row = (typeof leads)[number];
  const moving: Row[] = [];
  let skippedEnrolled = 0;
  let skippedUnchanged = 0;
  let skippedForbidden = 0;
  const skippedMissing = leadIds.length - leads.length; // stale ids

  for (const lead of leads) {
    const skip = bulkStageSkipReason(lead, target.id);
    if (skip === "enrolled") {
      skippedEnrolled++;
      continue;
    }
    if (skip === "unchanged") {
      skippedUnchanged++;
      continue;
    }
    // Defence in depth: canBulkStatus is already the "edits any lead" tier, so
    // this can't fire today — it keeps the route honest if that ever widens.
    if (!canEditLead(access, lead, userId)) {
      skippedForbidden++;
      continue;
    }
    moving.push(lead);
  }

  if (moving.length === 0) {
    return NextResponse.json({
      requested: leadIds.length,
      moved: 0,
      skippedEnrolled,
      skippedUnchanged,
      skippedForbidden,
      skippedMissing,
      statusLabel: target.label,
    });
  }

  const movingIds = moving.map((l) => l.id);
  const now = new Date();

  // The status write itself: one update for the stage + activity stamp, one
  // insert for the timeline entries. `lastActivityAt` is bumped here for the
  // same reason recordLeadActivity bumps it on the single-lead path.
  await prisma.$transaction([
    prisma.lead.updateMany({
      where: { id: { in: movingIds } },
      data: { statusId: target.id, lastActivityAt: now },
    }),
    prisma.leadActivity.createMany({
      data: moving.map((lead) => ({
        leadId: lead.id,
        actorId: userId,
        type: "STATUS_CHANGED",
        summary: `Status changed: ${lead.status.label} → ${target.label}`,
        // Same shape the single-lead path writes, plus a bulk marker so the
        // History can tell a sweep from a one-off.
        metadata: { from: lead.status.label, to: target.label, bulk: true },
      })),
    }),
  ]);

  // Keep the Marketing forecast in step: a lost lead's deal drops out of the
  // pipeline, a revived one comes back. Batched from the rows already loaded —
  // the set-based equivalent of syncPipelineToLeadStatus per lead.
  const openPipelineIds = moving.filter((l) => l.pipeline?.status === "open").map((l) => l.pipeline!.id);
  const lostPipelineIds = moving.filter((l) => l.pipeline?.status === "lost").map((l) => l.pipeline!.id);
  try {
    if (isLostStatusCode(target.code)) {
      if (openPipelineIds.length) {
        await prisma.leadPulsePipeline.updateMany({
          where: { id: { in: openPipelineIds } },
          data: { status: "lost", closedDate: toPrismaDate(todayIst()) },
        });
      }
    } else if (lostPipelineIds.length) {
      await prisma.leadPulsePipeline.updateMany({
        where: { id: { in: lostPipelineIds } },
        data: { status: "open", closedDate: null },
      });
    }
  } catch {
    // Mirror is best-effort; the leads' own status change already committed.
  }

  // Re-marketing campaign lifecycle. Per-lead by necessity (each opens/closes
  // its own campaign row), but only for moves that touch that one stage, so a
  // normal bulk move costs nothing here. Both helpers are idempotent and never
  // throw; sequential so a large sweep can't open hundreds of connections.
  // Counted as moves into / out of the stage, not as campaigns actually opened:
  // openRemarketingCampaign is a no-op for a lead already running one (or whose
  // number a prior touch found undeliverable) and reports that on its timeline.
  let remarketingEntered = 0;
  let remarketingLeft = 0;
  if (target.code === REMARKETING_STATUS_CODE) {
    for (const lead of moving) {
      await openRemarketingCampaign({ leadId: lead.id, actorId: userId });
      remarketingEntered++;
    }
  } else {
    for (const lead of moving) {
      if (lead.status.code !== REMARKETING_STATUS_CODE) continue;
      await stopRemarketingCampaigns({ leadId: lead.id, actorId: userId });
      remarketingLeft++;
    }
  }

  return NextResponse.json({
    requested: leadIds.length,
    moved: moving.length,
    skippedEnrolled,
    skippedUnchanged,
    skippedForbidden,
    skippedMissing,
    remarketingEntered,
    remarketingLeft,
    statusLabel: target.label,
  });
});
