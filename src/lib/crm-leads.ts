import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// Shared include + serialiser so the list API, detail page and import flow all
// emit the same plain (serialisable) row shape to client components.
export const leadRowInclude = Prisma.validator<Prisma.LeadInclude>()({
  source: { select: { id: true, label: true } },
  service: { select: { id: true, name: true } },
  qualification: { select: { id: true, label: true } },
  status: { select: { id: true, code: true, label: true, kind: true, color: true } },
  assignedTo: {
    select: { id: true, username: true, leadPulseRole: { select: { displayName: true } } },
  },
  party: { select: { id: true, name: true } },
});

export type LeadWithRels = Prisma.LeadGetPayload<{ include: typeof leadRowInclude }>;

export type LeadRow = {
  id: string;
  createdAt: string;
  lastActivityAt: string;
  candidateName: string;
  email: string | null;
  phone: string | null;
  phoneE164: string | null;
  source: { id: string; label: string } | null;
  service: { id: string; name: string } | null;
  qualification: { id: string; label: string } | null;
  status: { id: string; code: string; label: string; kind: string; color: string | null };
  assignedTo: { id: string; name: string } | null;
  party: { id: string; name: string } | null;
  campaign: string | null;
  dedupeKey: string | null;
  importBatchId: string | null;
  extra: Record<string, string> | null;
};

export function serializeLead(l: LeadWithRels): LeadRow {
  return {
    id: l.id,
    createdAt: l.createdAt.toISOString(),
    lastActivityAt: l.lastActivityAt.toISOString(),
    candidateName: l.candidateName,
    email: l.email,
    phone: l.phone,
    phoneE164: l.phoneE164,
    source: l.source ? { id: l.source.id, label: l.source.label } : null,
    service: l.service ? { id: l.service.id, name: l.service.name } : null,
    qualification: l.qualification ? { id: l.qualification.id, label: l.qualification.label } : null,
    status: {
      id: l.status.id,
      code: l.status.code,
      label: l.status.label,
      kind: l.status.kind,
      color: l.status.color,
    },
    assignedTo: l.assignedTo
      ? { id: l.assignedTo.id, name: l.assignedTo.leadPulseRole?.displayName ?? l.assignedTo.username }
      : null,
    party: l.party ? { id: l.party.id, name: l.party.name } : null,
    campaign: l.campaign,
    dedupeKey: l.dedupeKey,
    importBatchId: l.importBatchId,
    extra: (l.extra as Record<string, string> | null) ?? null,
  };
}

export type LeadFilterParams = {
  status?: string;
  source?: string;
  service?: string;
  assignee?: string;
  campaign?: string;
  q?: string;
  /** Resolved half-open createdAt range (e.g. from `rangeFor(parsePeriod(...))`). `to` is exclusive. */
  from?: Date;
  to?: Date;
};

/** Build the Prisma `where` for the leads list. Shared by the list page and the GET API so they never drift. */
export function buildLeadWhere(p: LeadFilterParams): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {};
  if (p.status) where.statusId = p.status;
  if (p.source) where.sourceId = p.source;
  if (p.service) where.serviceId = p.service;
  if (p.assignee === "unassigned") where.assignedToId = null;
  else if (p.assignee) where.assignedToId = p.assignee;
  if (p.campaign) where.campaign = p.campaign;
  const q = p.q?.trim();
  if (q) {
    const or: Prisma.LeadWhereInput[] = [
      { candidateName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
      { phoneE164: { contains: q } },
    ];
    // Format-agnostic phone search: match the bare digits against the normalized
    // phoneE164 (and raw phone), so "+91 78142 95082" also finds a lead stored as
    // "917814295082" / "7814295082" and vice-versa.
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 4) {
      or.push({ phoneE164: { contains: digits } });
      or.push({ phone: { contains: digits } });
    }
    where.OR = or;
  }
  if (p.from || p.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (p.from) createdAt.gte = p.from;
    if (p.to) createdAt.lt = p.to;
    where.createdAt = createdAt;
  }
  return where;
}

export function leadOrderBy(sort?: string): Prisma.LeadOrderByWithRelationInput {
  switch (sort) {
    case "created_asc":
      return { createdAt: "asc" };
    case "activity_desc":
      return { lastActivityAt: "desc" };
    case "name_asc":
      return { candidateName: "asc" };
    default:
      return { createdAt: "desc" };
  }
}

