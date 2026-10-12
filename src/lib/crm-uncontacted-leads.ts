/**
 * The query behind the uncontacted-lead alarm — see crm-uncontacted-alarm.ts
 * for the rules. Server-only (prisma).
 */
import { prisma } from "./prisma";
import { NEW_LEAD_STATUS_CODE } from "./crm-leads";
import {
  UNCONTACTED_LIST_LIMIT,
  uncontactedCutoff,
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
  const [total, rows, status] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: [{ assignedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
      take: UNCONTACTED_LIST_LIMIT,
      select: {
        id: true,
        candidateName: true,
        phone: true,
        assignedAt: true,
        createdAt: true,
        source: { select: { label: true } },
        assignedTo: { select: { username: true, leadPulseRole: { select: { displayName: true } } } },
      },
    }),
    prisma.crmLeadStatus.findUnique({ where: { code: NEW_LEAD_STATUS_CODE }, select: { id: true } }),
  ]);
  return {
    scope,
    total,
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
