/**
 * Shared core of "assign this lead to this user".
 *
 * Two entry points call this: the Pipeline's own assign endpoint, and the
 * WhatsApp inbox's conversation "Owner" control. Either place someone names an
 * agent, the Lead — the CRM's one system of record for who owns a candidate —
 * has to end up the same, or the Pipeline and the inbox show two different
 * owners for the same person.
 */
import { prisma } from "./prisma";
import { badRequest, notFound } from "./http-error";
import { recordLeadActivity } from "./crm-activity";
import { notifyLeadAssigned } from "./crm-notify";
import { enqueueLeadAssignedWebhook } from "./crm-webhook";
import { syncConversationAssignee } from "./wa/mirror";
import { qualityDueAtOnAssign } from "./crm-lead-quality";
import { leadRowInclude, crmTaskFollowAssignmentWhere, type LeadWithRels } from "./crm-leads";

/**
 * The consultant a lead was last released FROM into the central pool, or null.
 * Read from the latest UNASSIGNED entry, which carries `centralPool: true` when
 * the release was a move into Centralised (Re-)marketing.
 */
export async function lastCentralPoolOwner(leadId: string): Promise<string | null> {
  const last = await prisma.leadActivity.findFirst({
    where: { leadId, type: "UNASSIGNED" },
    orderBy: { occurredAt: "desc" },
    select: { metadata: true },
  });
  const m = (last?.metadata ?? null) as { centralPool?: unknown; fromUserId?: unknown } | null;
  return m && m.centralPool === true && typeof m.fromUserId === "string" ? m.fromUserId : null;
}

/** The operative rule: a lead revived from the central pool goes to a different consultant. */
export function isSameOwnerRevival(previousOwnerId: string | null, targetUserId: string | null): boolean {
  return !!previousOwnerId && !!targetUserId && previousOwnerId === targetUserId;
}

