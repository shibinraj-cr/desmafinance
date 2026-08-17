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
import { leadRowInclude, crmTaskFollowAssignmentWhere, type LeadWithRels } from "./crm-leads";

export async function assignLeadTo(
  leadId: string,
  targetUserId: string | null,
  actorUserId: string,
): Promise<LeadWithRels> {
  const existing = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, assignedToId: true, assignedTo: { select: { username: true } } },
  });
  if (!existing) throw notFound();

  // Validate the new assignee is an active L1/L2 BDE (matches the dropdown).
  let targetName: string | null = null;
  if (targetUserId) {
    const role = await prisma.leadPulseRole.findUnique({
      where: { userId: targetUserId },
      select: { role: true, active: true, displayName: true },
    });
    if (!role || !role.active || (role.role !== "l1" && role.role !== "l2")) {
      throw badRequest("Assignee must be an active L1/L2 BDE", "invalid_assignee");
    }
    targetName = role.displayName;
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
  const updated = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.update({
      where: { id: leadId },
      // Stamp the assignment moment (cleared on unassign) so the list can show an
      // "Assigned" date and filter by it.
      data: { assignedToId: targetUserId, assignedAt: targetUserId ? new Date() : null },
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
    metadata: { fromUserId: existing.assignedToId, toUserId: targetUserId },
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
    });
  }

  // Move the candidate's WhatsApp thread(s) to the new consultant, so the person
  // who now owns the lead is the person who can answer them, whichever surface
  // (Pipeline or inbox) the reassignment started from.
  await syncConversationAssignee(updated.id, targetUserId);

  return updated;
}
