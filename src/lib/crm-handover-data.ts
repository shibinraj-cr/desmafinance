/**
 * The DB side of Lead Handovers (rules: crm-handover.ts).
 *
 *   - saveHandovers: the Marketing Admin's save (one row or a pasted list), H1.
 *   - findOpenHandoversFor / linkHandovers: H2 on the New lead route.
 *   - rejectHandover / reopenHandover: the BDE's Reject, the admin's Reopen.
 *   - markOverdueHandovers / linkArrivedLeads: the lead-cutoff cron (H3, and H2
 *     for leads that reach the BDE by any route other than New lead).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { Permissions } from "./rbac";
import { getCrmAccess } from "./crm-rbac";
import { isActiveBde } from "./crm-leads";
import { loadHolidaySet } from "./ops-dates";
import { nextCutoff } from "./crm-cutoff";
import { fromPrismaDate, istDateString, toPrismaDate } from "./lead-pulse-dates";
import { normalizePhone, phoneMatchKeys } from "./crm";
import { badRequest, conflict, forbidden, notFound } from "./http-error";
import {
  OPEN_HANDOVER_STATUSES,
  canRejectHandover,
  handoverAccess,
  handoverChannel,
  linkStatusFor,
  planHandoverRows,
  type HandoverAccess,
  type HandoverChannel,
  type HandoverRejectReason,
} from "./crm-handover";

export async function getHandoverAccess(userId: string, perms: Permissions | null): Promise<HandoverAccess> {
  const [crm, lpRole] = await Promise.all([
    getCrmAccess(userId, perms),
    prisma.leadPulseRole.findUnique({ where: { userId }, select: { role: true, active: true } }),
  ]);
  return handoverAccess({
    isAdmin: crm.isAdmin,
    roleName: perms?.roleName,
    lpRole,
    canManageCrm: crm.canManageCrm,
    isCrmTeamLead: crm.isCrmTeamLead,
    isBde: crm.isBde,
  });
}

/** The lead source for a channel, by code, else by label (an admin may have made it by hand). */
export async function resolveHandoverSourceId(channel: string): Promise<string | null> {
  const c = handoverChannel(channel);
  if (!c) return null;
  const byCode = await prisma.leadPulseSource.findUnique({ where: { code: c.sourceCode }, select: { id: true } });
  if (byCode) return byCode.id;
  const byLabel = await prisma.leadPulseSource.findFirst({
    where: { label: { equals: c.sourceLabel, mode: "insensitive" } },
    select: { id: true },
  });
  return byLabel?.id ?? null;
}

/** Each number's canonical lead (the oldest), matched on primary and alternate phones. */
async function leadsByPhone(phones: string[]): Promise<Map<string, { id: string; assignedToId: string | null }>> {
  const out = new Map<string, { id: string; assignedToId: string | null }>();
  if (phones.length === 0) return out;
  const leads = await prisma.lead.findMany({
    where: { OR: [{ phoneE164: { in: phones } }, { altPhoneE164: { in: phones } }] },
    select: { id: true, assignedToId: true, phoneE164: true, altPhoneE164: true },
    orderBy: { createdAt: "asc" },
  });
  for (const l of leads) {
    for (const ph of phoneMatchKeys(l.phoneE164, l.altPhoneE164)) {
      if (!out.has(ph)) out.set(ph, { id: l.id, assignedToId: l.assignedToId });
    }
  }
  return out;
}

export type SavedHandover = {
  id: string;
  leadName: string | null;
  phoneE164: string;
  status: "pending" | "duplicate";
  linkedLeadId: string | null;
  /** For a duplicate: who owns the existing lead (null when nobody does). */
  existingOwnerId: string | null;
  dueAt: Date;
};

