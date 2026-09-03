import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ageFromDob, dobRangeForAge } from "./age";
import { normalizeTemperature, type LeadTemperature } from "./crm";
import { listParam, oneOf, oneParam } from "./filter-params";
import { parseAgeParam } from "./age";
import { parsePeriod, rangeFor } from "./period";

// Kept as a literal rather than importing REMARKETING_STATUS_CODE from
// crm-reinquiry: this module is type-imported by client components, and
// crm-reinquiry pulls in the mailer (nodemailer), which breaks the client
// bundle. Must stay in sync with crm-reinquiry.REMARKETING_STATUS_CODE.
const REMARKETING_STATUS_CODE = "re_marketing";

// Shared include + serialiser so the list API, detail page and import flow all
// emit the same plain (serialisable) row shape to client components.
export const leadRowInclude = Prisma.validator<Prisma.LeadInclude>()({
  source: { select: { id: true, label: true } },
  service: { select: { id: true, name: true, isStudyAbroad: true } },
  qualification: { select: { id: true, label: true } },
  status: { select: { id: true, code: true, label: true, kind: true, color: true } },
  assignedTo: {
    select: { id: true, username: true, leadPulseRole: { select: { displayName: true, phone: true } } },
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
  altPhone: string | null;
  altPhoneE164: string | null;
  source: { id: string; label: string } | null;
  service: { id: string; name: string } | null;
  qualification: { id: string; label: string } | null;
  status: { id: string; code: string; label: string; kind: string; color: string | null };
  assignedTo: { id: string; name: string; phone: string | null } | null;
  assignedAt: string | null;
  party: { id: string; name: string } | null;
  campaign: string | null;
  /** Hot / Warm / Cold rating (`'hot' | 'warm' | 'cold'`), or null if unrated. */
  temperature: LeadTemperature | null;
  /** Official date of birth as `YYYY-MM-DD` (date-only), or null. */
  dob: string | null;
  /** Age in whole years, derived from `dob` at serialize time (always current). */
  age: number | null;
  country: string | null;
  studyDestination: string | null;
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
    altPhone: l.altPhone,
    altPhoneE164: l.altPhoneE164,
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
      ? {
          id: l.assignedTo.id,
          name: l.assignedTo.leadPulseRole?.displayName ?? l.assignedTo.username,
          phone: l.assignedTo.leadPulseRole?.phone ?? null,
        }
      : null,
    assignedAt: l.assignedAt ? l.assignedAt.toISOString() : null,
    party: l.party ? { id: l.party.id, name: l.party.name } : null,
    campaign: l.campaign,
    temperature: normalizeTemperature(l.temperature),
    // Date-only ISO (drop the time) + age derived relative to now.
    dob: l.dob ? l.dob.toISOString().slice(0, 10) : null,
    age: ageFromDob(l.dob, new Date()),
    country: l.country,
    studyDestination: l.studyDestination,
    expectedValue: l.expectedValue ? Number(l.expectedValue) : null,
    expectedCloseDate: l.expectedCloseDate ? l.expectedCloseDate.toISOString() : null,
    pipelineStatus: l.pipeline?.status ?? null,
    dedupeKey: l.dedupeKey,
    importBatchId: l.importBatchId,
    extra: (l.extra as Record<string, string> | null) ?? null,
  };
}

/**
 * Every categorical filter takes one value or many: pass a bare string for a
 * single pick (a drill-down link, a saved bookmark) or an array for a
 * multi-select, and the builder emits `=` or `IN (...)` accordingly.
 */
export type MultiFilterValue = string | string[] | undefined;

export type LeadFilterParams = {
  status?: MultiFilterValue;
  source?: MultiFilterValue;
  service?: MultiFilterValue;
  /**
   * Consultant filter. UserIds restrict to those BDEs; `"unassigned"` matches
   * leads with no consultant (and combines with userIds as an OR); `"all"` (or
   * undefined) applies no assignee filter. Resolve the raw query value through
   * {@link resolveAssigneeFilter} first so the BDE "my leads" default is
   * applied consistently.
   */
  assignee?: MultiFilterValue;
  campaign?: MultiFilterValue;
  /** Lead temperature codes (`'hot' | 'warm' | 'cold'`). Invalid values are ignored. */
  temperature?: MultiFilterValue;
  country?: MultiFilterValue;
  studyDestination?: MultiFilterValue;
  /** Inclusive minimum age in years (translated to a `dob` upper bound). */
  ageMin?: number;
  /** Inclusive maximum age in years (translated to a `dob` lower bound). */
  ageMax?: number;
  q?: string;
  /** Resolved half-open createdAt range (e.g. from `rangeFor(parsePeriod(...))`). `to` is exclusive. */
  from?: Date;
  to?: Date;
  /** Half-open assignedAt range — "leads assigned on/within these dates". `assignedTo` is exclusive. */
  assignedFrom?: Date;
  assignedTo?: Date;
  /** Injected "now" so the age→dob translation is stable within a request/test. */
  now?: Date;
};

/**
 * Half-open `[start, nextDay)` range for the local calendar day `YYYY-MM-DD`,
 * used by the "assigned on <date>" filter. Returns null if unparseable.
 * Built with the numeric Date constructor so the boundaries are server-local
 * midnight — matching how the leads list renders assigned/created timestamps.
 */
export function assignedDayRange(day: string | undefined): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((day ?? "").trim());
  if (!m) return null;
  const from = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(from.getTime())) return null;
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * Apply the consultant filter. Unlike the other multi-selects this one mixes
 * real userIds with two sentinels, so it can't collapse to a plain `IN`:
 *
 *  - `"all"` anywhere in the selection is the BDE "All leads" opt-out and wins
 *    outright — no assignee filter at all.
 *  - `"unassigned"` matches `assignedToId IS NULL`, which combines with picked
 *    userIds as an OR ("Unassigned + Priya" = both piles).
 *
 * The OR goes into `where.AND` rather than `where.OR`, which the free-text `q`
 * search already owns — the two must intersect, not union.
 */