export async function assignLeadTo(
  leadId: string,
  targetUserId: string | null,
  actorUserId: string,
  opts: { centralPool?: boolean } = {},
): Promise<LeadWithRels> {
  const existing = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      assignedToId: true,
      assignedTo: { select: { username: true } },
      qualityDueAt: true,
      qualityRating: true,
    },
  });
  if (!existing) throw notFound();

  // Validate the new assignee is an active L1/L2 BDE (matches the dropdown).
  let targetName: string | null = null;
  // Kept alongside the name because the automated WhatsApp intro is L2-only —
  // read here rather than re-queried later, since this lookup already has it.
  let targetRole: string | null = null;
  // Same reason: the assignee's own Team Roster switch for that intro.
  let targetIntroEnabled = true;
  if (targetUserId) {
    const role = await prisma.leadPulseRole.findUnique({
      where: { userId: targetUserId },
      select: { role: true, active: true, displayName: true, sendAssignIntro: true },
    });
    if (!role || !role.active || (role.role !== "l1" && role.role !== "l2")) {
      throw badRequest("Assignee must be an active L1/L2 BDE", "invalid_assignee");
    }
    targetName = role.displayName;
    targetRole = role.role;
    targetIntroEnabled = role.sendAssignIntro;
  }

  // Fresh interest out of the central pool is a new consultant's lead — the
  // previous owner already had their chance (Sales SOP, hard rule).
  if (targetUserId && !existing.assignedToId && isSameOwnerRevival(await lastCentralPoolOwner(leadId), targetUserId)) {
    throw badRequest(
      "This lead came back from the central pool — assign it to a different consultant than its previous owner.",
      "same_owner_revival",
    );
  }

  if (existing.assignedToId === targetUserId) {
    // Assignee unchanged, but still pull any OPEN tasks stranded as "Unassigned"
    // onto the current owner so the Tasks board's "Unassigned" filter stays in
    // sync (repairs tasks stamped null before a consultant existed).
    if (targetUserId) {
      await prisma.crmTask.updateMany({
        where: { leadId, status: "open", ...crmTaskFollowAssignmentWhere(null) },
        data: { assignedToId: targetUserId },
      });
    }
    // The lead itself didn't move, but the caller may be here precisely because
    // its mirrored WhatsApp thread had drifted from it — resync unconditionally
    // rather than trusting the two already agree.
    await syncConversationAssignee(leadId, targetUserId);
    return (await prisma.lead.findUnique({ where: { id: leadId }, include: leadRowInclude }))!;
  }

  // Propagate the (re)assignment to the lead's OPEN tasks so the Tasks board's
  // "Unassigned" filter and consultant column track the lead owner.
  const assignedAt = new Date();
  // The new owner's five days to rate the lead start now (see qualityDueAtOnAssign).
  const qualityDueAt = targetUserId ? qualityDueAtOnAssign(existing, assignedAt) : undefined;
  const updated = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.update({
      where: { id: leadId },
      // Stamp the assignment moment (cleared on unassign) so the list can show an
      // "Assigned" date and filter by it.
      data: {
        assignedToId: targetUserId,
        assignedAt: targetUserId ? assignedAt : null,
        ...(qualityDueAt ? { qualityDueAt } : {}),
      },
      include: leadRowInclude,
    });
    await tx.crmTask.updateMany({
      where: { leadId, status: "open", ...crmTaskFollowAssignmentWhere(existing.assignedToId) },
      data: { assignedToId: targetUserId },
    });
    return lead;
  });

  const wasAssigned = !!existing.assignedToId;
  // Type is chosen by the resulting state, not just the prior one, so an
  // unassign is never mis-logged as a reassignment in the History tab.
  const type = !targetUserId ? "UNASSIGNED" : wasAssigned ? "REASSIGNED" : "ASSIGNED";
  const summary = !targetUserId
    ? `Unassigned${existing.assignedTo ? ` from ${existing.assignedTo.username}` : ""}`
    : wasAssigned
      ? `Reassigned to ${targetName}`
      : `Assigned to ${targetName}`;

  await recordLeadActivity({
    leadId: updated.id,
    actorId: actorUserId,
    type,
    summary,
    metadata: {
      fromUserId: existing.assignedToId,
      toUserId: targetUserId,
      ...(opts.centralPool && !targetUserId ? { centralPool: true } : {}),
    },
  });

  // In-app notify the new owner (best-effort; no-op on unassign or self-assign).
  if (targetUserId) {
    await notifyLeadAssigned({
      assigneeUserId: targetUserId,
      actorUserId,
      leadId: updated.id,
      candidateName: updated.candidateName,
      isReassignment: wasAssigned,
    });
  }

  // Wabis WhatsApp intro (best-effort; never fails the assignment). Whether a
  // reassignment may send is decided inside the helper, which checks the lead's
  // delivery history rather than this request's before/after state — unassigning
  // and reassigning would otherwise look like a first assignment and send the
  // candidate a second introduction.
  if (targetUserId) {
    await enqueueLeadAssignedWebhook({
      leadId: updated.id,
      assigneeUserId: targetUserId,
      candidateName: updated.candidateName,
      phone: updated.phoneE164 ?? updated.phone,
      email: updated.email,
      source: updated.source?.label,
      service: updated.service?.name,
      isStudyAbroad: updated.service?.isStudyAbroad,
      status: updated.status?.label,
      assignedAt: updated.assignedAt,
      agentDisplayName: updated.assignedTo?.leadPulseRole?.displayName,
      agentPhone: updated.assignedTo?.leadPulseRole?.phone,
      assigneeRole: targetRole,
      assigneeIntroEnabled: targetIntroEnabled,
    });
  }

  // Move the candidate's WhatsApp thread(s) to the new consultant, so the person
  // who now owns the lead is the person who can answer them, whichever surface
  // (Pipeline or inbox) the reassignment started from.
  await syncConversationAssignee(updated.id, targetUserId);

  return updated;
}