/** The status new leads start in: the explicit default, else the first active by order. */
export async function resolveDefaultStatus() {
  const def = await prisma.crmLeadStatus.findFirst({
    where: { isDefault: true, active: true },
    orderBy: { displayOrder: "asc" },
  });
  if (def) return def;
  return prisma.crmLeadStatus.findFirst({
    where: { active: true },
    orderBy: { displayOrder: "asc" },
  });
}

export function getDuplicateStatus() {
  return prisma.crmLeadStatus.findUnique({ where: { code: "duplicate" } });
}

// ── Notes ───────────────────────────────────────────────────────────────────
export const noteInclude = Prisma.validator<Prisma.LeadNoteInclude>()({
  author: { select: { id: true, username: true, leadPulseRole: { select: { displayName: true } } } },
});
export type NoteWithAuthor = Prisma.LeadNoteGetPayload<{ include: typeof noteInclude }>;

export type NoteRow = {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string;
  editedAt: string | null;
  createdAt: string;
};

export function serializeNote(n: NoteWithAuthor): NoteRow {
  return {
    id: n.id,
    body: n.body,
    authorId: n.authorId,
    authorName: n.author?.leadPulseRole?.displayName ?? n.author?.username ?? "Unknown",
    editedAt: n.editedAt ? n.editedAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

// ── Activities (Timeline + admin History) ──────────────────────────────────
export const activityInclude = Prisma.validator<Prisma.LeadActivityInclude>()({
  actor: { select: { id: true, username: true, leadPulseRole: { select: { displayName: true } } } },
});
export type ActivityWithActor = Prisma.LeadActivityGetPayload<{ include: typeof activityInclude }>;

export type ActivityRow = {
  id: string;
  type: string;
  summary: string | null;
  actorName: string | null;
  occurredAt: string;
  metadata?: unknown;
};

/** Activity types hidden from the lighter Timeline (passive/admin-only noise). */
export const TIMELINE_HIDDEN_TYPES: ReadonlySet<string> = new Set(["LEAD_OPENED"]);

export function serializeActivity(
  a: ActivityWithActor,
  opts: { includeMetadata: boolean },
): ActivityRow {
  return {
    id: a.id,
    type: a.type,
    summary: a.summary,
    actorName: a.actor?.leadPulseRole?.displayName ?? a.actor?.username ?? null,
    occurredAt: a.occurredAt.toISOString(),
    ...(opts.includeMetadata ? { metadata: a.metadata ?? null } : {}),
  };
}

// ── Tasks (per-lead follow-ups) ─────────────────────────────────────────────
export const taskInclude = Prisma.validator<Prisma.CrmTaskInclude>()({
  assignedTo: { select: { id: true, username: true, leadPulseRole: { select: { displayName: true } } } },
});
export type TaskWithRels = Prisma.CrmTaskGetPayload<{ include: typeof taskInclude }>;

export type TaskRow = {
  id: string;
  subject: string;
  dueAt: string | null;
  priority: string; // 'low' | 'normal' | 'high'
  status: string; // 'open' | 'done'
  note: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  completedAt: string | null;
  createdAt: string;
};

export function serializeTask(t: TaskWithRels): TaskRow {
  return {
    id: t.id,
    subject: t.subject,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    priority: t.priority,
    status: t.status,
    note: t.note,
    assignedToId: t.assignedToId,
    assignedToName: t.assignedTo
      ? t.assignedTo.leadPulseRole?.displayName ?? t.assignedTo.username
      : null,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
  };
}

/** Open tasks first (by due date, soonest first), then completed. */
export const taskOrderBy: Prisma.CrmTaskOrderByWithRelationInput[] = [
  { status: "desc" }, // 'open' > 'done' alphabetically, so desc lists open first
  { dueAt: "asc" },
  { createdAt: "desc" },
];

export type BdeOption = {
  userId: string;
  displayName: string;
  username: string;
  role: string;
};

/** True when the user is an active L1/L2 BDE (the only valid lead assignees). */
export async function isActiveBde(userId: string): Promise<boolean> {
  const role = await prisma.leadPulseRole.findUnique({
    where: { userId },
    select: { role: true, active: true },
  });
  return !!role && role.active && (role.role === "l1" || role.role === "l2");
}

/** Assignable consultants — active L1/L2 BDEs from the Lead Pulse roster. */
export async function getAssignableBdes(): Promise<BdeOption[]> {
  const roles = await prisma.leadPulseRole.findMany({
    where: { active: true, role: { in: ["l1", "l2"] } },
    include: { user: { select: { id: true, username: true } } },
    orderBy: [{ displayName: "asc" }],
  });
  return roles.map((r) => ({
    userId: r.userId,
    displayName: r.displayName,
    username: r.user.username,
    role: r.role,
  }));
}