function assignedToFilter(where: Prisma.LeadWhereInput, raw: MultiFilterValue): void {
  const values = listParam(raw);
  if (values.length === 0 || values.includes("all")) return;
  const unassigned = values.includes("unassigned");
  const userIds = values.filter((v) => v !== "unassigned");
  if (unassigned && userIds.length > 0) {
    const or: Prisma.LeadWhereInput[] = [{ assignedToId: null }, { assignedToId: oneOf(userIds) }];
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { OR: or }];
    return;
  }
  where.assignedToId = unassigned ? null : oneOf(userIds);
}

/** Build the Prisma `where` for the leads list. Shared by the list page and the GET API so they never drift. */
export function buildLeadWhere(p: LeadFilterParams): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {};
  // Each of these is `=` for one pick, `IN (...)` for several, absent for none.
  const statusId = oneOf(listParam(p.status));
  if (statusId !== undefined) where.statusId = statusId;
  const sourceId = oneOf(listParam(p.source));
  if (sourceId !== undefined) where.sourceId = sourceId;
  const serviceId = oneOf(listParam(p.service));
  if (serviceId !== undefined) where.serviceId = serviceId;
  assignedToFilter(where, p.assignee);
  const campaign = oneOf(listParam(p.campaign));
  if (campaign !== undefined) where.campaign = campaign;
  // Only apply the temperature filter for recognised codes (guards against a
  // stray/legacy query value silently matching nothing).
  const temperature = oneOf(
    listParam(p.temperature)
      .map(normalizeTemperature)
      .filter((t): t is LeadTemperature => !!t),
  );
  if (temperature !== undefined) where.temperature = temperature;
  const country = oneOf(listParam(p.country));
  if (country !== undefined) where.country = country;
  const studyDestination = oneOf(listParam(p.studyDestination));
  if (studyDestination !== undefined) where.studyDestination = studyDestination;
  // Age filter → indexed `dob` range. A candidate with no dob never matches an
  // age filter (dob IS NULL is excluded by a gte/lte bound), which is intended.
  if (p.ageMin !== undefined || p.ageMax !== undefined) {
    const dob = dobRangeForAge(p.ageMin, p.ageMax, p.now ?? new Date());
    if (dob) where.dob = dob;
  }
  const q = p.q?.trim();
  if (q) {
    // An "@" makes this unambiguously an email search — match the email only.
    // Otherwise the query's stray digits leak into the phone match below: e.g.
    // "srisubha1703@gmail.com" reduces to "1703", which is a substring of every
    // number stored as "91703…" (9[1703]…), so the email search would pull in
    // every candidate whose number starts with 703.
    if (q.includes("@")) {
      where.OR = [{ email: { contains: q, mode: "insensitive" } }];
    } else {
      const or: Prisma.LeadWhereInput[] = [
        { candidateName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { phoneE164: { contains: q } },
        { altPhone: { contains: q } },
        { altPhoneE164: { contains: q } },
      ];
      // Format-agnostic phone search: match the bare digits against the
      // normalized phoneE164 (and raw phone), so "+91 78142 95082" also finds a
      // lead stored as "917814295082" / "7814295082" and vice-versa. Only run it
      // when the query is *predominantly* digits (an actual phone), so a name or
      // partial email that merely contains a few digits doesn't match unrelated
      // numbers by substring.
      const digits = q.replace(/\D/g, "");
      const compact = q.replace(/\s/g, "");
      const isPhoneish = digits.length >= 4 && digits.length / compact.length >= 0.6;
      if (isPhoneish) {
        or.push({ phoneE164: { contains: digits } });
        or.push({ phone: { contains: digits } });
        or.push({ altPhoneE164: { contains: digits } });
        or.push({ altPhone: { contains: digits } });
      }
      where.OR = or;
    }
  }
  if (p.from || p.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (p.from) createdAt.gte = p.from;
    if (p.to) createdAt.lt = p.to;
    where.createdAt = createdAt;
  }
  if (p.assignedFrom || p.assignedTo) {
    const assignedAt: Prisma.DateTimeFilter = {};
    if (p.assignedFrom) assignedAt.gte = p.assignedFrom;
    if (p.assignedTo) assignedAt.lt = p.assignedTo;
    where.assignedAt = assignedAt;
  }
  return where;
}