/**
 * Release a batch of leads to the central pool — the set-based sibling of
 * `assignLeadTo(id, null, actor)`.
 *
 * The single-lead call stays the one to use wherever a person unassigns one
 * lead; this exists for the bulk stage sweep, which moves up to 200 leads per
 * request and keeps its writes set-based on purpose (see MAX_PER_REQUEST in
 * src/app/api/crm/leads/bulk-status/route.ts). Doing it per lead would add ~5
 * round trips each to a path built to cost two.
 *
 * It mirrors `assignLeadTo`'s contract exactly, minus the parts that only apply
 * when there IS a new owner (no notification, no WhatsApp intro, no assignee
 * validation):
 *   - `assignedAt` is cleared alongside `assignedToId`, so the "Assigned" column
 *     and the assigned-on filter don't keep pointing at a consultant who no
 *     longer owns the lead;
 *   - OPEN tasks follow the lead — a task the outgoing consultant owned is
 *     released with it, one owned by anyone else (a supervisor's oversight copy)
 *     is left alone. Grouped by outgoing owner so a task is only ever matched
 *     against the lead it actually hangs off;
 *   - one UNASSIGNED timeline entry per lead, carrying the same `fromUserId` /
 *     `toUserId` metadata the single-lead path writes plus a `bulk` marker;
 *   - the candidate's WhatsApp thread(s) follow the lead owner.
 *
 * Leads that are already unassigned are skipped, so the count returned is the
 * number of consultants actually released, not the size of the sweep.
 */
export async function releaseLeads(
  leads: { id: string; assignedToId: string | null }[],
  /** Null when the system does the releasing (the lifecycle sweep). */
  actorUserId: string | null,
): Promise<number> {
  const owned = leads.filter(
    (l): l is { id: string; assignedToId: string } => !!l.assignedToId,
  );
  if (owned.length === 0) return 0;
  const ids = owned.map((l) => l.id);

  const byOwner = new Map<string, string[]>();
  for (const l of owned) {
    const list = byOwner.get(l.assignedToId);
    if (list) list.push(l.id);
    else byOwner.set(l.assignedToId, [l.id]);
  }

  await prisma.$transaction([
    prisma.lead.updateMany({
      where: { id: { in: ids } },
      data: { assignedToId: null, assignedAt: null },
    }),
    ...Array.from(byOwner, ([ownerId, leadIds]) =>
      prisma.crmTask.updateMany({
        where: { leadId: { in: leadIds }, status: "open", assignedToId: ownerId },
        data: { assignedToId: null },
      }),
    ),
    prisma.leadActivity.createMany({
      data: owned.map((l) => ({
        leadId: l.id,
        actorId: actorUserId,
        type: "UNASSIGNED",
        summary: "Unassigned — moved to the central pool",
        // centralPool marks a release INTO the pool — see lastCentralPoolOwner.
        metadata: { fromUserId: l.assignedToId, toUserId: null, bulk: true, centralPool: true },
      })),
    }),
  ]);

  // The WhatsApp mirror, set-based: the same rows syncConversationAssignee would
  // touch one lead at a time — threads linked to these leads, plus threads still
  // matched only by number. Best-effort like the mirror itself; the release has
  // already committed and must not be undone by a mirror hiccup.
  try {
    const phones = await prisma.lead.findMany({
      where: { id: { in: ids } },
      select: { phoneE164: true, altPhoneE164: true },
    });
    const numbers = phones
      .flatMap((l) => [l.phoneE164, l.altPhoneE164])
      .filter((n): n is string => !!n);
    await prisma.waConversation.updateMany({
      where: {
        OR: [{ leadId: { in: ids } }, ...(numbers.length ? [{ phoneE164: { in: numbers } }] : [])],
      },
      data: { assignedToId: null },
    });
  } catch {
    // Swallowed deliberately — see above.
  }

  return owned.length;
}
