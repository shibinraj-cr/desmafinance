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
  pipeline: { select: { status: true } },
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
  expectedValue: number | null;
  expectedCloseDate: string | null;
  pipelineStatus: string | null; // 'open' | 'closed_won' | 'lost' (from the linked pipeline)
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
    expectedValue: l.expectedValue ? Number(l.expectedValue) : null,
    expectedCloseDate: l.expectedCloseDate ? l.expectedCloseDate.toISOString() : null,
    pipelineStatus: l.pipeline?.status ?? null,
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

/**
 * The status code that marks a freshly-assigned, not-yet-worked lead. A lead
 * leaves this bucket the moment the BDE moves it forward, so "new leads
 * assigned to me" is self-maintaining.
 */
export const NEW_LEAD_STATUS_CODE = "not_yet_started";

/**
 * Count of fresh leads currently assigned to `userId` (status "not_yet_started").
 * Powers the CRM nav badge and the "My new leads" quick filter so a BDE knows
 * when new leads land in their queue. Returns 0 on any error (badge is
 * best-effort, must never break a page render).
 */
export async function countNewLeadsAssignedTo(userId: string): Promise<number> {
  return prisma.lead
    .count({ where: { assignedToId: userId, status: { code: NEW_LEAD_STATUS_CODE } } })
    .catch(() => 0);
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

// ── Cross-lead task board (the "Tasks" tab) ─────────────────────────────────
// A flat, filterable list of every lead's tasks for all BDEs + admins. Shares
// the per-lead task mutation routes; only the listing lives here.

export const crmTaskListInclude = Prisma.validator<Prisma.CrmTaskInclude>()({
  assignedTo: { select: { id: true, username: true, leadPulseRole: { select: { displayName: true } } } },
  lead: {
    select: {
      id: true,
      candidateName: true,
      phone: true,
      phoneE164: true,
      // Drives the canEdit rule (admin, or the lead's own BDE) — identical to
      // the per-task PATCH route's `canEditLead(access, task.lead, userId)`.
      assignedToId: true,
      status: { select: { label: true, color: true } },
    },
  },
});
export type CrmTaskWithRels = Prisma.CrmTaskGetPayload<{ include: typeof crmTaskListInclude }>;

export type CrmTaskListRow = {
  id: string;
  leadId: string;
  subject: string;
  dueAt: string | null;
  priority: string; // 'low' | 'normal' | 'high'
  status: string; // 'open' | 'done'
  note: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  completedAt: string | null;
  createdAt: string;
  lead: {
    id: string;
    candidateName: string;
    phone: string | null;
    phoneE164: string | null;
    assignedToId: string | null;
    status: { label: string; color: string | null };
  };
};

export function serializeCrmTaskListRow(t: CrmTaskWithRels): CrmTaskListRow {
  return {
    id: t.id,
    leadId: t.leadId,
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
    lead: {
      id: t.lead.id,
      candidateName: t.lead.candidateName,
      phone: t.lead.phone,
      phoneE164: t.lead.phoneE164,
      assignedToId: t.lead.assignedToId,
      status: { label: t.lead.status.label, color: t.lead.status.color },
    },
  };
}

export type CrmTaskFilterParams = {
  status?: string; // 'open' | 'done' (undefined = all)
  assignee?: string; // userId | 'unassigned'
  priority?: string; // 'low' | 'normal' | 'high'
  due?: string; // 'overdue' | 'today' | 'week' | 'no_date'
  q?: string; // matches task subject OR lead name
  /** Injected "now" so date math is stable within a request. */
  now?: Date;
};

/** Midnight (local) at the start of `d`. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Build the Prisma `where` for the cross-lead task list. */
export function buildCrmTaskWhere(p: CrmTaskFilterParams): Prisma.CrmTaskWhereInput {
  const where: Prisma.CrmTaskWhereInput = {};
  if (p.status === "open" || p.status === "done") where.status = p.status;
  if (p.assignee === "unassigned") where.assignedToId = null;
  else if (p.assignee) where.assignedToId = p.assignee;
  if (p.priority === "low" || p.priority === "normal" || p.priority === "high") {
    where.priority = p.priority;
  }

  const today = startOfDay(p.now ?? new Date());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (p.due === "overdue") {
    where.dueAt = { lt: today };
    where.status = "open"; // only open tasks can be overdue
  } else if (p.due === "today") {
    where.dueAt = { gte: today, lt: tomorrow };
  } else if (p.due === "week") {
    where.dueAt = { gte: today, lt: weekEnd };
  } else if (p.due === "no_date") {
    where.dueAt = null;
  }

  const q = p.q?.trim();
  if (q) {
    where.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { lead: { candidateName: { contains: q, mode: "insensitive" } } },
    ];
  }
  return where;
}

/** Ordering for the task board. Open-relevant sorts keep null due dates last. */
export function crmTaskListOrderBy(sort?: string): Prisma.CrmTaskOrderByWithRelationInput[] {
  switch (sort) {
    case "due_desc":
      return [{ dueAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
    case "created_desc":
      return [{ createdAt: "desc" }];
    case "created_asc":
      return [{ createdAt: "asc" }];
    case "due_asc":
    default:
      // Open first, then soonest due (nulls last), then newest.
      return [{ status: "desc" }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }];
  }
}

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