/**
 * Either shape a query string arrives in: `URLSearchParams` in a route handler,
 * or Next's plain `searchParams` object in a server component.
 */
export type LeadQuerySource = URLSearchParams | { [k: string]: string | string[] | undefined };

function readAll(sp: LeadQuerySource, key: string): string[] {
  return listParam(sp instanceof URLSearchParams ? sp.getAll(key) : sp[key]);
}

function readOne(sp: LeadQuerySource, key: string): string | undefined {
  return oneParam(sp instanceof URLSearchParams ? sp.getAll(key) : sp[key]);
}

/**
 * Turn a leads query string into {@link LeadFilterParams}.
 *
 * The list page, the GET list API, the export and the bulk-ids endpoint all
 * parse the identical set of params, so they share this one reader — otherwise
 * "Export Excel" or "select all matching" can quietly disagree with the table
 * the user is looking at.
 */
export function leadFilterParamsFromQuery(
  sp: LeadQuerySource,
  opts: { isBde: boolean; userId: string },
): LeadFilterParams {
  const range = rangeFor(
    parsePeriod({
      period: readOne(sp, "period"),
      from: readOne(sp, "from"),
      to: readOne(sp, "to"),
    }),
  );
  const assigned = assignedDayRange(readOne(sp, "assignedOn"));
  return {
    status: readAll(sp, "status"),
    source: readAll(sp, "source"),
    service: readAll(sp, "service"),
    // BDEs default to their own queue ("my leads") until they pick a consultant
    // or explicitly choose "All leads"; everyone else sees all leads.
    assignee: resolveAssigneeFilter(readAll(sp, "assignee"), opts),
    campaign: readAll(sp, "campaign"),
    temperature: readAll(sp, "temperature"),
    country: readAll(sp, "country"),
    studyDestination: readAll(sp, "studyDestination"),
    ageMin: parseAgeParam(readOne(sp, "ageMin")),
    ageMax: parseAgeParam(readOne(sp, "ageMax")),
    q: readOne(sp, "q"),
    from: range.from,
    to: range.to,
    assignedFrom: assigned?.from,
    assignedTo: assigned?.to,
  };
}

