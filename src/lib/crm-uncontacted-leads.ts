/**
 * The query behind the uncontacted-lead alarm — see crm-uncontacted-alarm.ts
 * for the rules. Server-only (prisma).
 */
import { prisma } from "./prisma";
import { NEW_LEAD_STATUS_CODE } from "./crm-leads";
import { outboundContactWhere } from "./crm-team";
import {
  UNCONTACTED_LIST_LIMIT,
  uncontactedCutoff,
  contactedSinceAssignment,
  type UncontactedScope,
  type UncontactedSnapshot,
} from "./crm-uncontacted-alarm";

export async function uncontactedLeadsFor(
  userId: string,
  scope: UncontactedScope,
  now: Date = new Date(),
): Promise<UncontactedSnapshot> {
  const cutoff = uncontactedCutoff(now);
  const where = {
    status: { code: NEW_LEAD_STATUS_CODE },
    assignedToId: scope === "own" ? userId : { not: null },
    // assignedAt is stamped on every assignment; a legacy row without it is
    // judged by when it was created rather than silently skipped.
    OR: [{ assignedAt: { lte: cutoff } }, { assignedAt: null, createdAt: { lte: cutoff } }],
  };

  // Still-New leads past the window, oldest assignment first. A lead someone
  // has already called / messaged since it was assigned is NOT uncontacted, even
  // if the stage hasn't been moved yet — doing the work is what clears the alarm.
  // Prisma can't compare an activity's time to its lead's assignedAt, so the
  // last human contact per lead is fetched and compared here.
  const [candidates, status] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: [{ assignedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
      select: { id: true, assignedAt: true, createdAt: true },
    }),
    prisma.crmLeadStatus.findUnique({ where: { code: NEW_LEAD_STATUS_CODE }, select: { id: true } }),
  ]);
  const lastContact = candidates.length
    ? await prisma.leadActivity.groupBy({
        by: ["leadId"],
        where: { leadId: { in: candidates.map((c) => c.id) }, ...outboundContactWhere() },
        _max: { occurredAt: true },
      })
    : [];
  const contactByLead = new Map(lastContact.map((g) => [g.leadId, g._max.occurredAt]));
  const pending = candidates.filter(
    (c) => !contactedSinceAssignment(c.assignedAt ?? c.createdAt, contactByLead.get(c.id) ?? null),
  );

  const pageIds = pending.slice(0, UNCONTACTED_LIST_LIMIT).map((c) => c.id);
  const rows = pageIds.length
    ? await prisma.lead.findMany({
        where: { id: { in: pageIds } },
        select: {
          id: true,
          candidateName: true,
          phone: true,
          assignedAt: true,
          createdAt: true,
          source: { select: { label: true } },
          assignedTo: { select: { username: true, leadPulseRole: { select: { displayName: true } } } },
        },
      })
    : [];
  const order = new Map(pageIds.map((id, i) => [id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return {
    scope,
    total: pending.length,
    newStatusId: status?.id ?? null,
    leads: rows.map((l) => ({
      id: l.id,
      candidateName: l.candidateName,
      phone: l.phone,
      assignedAt: (l.assignedAt ?? l.createdAt).toISOString(),
      assigneeName: l.assignedTo?.leadPulseRole?.displayName ?? l.assignedTo?.username ?? null,
      source: l.source?.label ?? null,
    })),
  };
}