export async function saveHandovers(input: {
  channel: HandoverChannel;
  assignedBdeId: string;
  rows: { leadName?: string | null; phone: string; note?: string | null }[];
  actorId: string;
  now?: Date;
}): Promise<{ saved: SavedHandover[]; errors: { index: number; phone: string; reason: string }[] }> {
  const now = input.now ?? new Date();
  if (!(await isActiveBde(input.assignedBdeId))) {
    throw badRequest("Pick an active L1/L2 BDE.", "invalid_assignee");
  }

  const phones = [...new Set(input.rows.map((r) => normalizePhone(r.phone)).filter((p): p is string => !!p))];
  const [leads, open] = await Promise.all([
    leadsByPhone(phones),
    prisma.crmLeadHandover.findMany({
      where: { phoneE164: { in: phones }, status: { in: OPEN_HANDOVER_STATUSES } },
      select: { phoneE164: true },
    }),
  ]);
  const final = planHandoverRows(
    input.rows,
    new Map([...leads].map(([ph, l]) => [ph, l.id])),
    new Set(open.map((h) => h.phoneE164)),
  );

  const dueAt = nextCutoff(now, await loadHolidaySet(prisma));
  const handoverDate = toPrismaDate(istDateString(now));
  const errors: { index: number; phone: string; reason: string }[] = [];
  const data: Prisma.CrmLeadHandoverCreateManyInput[] = [];
  final.forEach((p, i) => {
    const row = input.rows[i];
    if (p.kind === "error") {
      errors.push({ index: i, phone: row.phone, reason: p.reason });
      return;
    }
    data.push({
      handoverDate,
      channel: input.channel,
      leadName: row.leadName?.trim() || null,
      phone: row.phone.trim(),
      phoneE164: p.phoneE164,
      assignedBdeId: input.assignedBdeId,
      note: row.note?.trim() || null,
      status: p.kind,
      linkedLeadId: p.kind === "duplicate" ? p.leadId : null,
      dueAt,
      createdById: input.actorId,
      createdAt: now,
      // A duplicate is settled the moment it is saved.
      ...(p.kind === "duplicate" ? { actionedAt: now, actionedById: input.actorId } : {}),
    });
  });

  const created = data.length
    ? await prisma.crmLeadHandover.createManyAndReturn({
        data,
        select: { id: true, leadName: true, phoneE164: true, status: true, linkedLeadId: true, dueAt: true },
      })
    : [];
  return {
    saved: created.map((h) => ({
      ...h,
      status: h.status as "pending" | "duplicate",
      existingOwnerId: h.status === "duplicate" ? (leads.get(h.phoneE164)?.assignedToId ?? null) : null,
    })),
    errors,
  };
}

/**
 * Open handovers a new lead for `bdeId` settles: any for one of its numbers,
 * plus the one the BDE started from (`handoverId`), if it is theirs and open.
 */
export async function findOpenHandoversFor(
  bdeId: string,
  phones: string[],
  handoverId?: string | null,
): Promise<{ id: string; channel: string }[]> {
  const or: Prisma.CrmLeadHandoverWhereInput[] = [];
  if (phones.length) or.push({ phoneE164: { in: phones } });
  if (handoverId) or.push({ id: handoverId });
  if (or.length === 0) return [];
  return prisma.crmLeadHandover.findMany({
    where: { assignedBdeId: bdeId, status: { in: OPEN_HANDOVER_STATUSES }, OR: or },
    select: { id: true, channel: true },
    orderBy: { createdAt: "asc" },
  });
}

/** Settle open handovers against a lead. Returns how many changed (0 if someone got there first). */
export async function linkHandovers(
  ids: string[],
  leadId: string,
  status: "created" | "duplicate",
  actorId: string | null,
  now: Date = new Date(),
): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await prisma.crmLeadHandover.updateMany({
    where: { id: { in: ids }, status: { in: OPEN_HANDOVER_STATUSES } },
    data: { status, linkedLeadId: leadId, actionedAt: now, actionedById: actorId },
  });
  return res.count;
}

async function loadHandover(id: string) {
  const h = await prisma.crmLeadHandover.findUnique({
    where: { id },
    select: { id: true, status: true, assignedBdeId: true },
  });
  if (!h) throw notFound();
  return h;
}

export async function rejectHandover(input: {
  id: string;
  access: HandoverAccess;
  actorId: string;
  reason: HandoverRejectReason;
  note?: string | null;
  now?: Date;
}): Promise<void> {
  const h = await loadHandover(input.id);
  if (!canRejectHandover(input.access, input.actorId, h)) throw forbidden();
  const note = input.note?.trim() || null;
  if (input.reason === "other" && !note) throw badRequest("Say why it is being rejected.", "reject_note_required");
  const res = await prisma.crmLeadHandover.updateMany({
    where: { id: h.id, status: { in: OPEN_HANDOVER_STATUSES } },
    data: {
      status: "rejected",
      rejectReason: input.reason,
      rejectNote: note,
      actionedAt: input.now ?? new Date(),
      actionedById: input.actorId,
    },
  });
  if (res.count === 0) throw conflict("This handover is no longer open.", "handover_not_open");
}

/** Rejected → pending, with a fresh deadline from now. `isLate` is kept. */
export async function reopenHandover(input: { id: string; access: HandoverAccess; actorId: string; now?: Date }) {
  if (!input.access.canManage) throw forbidden();
  const now = input.now ?? new Date();
  const h = await loadHandover(input.id);
  const res = await prisma.crmLeadHandover.updateMany({
    where: { id: h.id, status: "rejected" },
    data: {
      status: "pending",
      rejectReason: null,
      rejectNote: null,
      dueAt: nextCutoff(now, await loadHolidaySet(prisma)),
      actionedAt: now,
      actionedById: input.actorId,
    },
  });
  if (res.count === 0) throw conflict("Only a rejected handover can be reopened.", "handover_not_rejected");
}