/** Sort key for the leads list — single-valued, unlike every categorical filter. */
export function leadSortFromQuery(sp: LeadQuerySource): string | undefined {
  return readOne(sp, "sort");
}

/**
 * Resolve the effective `assignee` filter from the raw query value, applying the
 * BDE default: a BDE who hasn't picked an assignee sees their own queue, so the
 * leads list lands on "my leads" by default. They can still view everyone by
 * explicitly choosing "All leads" (the `"all"` sentinel) or another consultant.
 * Non-BDEs (admins / CRM managers / supervisors) keep seeing all leads.
 *
 * Shared by the list page, the GET list API, and the export / ids endpoints so
 * the default view never drifts between them.
 */
export function resolveAssigneeFilter(
  raw: MultiFilterValue,
  opts: { isBde: boolean; userId: string },
): string | string[] | undefined {
  const picked = listParam(raw);
  // Explicit choice: userIds, "unassigned", and/or "all". A single pick is
  // returned as a bare string so callers that compare it still work.
  if (picked.length === 1) return picked[0];
  if (picked.length > 1) return picked;
  return opts.isBde ? opts.userId : undefined;
}

export function leadOrderBy(sort?: string): Prisma.LeadOrderByWithRelationInput {
  switch (sort) {
    case "created_asc":
      return { createdAt: "asc" };
    case "activity_desc":
      return { lastActivityAt: "desc" };
    case "assigned_desc":
      // Most-recently-assigned first; never-assigned leads sort last.
      return { assignedAt: { sort: "desc", nulls: "last" } };
    case "name_asc":
      return { candidateName: "asc" };
    default:
      return { createdAt: "desc" };
  }
}

/**
 * Statuses that are set ONLY by an action, never the manual status dropdown or
 * the stage bar: `pipeline` (via "Set deal"), `enrolled` (via "Enroll"), and
 * `duplicate` (via the importer's dedup flagging). Enforced in the lead PATCH
 * API and hidden from the detail UI's status picker.
 */
export const ACTION_ONLY_STATUS_CODES = ["pipeline", "enrolled", "duplicate"] as const;

