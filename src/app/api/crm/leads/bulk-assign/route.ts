import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest, HttpError } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { assignLeadTo } from "@/lib/crm-assign";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One request assigns at most this many leads; the client chunks larger
// selections. Lower than bulk-status's 200 because each lead goes through the
// full single-lead path (~a dozen round trips: tasks, timeline, notification,
// WhatsApp intro, inbox thread), not a set-based write.
const MAX_PER_REQUEST = 50;

const BodySchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(MAX_PER_REQUEST),
  assignedToId: z.string().min(1),
});

// POST /api/crm/leads/bulk-assign — hand many leads to one BDE.
//
// Each lead goes through assignLeadTo, the same core the per-lead assign
// endpoint and the WhatsApp inbox use, so a bulk assignment is indistinguishable
// from doing it one row at a time: open tasks follow the lead, the timeline gets
// an ASSIGNED / REASSIGNED entry, the BDE is notified, the WhatsApp intro is
// queued (L2 only, once per lead and consultant) and the inbox thread moves.
//
// Skipped, not fatal, because a filter sweep legitimately picks them up:
//   - leads already with that BDE (no churn, no second notification);
//   - leads back from the central pool whose previous owner is that BDE (the
//     Sales SOP's "revive to a different consultant" rule);
//   - ids that no longer exist.
//
// Same gate as the per-lead endpoint (CrmAccess.canAssign), so bulk is only a
// faster path to a power the user already has.
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canAssign) throw forbidden();

  const parsed = BodySchema.parse(await req.json().catch(() => null));
  // Dedupe so a repeated id can't be counted (or notified) twice.
  const leadIds = Array.from(new Set(parsed.leadIds));
  const targetId = parsed.assignedToId;

  // Checked once up front: a bad pick should fail the request, not be reported
  // as fifty identical skips. assignLeadTo re-checks it per lead regardless.
  const target = await prisma.leadPulseRole.findUnique({
    where: { userId: targetId },
    select: { role: true, active: true, displayName: true },
  });
  if (!target || !target.active || (target.role !== "l1" && target.role !== "l2")) {
    throw badRequest("Assignee must be an active L1/L2 BDE", "invalid_assignee");
  }

  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: { id: true, assignedToId: true },
  });

  let assigned = 0;
  let reassigned = 0;
  let skippedUnchanged = 0;
  let skippedRevival = 0;
  let skippedMissing = leadIds.length - leads.length; // stale ids

  // Sequential on purpose: each assignment is several writes plus best-effort
  // side effects, and a parallel burst would open a connection per lead.
  for (const lead of leads) {
    if (lead.assignedToId === targetId) {
      skippedUnchanged++;
      continue;
    }
    try {
      await assignLeadTo(lead.id, targetId, userId);
    } catch (e) {
      if (e instanceof HttpError && e.code === "same_owner_revival") {
        skippedRevival++;
        continue;
      }
      if (e instanceof HttpError && e.status === 404) {
        skippedMissing++; // deleted between the read above and the write
        continue;
      }
      // Anything else stops the chunk; the client retries from here, and the
      // leads that already moved come back as "unchanged" rather than twice.
      throw e;
    }
    if (lead.assignedToId) reassigned++;
    else assigned++;
  }

  return NextResponse.json({
    requested: leadIds.length,
    assigned,
    reassigned,
    skippedUnchanged,
    skippedRevival,
    skippedMissing,
    assigneeName: target.displayName,
  });
});