/** H3: pending past its deadline → overdue (and late for good). */
export async function markOverdueHandovers(now: Date = new Date()): Promise<number> {
  const res = await prisma.crmLeadHandover.updateMany({
    where: { status: "pending", dueAt: { lt: now } },
    data: { status: "overdue", isLate: true },
  });
  return res.count;
}

/**
 * H2 for leads that reach the BDE by any route other than New lead — a
 * WhatsApp message, a Voxbay call, an import, an assignment. Every open
 * handover whose number now belongs to a lead owned by its BDE is settled; a
 * lead created after the handover takes its channel as the lead source.
 */
export async function linkArrivedLeads(now: Date = new Date()): Promise<number> {
  const open = await prisma.crmLeadHandover.findMany({
    where: { status: { in: OPEN_HANDOVER_STATUSES } },
    select: { id: true, phoneE164: true, assignedBdeId: true, channel: true, createdAt: true },
  });
  if (open.length === 0) return 0;
  const phones = [...new Set(open.map((h) => h.phoneE164))];
  const leads = await prisma.lead.findMany({
    where: { assignedToId: { not: null }, OR: [{ phoneE164: { in: phones } }, { altPhoneE164: { in: phones } }] },
    select: { id: true, assignedToId: true, phoneE164: true, altPhoneE164: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  let linked = 0;
  for (const h of open) {
    const lead = leads.find(
      (l) => l.assignedToId === h.assignedBdeId && phoneMatchKeys(l.phoneE164, l.altPhoneE164).includes(h.phoneE164),
    );
    if (!lead) continue;
    const status = linkStatusFor(lead.createdAt, h.createdAt);
    const n = await linkHandovers([h.id], lead.id, status, null, now);
    if (n && status === "created") {
      const sourceId = await resolveHandoverSourceId(h.channel);
      if (sourceId) await prisma.lead.update({ where: { id: lead.id }, data: { sourceId } });
    }
    linked += n;
  }
  return linked;
}

export const HANDOVER_LIST_LIMIT = 500;

const listSelect = {
  id: true,
  handoverDate: true,
  channel: true,
  leadName: true,
  phone: true,
  phoneE164: true,
  note: true,
  status: true,
  isLate: true,
  rejectReason: true,
  rejectNote: true,
  dueAt: true,
  createdAt: true,
  actionedAt: true,
  assignedBde: { select: { id: true, username: true, leadPulseRole: { select: { displayName: true } } } },
  createdBy: { select: { username: true, leadPulseRole: { select: { displayName: true } } } },
  actionedBy: { select: { username: true, leadPulseRole: { select: { displayName: true } } } },
  linkedLead: { select: { id: true, candidateName: true, assignedTo: { select: { username: true, leadPulseRole: { select: { displayName: true } } } } } },
} satisfies Prisma.CrmLeadHandoverSelect;

type PersonRef = { username: string; leadPulseRole: { displayName: string } | null } | null;
const nameOf = (u: PersonRef) => (u ? (u.leadPulseRole?.displayName ?? u.username) : null);

export type HandoverRow = {
  id: string;
  handoverDate: string;
  channel: string;
  leadName: string | null;
  phone: string;
  phoneE164: string;
  note: string | null;
  status: string;
  isLate: boolean;
  rejectReason: string | null;
  rejectNote: string | null;
  dueAt: string;
  createdAt: string;
  actionedAt: string | null;
  assignedBde: { id: string; name: string };
  createdByName: string | null;
  actionedByName: string | null;
  linkedLead: { id: string; candidateName: string; ownerName: string | null } | null;
};

export async function listHandovers(where: Prisma.CrmLeadHandoverWhereInput): Promise<HandoverRow[]> {
  const rows = await prisma.crmLeadHandover.findMany({
    where,
    select: listSelect,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: HANDOVER_LIST_LIMIT,
  });
  return rows.map((h) => ({
    id: h.id,
    handoverDate: fromPrismaDate(h.handoverDate),
    channel: h.channel,
    leadName: h.leadName,
    phone: h.phone,
    phoneE164: h.phoneE164,
    note: h.note,
    status: h.status,
    isLate: h.isLate,
    rejectReason: h.rejectReason,
    rejectNote: h.rejectNote,
    dueAt: h.dueAt.toISOString(),
    createdAt: h.createdAt.toISOString(),
    actionedAt: h.actionedAt?.toISOString() ?? null,
    assignedBde: { id: h.assignedBde.id, name: nameOf(h.assignedBde)! },
    createdByName: nameOf(h.createdBy),
    actionedByName: nameOf(h.actionedBy),
    linkedLead: h.linkedLead
      ? { id: h.linkedLead.id, candidateName: h.linkedLead.candidateName, ownerName: nameOf(h.linkedLead.assignedTo) }
      : null,
  }));
}