export function isActionOnlyStatus(code: string | null | undefined): boolean {
  return !!code && (ACTION_ONLY_STATUS_CODES as readonly string[]).includes(code);
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

export type LeadDuplicate = {
  id: string;
  candidateName: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  source: string | null;
  status: { label: string; color: string | null };
  /** Which identity matched — "email", "phone", or both. */
  matchedOn: string;
};

/**
 * Other leads sharing this one's email or phone identity.
 *
 * Extracted from the lead detail page so the WhatsApp inbox can warn with the
 * same rule. It matters more there: the mirror creates a lead for any unknown
 * number, so a candidate who already exists under a second number, or whose
 * email only surfaces later in the conversation, silently becomes two records.
 * A duplicate found while reading the message is fixable; one found in a report
 * three weeks later is an argument about which row is real.
 */
export async function findLeadDuplicates(lead: {
  id: string;
  emailKey: string | null;
  phoneE164: string | null;
}): Promise<LeadDuplicate[]> {
  const or: Prisma.LeadWhereInput[] = [];
  if (lead.emailKey) or.push({ emailKey: lead.emailKey });
  if (lead.phoneE164) or.push({ phoneE164: lead.phoneE164 });
  if (or.length === 0) return [];

  const rows = await prisma.lead.findMany({
    where: { id: { not: lead.id }, OR: or },
    orderBy: { createdAt: "asc" },
    take: 25,
    select: {
      id: true,
      candidateName: true,
      email: true,
      phone: true,
      emailKey: true,
      phoneE164: true,
      createdAt: true,
      source: { select: { label: true } },
      status: { select: { label: true, color: true } },
    },
  });

  return rows.map((d) => {
    const on: string[] = [];
    if (lead.emailKey && d.emailKey === lead.emailKey) on.push("email");
    if (lead.phoneE164 && d.phoneE164 === lead.phoneE164) on.push("phone");
    return {
      id: d.id,
      candidateName: d.candidateName,
      email: d.email,
      phone: d.phone,
      createdAt: d.createdAt.toISOString(),
      source: d.source?.label ?? null,
      status: { label: d.status.label, color: d.status.color },
      matchedOn: on.join(" + "),
    };
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
  /** Task note text lifted out of `metadata`, shown as a sub-block on the Timeline. */
  note: string | null;
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
  // Task activities stash the task's note in `metadata.note`; lift it out so the
  // Timeline can render it even when the raw metadata is withheld from the client.
  const meta = a.metadata && typeof a.metadata === "object" ? (a.metadata as Record<string, unknown>) : null;
  const note = meta && typeof meta.note === "string" && meta.note.trim() ? meta.note : null;
  return {
    id: a.id,
    type: a.type,
    summary: a.summary,
    note,
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

/**
 * The "active leads always have a next step" rule. Completing a task must be
 * accompanied by a new follow-up when ALL of these hold:
 *   - it is a completion (not a reopen or a plain field edit),
 *   - the lead is still ACTIVE (won/lost leads need no further action),
 *   - the lead is NOT in Re-marketing, and
 *   - no other open task remains once this one is done.
 *
 * Re-marketing is exempt because that stage is nurtured by the automated drip
 * campaign (crm-remarketing), so the "never idle" guarantee is met by the
 * campaign, not a manual task — a BDE can close the last task without booking a
 * follow-up. `statusCode` is optional so any caller that doesn't pass it keeps
 * the original behaviour.
 *
 * Enforced in the task-complete route; pure so the exact exemptions are testable.
 */
export function requiresNextStepOnComplete(opts: {
  completing: boolean;
  leadKind: string; // 'active' | 'won' | 'lost'
  remainingOpenTasks: number; // open tasks on the lead EXCLUDING the one being completed
  statusCode?: string;
}): boolean {
  if (opts.statusCode === REMARKETING_STATUS_CODE) return false;
  return opts.completing && opts.leadKind === "active" && opts.remainingOpenTasks === 0;
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
  status?: MultiFilterValue; // 'open' | 'done' (undefined/both = all)
  assignee?: MultiFilterValue; // userIds | 'unassigned' | 'all'
  priority?: MultiFilterValue; // 'low' | 'normal' | 'high'
  due?: MultiFilterValue; // 'overdue' | 'today' | 'week' | 'no_date'
  kind?: MultiFilterValue; // 'reinquiry' — re-inquiry / re-engage follow-ups
  q?: string; // matches task subject OR lead name
  /** Injected "now" so date math is stable within a request. */
  now?: Date;
};

// Re-inquiry follow-up tasks have no dedicated column — they're identified by a
// "re-inquiry" subject, shared by every creator: the live action + oversight
// tasks (`Re-inquiry — …` / `Re-inquiry oversight — …`) and the rescue script's
// `Re-engage — re-inquiry via …`. Same needle the rescue script counts on.
export const REINQUIRY_TASK_SUBJECT_NEEDLE = "re-inquiry";

/** Midnight (local) at the start of `d`. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Build the Prisma `where` for the cross-lead task list. */
export function buildCrmTaskWhere(p: CrmTaskFilterParams): Prisma.CrmTaskWhereInput {
  const where: Prisma.CrmTaskWhereInput = {};
  const and: Prisma.CrmTaskWhereInput[] = [];

  // Picking both 'open' and 'done' is the same as picking neither: no filter.
  const statuses = listParam(p.status).filter((v) => v === "open" || v === "done");
  if (statuses.length === 1) where.status = statuses[0];

  // "all" is the BDE "All tasks" opt-out (not a narrowing filter), so it applies
  // no assignee restriction — mirrors buildLeadWhere.
  const assignees = listParam(p.assignee);
  if (assignees.length > 0 && !assignees.includes("all")) {
    const unassigned = assignees.includes("unassigned");
    const userIds = assignees.filter((v) => v !== "unassigned");
    if (unassigned && userIds.length > 0) {
      and.push({ OR: [{ assignedToId: null }, { assignedToId: oneOf(userIds) }] });
    } else {
      where.assignedToId = unassigned ? null : oneOf(userIds);
    }
  }

  const priority = oneOf(
    listParam(p.priority).filter((v) => v === "low" || v === "normal" || v === "high"),
  );
  if (priority !== undefined) where.priority = priority;

  if (listParam(p.kind).includes("reinquiry")) {
    where.subject = { contains: REINQUIRY_TASK_SUBJECT_NEEDLE, mode: "insensitive" };
  }

  // Due buckets are date predicates rather than column values, so several picks
  // union as an OR rather than an `IN`. "Overdue" carries `status: open` inside
  // its own branch (only an open task can be overdue) instead of overwriting the
  // status filter — so "Done + Overdue" honestly matches nothing.
  const today = startOfDay(p.now ?? new Date());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const dueClauses: Prisma.CrmTaskWhereInput[] = [];
  for (const due of listParam(p.due)) {
    if (due === "overdue") dueClauses.push({ dueAt: { lt: today }, status: "open" });
    else if (due === "today") dueClauses.push({ dueAt: { gte: today, lt: tomorrow } });
    else if (due === "week") dueClauses.push({ dueAt: { gte: today, lt: weekEnd } });
    else if (due === "no_date") dueClauses.push({ dueAt: null });
  }
  if (dueClauses.length > 0) and.push({ OR: dueClauses });

  const q = p.q?.trim();
  if (q) {
    where.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { lead: { candidateName: { contains: q, mode: "insensitive" } } },
    ];
  }
  if (and.length > 0) where.AND = and;
  return where;
}

/**
 * Turn a tasks query string into {@link CrmTaskFilterParams}. Shared by the
 * board, the list API and the export so the three never drift.
 *
 * The board opens on OPEN tasks — the actionable view — so an absent `status`
 * defaults to `["open"]`. Ticking both Open and Done (or the legacy
 * `?status=all` link) widens it back to everything.
 */
export function crmTaskFilterParamsFromQuery(
  sp: LeadQuerySource,
  opts: { isBde: boolean; userId: string; now?: Date },
): CrmTaskFilterParams {
  const status = readAll(sp, "status");
  return {
    status: status.length > 0 ? status : ["open"],
    assignee: resolveAssigneeFilter(readAll(sp, "assignee"), opts),
    priority: readAll(sp, "priority"),
    due: readAll(sp, "due"),
    kind: readAll(sp, "kind"),
    q: readOne(sp, "q"),
    now: opts.now,
  };
}

/**
 * Narrow the Tasks board's stat chips to the same consultants as the list, so
 * the counts can never disagree with the rows underneath them. Sentinel-only
 * selections ("all", "unassigned") and an empty pick leave the counts global.
 */
export function crmTaskAssigneeScope(assignee: MultiFilterValue): Prisma.CrmTaskWhereInput {
  const values = listParam(assignee);
  if (values.includes("all")) return {};
  const userIds = values.filter((v) => v !== "unassigned");
  if (userIds.length === 0) return {};
  return { assignedToId: oneOf(userIds) };
}

/**
 * Owner-match for the open tasks that should follow a lead (re)assignment. The
 * Tasks board filters on each task's own `assignedToId`, so assigning a lead has
 * to be swept down onto its open tasks or they linger in the "Unassigned" view
 * (e.g. a re-inquiry task stamped null while the lead had no consultant). We move
 * tasks that are unassigned or owned by the outgoing assignee, and leave tasks
 * owned by anyone else (e.g. a supervisor's oversight copy) untouched.
 * `previousAssigneeId` is the lead's owner *before* the change (null if none).
 */
export function crmTaskFollowAssignmentWhere(previousAssigneeId: string | null): Prisma.CrmTaskWhereInput {
  return previousAssigneeId
    ? { OR: [{ assignedToId: null }, { assignedToId: previousAssigneeId }] }
    : { assignedToId: null };
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
