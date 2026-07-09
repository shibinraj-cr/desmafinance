/**
 * Team Activity Monitor — the CRM supervision surface behind `/crm/team`.
 *
 * Answers the manager's daily question: *is each BDE actually working their
 * leads, and where are leads rotting?* It is deliberately separate from the
 * pipeline-operations metrics in `lead-pulse-crm-metrics.ts`: those report
 * conversion/funnel health; this reports **people and freshness**.
 *
 * Design notes:
 *   - All decision logic (SLA thresholds, the "touch" definition, staleness
 *     classification, on-time, role scope, first-response) lives in the pure
 *     exported helpers below so it can be unit-tested without a DB. The DB
 *     functions only query and delegate.
 *   - "Touched" = ANY meaningful activity EXCEPT a bulk-email send. This mirrors
 *     `lastActivityAt` (which already ignores the passive `LEAD_OPENED`) minus
 *     bulk email — bulk email bumps `lastActivityAt` (crm bulk-email route) and
 *     would otherwise make a mass-emailed lead look freshly worked. Bulk sends
 *     are tagged `metadata.bulk = true` on their `EMAIL_SENT` activity, so the
 *     carve-out is exact.
 *   - "Conversion" reuses `getCrmFunnelByBde` (current month, carryover-safe);
 *     activity/first-response metrics use the page's selected date range;
 *     attention buckets (SLA breach / abandoned / no-task / stuck) are
 *     point-in-time snapshots that ignore the range. Each is labelled in the UI.
 *   - A lead with an *upcoming* scheduled task (an open task due today or later)
 *     is exempt from the SLA-breach and stuck-in-stage buckets: a planned, not-yet-
 *     lapsed next step means the consultant is on it. Abandoned and no-next-step
 *     are unaffected. See {@link hasUpcomingTask} / {@link attentionFlags}.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getAssignableBdes, REINQUIRY_TASK_SUBJECT_NEEDLE } from "./crm-leads";
import { getCrmFunnelByBde } from "./lead-pulse-crm-metrics";
import { CRM_TEAM_LEAD_PAGE } from "./crm-rbac";

// ── Policy constants ─────────────────────────────────────────────────────────

/**
 * Per active-status SLA: a lead untouched for MORE than this many days is
 * "breaching" its stage SLA. Keyed by `CrmLeadStatus.code`. Active statuses not
 * listed here (none today) are not SLA-monitored. Won/lost statuses are excluded
 * by construction — only `kind = 'active'` leads are ever classified.
 */
export const SLA_THRESHOLD_DAYS: Record<string, number> = {
  not_yet_started: 1,
  qualify: 3,
  follow_up: 2,
  re_marketing: 7,
  pipeline: 3,
};

/** Any active lead untouched this long is "abandoned" regardless of stage. */
export const ABANDONED_DAYS = 30;

/** An active lead in the same status this long (no STATUS_CHANGED since) is "stuck". */
export const STUCK_DAYS = 14;

/** A freshly-assigned lead should get a first outbound contact within this window. */
export const FIRST_RESPONSE_SLA_HOURS = 24;

/** Cap on how many rows each attention list returns (worst-first); UI links to the full set. */
export const ATTENTION_LIST_LIMIT = 12;

/**
 * Passive activity types that never count as a "touch" — kept in sync with
 * `NON_BUMPING_TYPES` in crm-activity.ts (a merely-viewed lead must not look
 * worked).
 */
export const PASSIVE_ACTIVITY_TYPES = ["LEAD_OPENED"] as const;

/** Outbound-contact activity types — the "reach-out" actions behind the leaderboard and first-response. */
export const OUTBOUND_CONTACT_TYPES = ["CALL_LOGGED", "EMAIL_SENT", "WHATSAPP_SENT"] as const;

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/**
 * Prisma `where` selecting the `LeadActivity` rows that count as a real "touch":
 * any activity EXCEPT a passive view (`LEAD_OPENED`) and EXCEPT a bulk-email send
 * (`EMAIL_SENT` with `metadata.bulk === true`). This is the "any activity except
 * bulk email" rule used everywhere a lead's last-worked time is computed.
 */
export function touchActivityWhere(): Prisma.LeadActivityWhereInput {
  return {
    type: { notIn: [...PASSIVE_ACTIVITY_TYPES] },
    NOT: { type: "EMAIL_SENT", metadata: { path: ["bulk"], equals: true } },
  };
}

/** Prisma `where` selecting outbound contacts (calls/emails/whatsapp), excluding bulk emails. */
export function outboundContactWhere(): Prisma.LeadActivityWhereInput {
  return {
    type: { in: [...OUTBOUND_CONTACT_TYPES] },
    NOT: { type: "EMAIL_SENT", metadata: { path: ["bulk"], equals: true } },
  };
}

/** Fractional days between two instants (`now - then`). Negative if `then` is in the future. */
export function ageInDays(now: Date, then: Date): number {
  return (now.getTime() - then.getTime()) / 86_400_000;
}

export type StalenessVerdict = {
  /** Days since the lead was last touched. */
  ageDays: number;
  /** This status's SLA in days, or null when the status isn't SLA-monitored. */
  slaDays: number | null;
  /** True when `ageDays` exceeds the status SLA. */
  breached: boolean;
  /** True when `ageDays` exceeds the global abandoned threshold. */
  abandoned: boolean;
};

/** Classify one active lead's freshness against its per-status SLA and the abandoned threshold. */
export function classifyStaleness(opts: {
  statusCode: string;
  lastTouchAt: Date;
  now: Date;
}): StalenessVerdict {
  const ageDays = ageInDays(opts.now, opts.lastTouchAt);
  const slaDays = SLA_THRESHOLD_DAYS[opts.statusCode] ?? null;
  return {
    ageDays,
    slaDays,
    breached: slaDays !== null && ageDays > slaDays,
    abandoned: ageDays > ABANDONED_DAYS,
  };
}

export type AttentionFlags = {
  /**
   * Untouched past this status's SLA (see {@link SLA_THRESHOLD_DAYS}) — UNLESS the
   * lead has an upcoming scheduled task ({@link hasUpcomingTask}), in which case a
   * planned next step already exists and it is not counted as a breach.
   */
  slaBreached: boolean;
  /** Untouched for more than {@link ABANDONED_DAYS}. */
  abandoned: boolean;
  /** No open task scheduled to move the lead forward. */
  noNextStep: boolean;
  /**
   * In the same status for more than {@link STUCK_DAYS} (no STATUS_CHANGED since) —
   * UNLESS the lead has an upcoming scheduled task ({@link hasUpcomingTask}); a
   * planned next step means the consultant is still working it, not stalled.
   */
  stuck: boolean;
  /** This status's SLA in days, or null when the status isn't SLA-monitored. */
  slaDays: number | null;
  /** Days since the lead was last touched. */
  daysSinceTouch: number;
  /** Days in the current status (since the last STATUS_CHANGED, else since creation). */
  daysInStage: number;
  /** True when the lead hits at least one attention bucket — the drill-down keeps only these. */
  flagged: boolean;
};

/**
 * Classify one active, owned lead against every attention bucket at once —
 * SLA breach + abandoned (via {@link classifyStaleness}), no-next-step (no open
 * task), and stuck-in-stage (days since the last STATUS_CHANGED). The single
 * source of truth for both the Team Activity dashboard's per-BDE counts and the
 * consultant-filterable drill-down queue, so the two surfaces can never diverge.
 *
 * SLA-breach and stuck-in-stage are suppressed when the lead has an upcoming
 * scheduled task ({@link hasUpcomingTask}, driven by `nextTaskDueAt`): a planned
 * next step that has not yet lapsed means the consultant is already on it, so the
 * lead should not nag as breached/stalled. Abandoned and no-next-step are NOT
 * suppressed — a lead untouched for a month, or with no task at all, still needs
 * a look regardless of anything scheduled.
 */
export function attentionFlags(opts: {
  statusCode: string;
  lastTouchAt: Date;
  stuckSince: Date;
  hasOpenTask: boolean;
  /** Earliest open-task due date (the `_min` over open tasks), or null when none has one. */
  nextTaskDueAt: Date | null;
  now: Date;
}): AttentionFlags {
  const v = classifyStaleness({ statusCode: opts.statusCode, lastTouchAt: opts.lastTouchAt, now: opts.now });
  const daysInStage = ageInDays(opts.now, opts.stuckSince);
  const upcoming = hasUpcomingTask(opts.nextTaskDueAt, opts.now);
  const stuck = daysInStage > STUCK_DAYS && !upcoming;
  const slaBreached = v.breached && !upcoming;
  const noNextStep = !opts.hasOpenTask;
  return {
    slaBreached,
    abandoned: v.abandoned,
    noNextStep,
    stuck,
    slaDays: v.slaDays,
    daysSinceTouch: v.ageDays,
    daysInStage,
    flagged: slaBreached || v.abandoned || noNextStep || stuck,
  };
}

/** Local midnight at the start of `d`'s calendar day (matches the task board's day boundaries). */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Local midnight at the start of the day AFTER `d`. */
export function startOfNextLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

/**
 * True when a lead has an upcoming scheduled follow-up: an open task whose
 * earliest due date has not yet passed (due today or later). `nextTaskDueAt` is
 * the `_min` open-task due date, so "min not overdue" means every open task is
 * still upcoming — the consultant has a planned next step that hasn't lapsed.
 * Uses the task board's day boundary (a task is overdue only once its due day has
 * fully passed), matching the queue UI's `overdue` rule. An open task with no due
 * date (null) does not count — there is no scheduled date to be "in the future".
 */
export function hasUpcomingTask(nextTaskDueAt: Date | null, now: Date): boolean {
  return nextTaskDueAt !== null && nextTaskDueAt.getTime() >= startOfLocalDay(now).getTime();
}

/**
 * A completed task is "on time" when it was finished on or before the end of its
 * due day — consistent with the task board, where a task is overdue only once
 * its due day has fully passed. A task with no due date has no SLA to miss (on
 * time); an uncompleted task is never on time.
 */
export function isTaskOnTime(t: { completedAt: Date | null; dueAt: Date | null }): boolean {
  if (!t.completedAt) return false;
  if (!t.dueAt) return true;
  return t.completedAt.getTime() < startOfNextLocalDay(t.dueAt).getTime();
}

/**
 * Grace window for telling a deliberate in-app assignment from bulk-import
 * carryover: the importer stamps every imported lead's `assignedAt` to the
 * batch's import time, so a lead only counts as genuinely assigned when it has
 * no import batch OR was (re)assigned meaningfully later. Mirrors the 10-minute
 * rule in `getCrmFunnelByBde` so the team monitor agrees with CRM Metrics.
 */
export const IMPORT_CARRYOVER_GRACE_MS = 10 * 60 * 1000;

/**
 * True when a lead is genuinely owned by a consultant — assigned, and not merely
 * carried over by a bulk import. Used to scope every accountability metric so the
 * unassigned/imported backlog (its own separate tile) never inflates a BDE's
 * SLA-breach / no-task / stuck / first-response numbers.
 */
export function isDeliberateAssignment(lead: {
  assignedToId: string | null;
  assignedAt: Date | null;
  importBatchCreatedAt: Date | null;
}): boolean {
  if (!lead.assignedToId || !lead.assignedAt) return false;
  if (!lead.importBatchCreatedAt) return true;
  return lead.assignedAt.getTime() > lead.importBatchCreatedAt.getTime() + IMPORT_CARRYOVER_GRACE_MS;
}

export type TeamScope = {
  /** When set, every query is restricted to this user's own leads/work (self-view). */
  restrictToUserId: string | null;
  /** True when the view is currently showing the WHOLE team (not a single person). */
  teamWide: boolean;
  /**
   * True when the user is ALLOWED to see the whole team — drives whether the
   * team/self toggle is offered. A team lead (e.g. heading sales) can view the
   * whole team AND switch to "just me"; a plain BDE only ever sees themselves.
   */
  canViewWholeTeam: boolean;
  /** The signed-in user's own id (the target of the "Just me" toggle). */
  selfUserId: string;
};

/**
 * Resolve which numbers the Team Activity page shows. Managers (system admin,
 * CRM-admin tier, or Lead Pulse supervisor) may see the whole team; everyone
 * else (a plain BDE) is locked to their own numbers. A team-wide-capable user
 * can flip to their own activity via `requested === "me"` — so a player-coach
 * like a sales-team head gets both the team view and a personal view.
 */
export function resolveTeamScope(
  access: {
    isAdmin: boolean;
    isSupervisor: boolean;
    canManageCrm: boolean;
    /** View-only sales-team lead — sees the whole team without CRM-admin powers. */
    isCrmTeamLead?: boolean;
    userId: string;
  },
  /** Requested view from the page: "me" forces the personal view; anything else shows the team. */
  requested?: string,
): TeamScope {
  const canViewWholeTeam =
    access.isAdmin || access.isSupervisor || access.canManageCrm || !!access.isCrmTeamLead;
  if (!canViewWholeTeam) {
    return { restrictToUserId: access.userId, teamWide: false, canViewWholeTeam: false, selfUserId: access.userId };
  }
  const showSelf = requested === "me";
  return {
    restrictToUserId: showSelf ? access.userId : null,
    teamWide: !showSelf,
    canViewWholeTeam: true,
    selfUserId: access.userId,
  };
}

/**
 * A synthetic whole-team scope. The L2 Scorecard is shown to everyone with CRM
 * access and always ranks the full team, so it is computed team-wide regardless
 * of the viewer's "Whole team / Just me" toggle.
 */
export function wholeTeamScope(selfUserId: string): TeamScope {
  return { restrictToUserId: null, teamWide: true, canViewWholeTeam: true, selfUserId };
}

/** Median of a numeric list, or null when empty. Does not mutate the input. */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * For each assignment, the earliest outbound contact that happened at or after
 * the lead was assigned (a contact logged before assignment doesn't count as a
 * response to it). Pure so first-response stats are unit-testable.
 */
export function firstContactAfterAssignment(
  assignments: Array<{ leadId: string; assignedAt: Date }>,
  contacts: Array<{ leadId: string; occurredAt: Date }>,
): Map<string, Date> {
  const assignedAtByLead = new Map(assignments.map((a) => [a.leadId, a.assignedAt]));
  const out = new Map<string, Date>();
  for (const c of contacts) {
    const assignedAt = assignedAtByLead.get(c.leadId);
    if (!assignedAt) continue;
    if (c.occurredAt.getTime() < assignedAt.getTime()) continue;
    const cur = out.get(c.leadId);
    if (!cur || c.occurredAt.getTime() < cur.getTime()) out.set(c.leadId, c.occurredAt);
  }
  return out;
}

export type FirstResponseStats = {
  /** Median hours from assignment to first outbound contact, over responded leads. */
  medianHours: number | null;
  /** Assigned-in-range leads not yet contacted at all. */
  pending: number;
  /** Leads contacted later than the SLA, plus pending leads already past the SLA. */
  breached: number;
};

/** First-response summary for one set of assignments + their first-contact map. */
export function computeFirstResponseStats(opts: {
  assignments: Array<{ leadId: string; assignedAt: Date }>;
  firstContactByLead: Map<string, Date>;
  now: Date;
}): FirstResponseStats {
  const hours: number[] = [];
  let pending = 0;
  let breached = 0;
  for (const a of opts.assignments) {
    const contact = opts.firstContactByLead.get(a.leadId);
    if (contact) {
      const h = (contact.getTime() - a.assignedAt.getTime()) / 3_600_000;
      hours.push(h);
      if (h > FIRST_RESPONSE_SLA_HOURS) breached++;
    } else {
      pending++;
      if ((opts.now.getTime() - a.assignedAt.getTime()) / 3_600_000 > FIRST_RESPONSE_SLA_HOURS) breached++;
    }
  }
  return { medianHours: median(hours), pending, breached };
}

/** Bucket dated rows into the last `days` local calendar days, oldest→newest (index `days-1` is today). */
export function bucketByLocalDay(
  rows: Array<{ at: Date }>,
  now: Date,
  days: number,
): number[] {
  const todayStart = startOfLocalDay(now).getTime();
  const out = new Array<number>(days).fill(0);
  for (const r of rows) {
    const dayStart = startOfLocalDay(r.at).getTime();
    const idx = days - 1 - Math.round((todayStart - dayStart) / 86_400_000);
    if (idx >= 0 && idx < days) out[idx]++;
  }
  return out;
}

// ── DB query layer ───────────────────────────────────────────────────────────

/** Build a half-open `[from, to)` DateTime filter, or undefined when the range is unbounded. */
function dateRangeFilter(range: { from?: Date; to?: Date }): Prisma.DateTimeFilter | undefined {
  if (!range.from && !range.to) return undefined;
  const f: Prisma.DateTimeFilter = {};
  if (range.from) f.gte = range.from;
  if (range.to) f.lt = range.to;
  return f;
}

export type TeamBdeRow = {
  userId: string;
  displayName: string;
  role: string;
  // Conversion (current calendar month, via getCrmFunnelByBde).
  assignedMonth: number;
  enrolledMonth: number;
  conversionPct: number | null;
  // Activity (selected range).
  assignedRange: number;
  calls: number;
  emails: number;
  whatsapp: number;
  contacts: number;
  tasksCompleted: number;
  tasksOnTime: number;
  // First response (selected range).
  firstResponseMedianHours: number | null;
  firstResponsePending: number;
  firstResponseBreached: number;
  // Attention (point-in-time / now).
  /** Active leads genuinely owned by this consultant right now — the denominator for hygiene rates. */
  activeOwned: number;
  slaBreaches: number;
  abandoned: number;
  noTask: number;
  stuck: number;
  openReinquiry: number;
};

export type TeamLeadRef = {
  id: string;
  name: string;
  statusLabel: string;
  statusColor: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  ageDays: number;
};

export type TeamActivity = {
  scopeTeamWide: boolean;
  totals: {
    newLeadsToday: number;
    newLeadsRange: number;
    assignedRange: number;
    contacts: number;
    tasksCompleted: number;
    tasksOnTime: number;
    slaBreaches: number;
    abandoned: number;
    noTask: number;
    stuck: number;
    openReinquiry: number;
    firstResponsePending: number;
    firstResponseBreached: number;
    unassignedActive: number;
  };
  /** New-leads-per-day sparkline for the last 14 local days (oldest→newest). */
  newLeadTrend: number[];
  bdeRows: TeamBdeRow[];
  attention: {
    slaBreaches: TeamLeadRef[];
    abandoned: TeamLeadRef[];
    noTask: TeamLeadRef[];
    stuck: TeamLeadRef[];
  };
};

type ActiveLeadLite = {
  id: string;
  candidateName: string;
  assignedToId: string | null;
  createdAt: Date;
  status: { code: string; label: string; color: string | null };
};

/** Assemble the full Team Activity payload for one scope + date range. */
export async function getTeamActivity(opts: {
  scope: TeamScope;
  range: { from?: Date; to?: Date };
  now: Date;
}): Promise<TeamActivity> {
  const { scope, range, now } = opts;
  const self = scope.restrictToUserId;
  const scopeLeadWhere: Prisma.LeadWhereInput = self ? { assignedToId: self } : {};
  const occurredAt = dateRangeFilter(range);

  // Roster — every active L1/L2 BDE, narrowed to self for a BDE's own view.
  const roster = (await getAssignableBdes()).filter((b) => !self || b.userId === self);
  const ids = roster.map((b) => b.userId);

  const TREND_DAYS = 14;
  const trendFrom = new Date(startOfNextLocalDay(now).getTime() - TREND_DAYS * 86_400_000);

  const [
    funnel,
    activeAssignedRaw,
    reinquiryByBde,
    contactGroups,
    completedTasks,
    assignedRaw,
    trendLeads,
    newLeadsRange,
    unassignedActive,
  ] = await Promise.all([
    // Conversion (current month, carryover-safe). Narrowed to self below.
    getCrmFunnelByBde(now.getFullYear(), now.getMonth() + 1),
    // Assigned active leads — the population for staleness / stuck / no-task. Only
    // OWNED leads (assignedToId set); the deliberate-assignment filter below drops
    // bulk-import carryover so the unassigned/imported backlog can't inflate counts.
    prisma.lead.findMany({
      where: { status: { kind: "active" }, assignedToId: self ? self : { not: null } },
      select: {
        id: true,
        candidateName: true,
        assignedToId: true,
        assignedAt: true,
        createdAt: true,
        importBatch: { select: { createdAt: true } },
        status: { select: { code: true, label: true, color: true } },
      },
    }),
    // Open re-inquiry follow-up tasks, per assignee (subject rule shared with the task board).
    prisma.crmTask.groupBy({
      by: ["assignedToId"],
      where: {
        status: "open",
        subject: { contains: REINQUIRY_TASK_SUBJECT_NEEDLE, mode: "insensitive" },
        ...(self ? { assignedToId: self } : {}),
      },
      _count: { _all: true },
    }),
    // Outbound-contact volume per BDE per channel, in the selected range.
    ids.length
      ? prisma.leadActivity.groupBy({
          by: ["actorId", "type"],
          where: { actorId: { in: ids }, ...outboundContactWhere(), ...(occurredAt ? { occurredAt } : {}) },
          _count: { _all: true },
        })
      : Promise.resolve([] as Array<{ actorId: string | null; type: string; _count: { _all: number } }>),
    // Tasks completed in the range (for completion + on-time %).
    prisma.crmTask.findMany({
      where: {
        status: "done",
        completedAt: occurredAt ?? { not: null },
        ...(self ? { assignedToId: self } : { assignedToId: { in: ids } }),
      },
      select: { assignedToId: true, completedAt: true, dueAt: true },
    }),
    // Leads assigned in the range (assignedRange counts + first-response population).
    // Carryover-filtered below so imports stamped at import time aren't counted.
    prisma.lead.findMany({
      where: { assignedToId: self ? self : { in: ids }, assignedAt: occurredAt ?? { not: null } },
      select: { id: true, assignedToId: true, assignedAt: true, importBatch: { select: { createdAt: true } } },
    }),
    // New leads in the last 14 days, for the trend sparkline + "today".
    prisma.lead.findMany({
      where: { createdAt: { gte: trendFrom }, ...scopeLeadWhere },
      select: { createdAt: true },
    }),
    // New leads created in the selected range.
    prisma.lead.count({ where: { ...(occurredAt ? { createdAt: occurredAt } : {}), ...scopeLeadWhere } }),
    // Unassigned active leads (managers only; 0 for a self-view).
    self ? Promise.resolve(0) : prisma.lead.count({ where: { status: { kind: "active" }, assignedToId: null } }),
  ]);

  // Carryover-exclude: keep only genuinely-owned leads (drops bulk-import dumps),
  // so the unassigned/imported backlog never inflates a consultant's numbers.
  const attentionLeads = activeAssignedRaw.filter((l) =>
    isDeliberateAssignment({
      assignedToId: l.assignedToId,
      assignedAt: l.assignedAt,
      importBatchCreatedAt: l.importBatch?.createdAt ?? null,
    }),
  );
  const attentionLeadIds = attentionLeads.map((l) => l.id);

  const assignments = assignedRaw
    .filter((l) =>
      isDeliberateAssignment({
        assignedToId: l.assignedToId,
        assignedAt: l.assignedAt,
        importBatchCreatedAt: l.importBatch?.createdAt ?? null,
      }),
    )
    .map((l) => ({ leadId: l.id, assignedToId: l.assignedToId, assignedAt: l.assignedAt as Date }));
  const assignedLeadIds = assignments.map((a) => a.leadId);

  // Per-lead last touch + last status change over the owned set, which owned leads
  // already have an open task (and its earliest due date, for the upcoming-task
  // carve-out), and the first-response contacts for assigned leads.
  const [leadsWithOpenTaskGroups, touchGroups, statusChangeGroups, firstResponseContacts] = await Promise.all([
    attentionLeadIds.length
      ? prisma.crmTask.groupBy({
          by: ["leadId"],
          where: { status: "open", leadId: { in: attentionLeadIds } },
          _min: { dueAt: true },
        })
      : Promise.resolve([] as Array<{ leadId: string; _min: { dueAt: Date | null } }>),
    attentionLeadIds.length
      ? prisma.leadActivity.groupBy({
          by: ["leadId"],
          where: { leadId: { in: attentionLeadIds }, ...touchActivityWhere() },
          _max: { occurredAt: true },
        })
      : Promise.resolve([] as Array<{ leadId: string; _max: { occurredAt: Date | null } }>),
    attentionLeadIds.length
      ? prisma.leadActivity.groupBy({
          by: ["leadId"],
          where: { leadId: { in: attentionLeadIds }, type: "STATUS_CHANGED" },
          _max: { occurredAt: true },
        })
      : Promise.resolve([] as Array<{ leadId: string; _max: { occurredAt: Date | null } }>),
    assignedLeadIds.length
      ? prisma.leadActivity.findMany({
          where: { leadId: { in: assignedLeadIds }, ...outboundContactWhere() },
          select: { leadId: true, occurredAt: true },
        })
      : Promise.resolve([] as Array<{ leadId: string; occurredAt: Date }>),
  ]);

  const touchByLead = new Map(touchGroups.map((g) => [g.leadId, g._max.occurredAt]));
  const statusChangeByLead = new Map(statusChangeGroups.map((g) => [g.leadId, g._max.occurredAt]));
  const leadsWithOpenTask = new Set(leadsWithOpenTaskGroups.map((g) => g.leadId));
  const nextTaskByLead = new Map(leadsWithOpenTaskGroups.map((g) => [g.leadId, g._min.dueAt]));

  // ── Per-BDE accumulators ──
  const blank = (): Omit<TeamBdeRow, "userId" | "displayName" | "role"> => ({
    assignedMonth: 0,
    enrolledMonth: 0,
    conversionPct: null,
    assignedRange: 0,
    calls: 0,
    emails: 0,
    whatsapp: 0,
    contacts: 0,
    tasksCompleted: 0,
    tasksOnTime: 0,
    firstResponseMedianHours: null,
    firstResponsePending: 0,
    firstResponseBreached: 0,
    activeOwned: 0,
    slaBreaches: 0,
    abandoned: 0,
    noTask: 0,
    stuck: 0,
    openReinquiry: 0,
  });
  const acc = new Map(roster.map((b) => [b.userId, blank()]));

  // Conversion (month).
  const funnelById = new Map(funnel.map((f) => [f.userId, f]));
  for (const b of roster) {
    const f = funnelById.get(b.userId);
    const a = acc.get(b.userId)!;
    if (f) {
      a.assignedMonth = f.leadsAssigned;
      a.enrolledMonth = f.enrolled;
      a.conversionPct = f.conversionPct;
    }
  }

  // Outbound-contact leaderboard (range).
  for (const g of contactGroups) {
    const a = g.actorId ? acc.get(g.actorId) : undefined;
    if (!a) continue;
    const n = g._count._all;
    a.contacts += n;
    if (g.type === "CALL_LOGGED") a.calls += n;
    else if (g.type === "EMAIL_SENT") a.emails += n;
    else if (g.type === "WHATSAPP_SENT") a.whatsapp += n;
  }

  // Tasks completed + on-time (range).
  for (const t of completedTasks) {
    const a = t.assignedToId ? acc.get(t.assignedToId) : undefined;
    if (!a) continue;
    a.tasksCompleted++;
    if (isTaskOnTime(t)) a.tasksOnTime++;
  }

  // Assigned-in-range counts (carryover-excluded).
  for (const a of assignments) {
    const row = a.assignedToId ? acc.get(a.assignedToId) : undefined;
    if (row) row.assignedRange++;
  }

  // First response (range), per BDE.
  const firstContactByLead = firstContactAfterAssignment(assignments, firstResponseContacts);
  const assignmentsByBde = new Map<string, Array<{ leadId: string; assignedAt: Date }>>();
  for (const a of assignments) {
    if (!a.assignedToId || !acc.has(a.assignedToId)) continue;
    const list = assignmentsByBde.get(a.assignedToId) ?? [];
    list.push({ leadId: a.leadId, assignedAt: a.assignedAt });
    assignmentsByBde.set(a.assignedToId, list);
  }
  for (const [userId, assignments] of assignmentsByBde) {
    const stats = computeFirstResponseStats({ assignments, firstContactByLead, now });
    const a = acc.get(userId)!;
    a.firstResponseMedianHours = stats.medianHours;
    a.firstResponsePending = stats.pending;
    a.firstResponseBreached = stats.breached;
  }

  // Re-inquiry open tasks (now).
  for (const g of reinquiryByBde) {
    const a = g.assignedToId ? acc.get(g.assignedToId) : undefined;
    if (a) a.openReinquiry += g._count._all;
  }

  // ── Attention buckets (point-in-time) ──
  const slaList: TeamLeadRef[] = [];
  const abandonedList: TeamLeadRef[] = [];
  const noTaskList: TeamLeadRef[] = [];
  const stuckList: TeamLeadRef[] = [];
  const nameById = new Map(roster.map((b) => [b.userId, b.displayName]));

  const toRef = (l: ActiveLeadLite, ageDays: number): TeamLeadRef => ({
    id: l.id,
    name: l.candidateName,
    statusLabel: l.status.label,
    statusColor: l.status.color,
    assigneeId: l.assignedToId,
    assigneeName: l.assignedToId ? nameById.get(l.assignedToId) ?? null : null,
    ageDays,
  });

  for (const l of attentionLeads) {
    const a = l.assignedToId ? acc.get(l.assignedToId) : undefined;
    if (a) a.activeOwned++;
    const lastTouchAt = touchByLead.get(l.id) ?? l.createdAt;
    const stuckSince = statusChangeByLead.get(l.id) ?? l.createdAt;
    const f = attentionFlags({
      statusCode: l.status.code,
      lastTouchAt,
      stuckSince,
      hasOpenTask: leadsWithOpenTask.has(l.id),
      nextTaskDueAt: nextTaskByLead.get(l.id) ?? null,
      now,
    });

    if (f.slaBreached) {
      if (a) a.slaBreaches++;
      slaList.push(toRef(l, f.daysSinceTouch));
    }
    if (f.abandoned) {
      if (a) a.abandoned++;
      abandonedList.push(toRef(l, f.daysSinceTouch));
    }
    if (f.noNextStep) {
      if (a) a.noTask++;
      noTaskList.push(toRef(l, f.daysSinceTouch));
    }
    if (f.stuck) {
      if (a) a.stuck++;
      stuckList.push(toRef(l, f.daysInStage));
    }
  }

  const worstFirst = (a: TeamLeadRef, b: TeamLeadRef) => b.ageDays - a.ageDays;
  const cap = (xs: TeamLeadRef[]) => xs.sort(worstFirst).slice(0, ATTENTION_LIST_LIMIT);

  // ── Totals ──
  const sum = (pick: (r: ReturnType<typeof blank>) => number) =>
    [...acc.values()].reduce((s, r) => s + pick(r), 0);

  const newLeadTrend = bucketByLocalDay(
    trendLeads.map((l) => ({ at: l.createdAt })),
    now,
    TREND_DAYS,
  );

  const bdeRows: TeamBdeRow[] = roster.map((b) => ({
    userId: b.userId,
    displayName: b.displayName,
    role: b.role,
    ...acc.get(b.userId)!,
  }));

  return {
    scopeTeamWide: scope.teamWide,
    totals: {
      newLeadsToday: newLeadTrend[newLeadTrend.length - 1] ?? 0,
      newLeadsRange: newLeadsRange,
      assignedRange: assignments.length,
      contacts: sum((r) => r.contacts),
      tasksCompleted: sum((r) => r.tasksCompleted),
      tasksOnTime: sum((r) => r.tasksOnTime),
      slaBreaches: slaList.length,
      abandoned: abandonedList.length,
      noTask: noTaskList.length,
      stuck: stuckList.length,
      openReinquiry: sum((r) => r.openReinquiry),
      firstResponsePending: sum((r) => r.firstResponsePending),
      firstResponseBreached: sum((r) => r.firstResponseBreached),
      unassignedActive,
    },
    newLeadTrend,
    bdeRows,
    attention: {
      slaBreaches: cap(slaList),
      abandoned: cap(abandonedList),
      noTask: cap(noTaskList),
      stuck: cap(stuckList),
    },
  };
}

/**
 * Of the given users, those who are CRM managers rather than scored individual
 * contributors — a system admin or a sales-team lead (holder of the
 * {@link CRM_TEAM_LEAD_PAGE} marker). The L2 Scorecard excludes them: a team lead
 * (e.g. Devika) reviews the scorecard, they aren't ranked on it. Generalises the
 * "except Devika" rule so a future lead is handled automatically; the scorecard
 * also drops a small name-based list as a belt-and-suspenders guard.
 */
export async function getScorecardExcludedUserIds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, roleRef: { select: { isAdmin: true, pages: true } } },
  });
  return new Set(
    users
      .filter((u) => u.roleRef?.isAdmin || u.roleRef?.pages.includes(CRM_TEAM_LEAD_PAGE))
      .map((u) => u.id),
  );
}

// ── Attention drill-down queue (full, consultant-filterable) ─────────────────

/** The four attention buckets, as URL/query values for the drill-down filter. */
export type AttentionIssue = "sla" | "no-task" | "stuck" | "abandoned";

/** One flagged lead in the drill-down queue, with everything the detail table shows. */
export type AttentionQueueRow = {
  id: string;
  name: string;
  statusCode: string;
  statusLabel: string;
  statusColor: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  /** Days since last touch. */
  daysSinceTouch: number;
  /** Last-touch instant, or null when the lead was never touched (age falls back to creation). */
  lastTouchAt: Date | null;
  /** Days in the current status. */
  daysInStage: number;
  /** This status's SLA in days, or null when not SLA-monitored. */
  slaDays: number | null;
  slaBreached: boolean;
  abandoned: boolean;
  noNextStep: boolean;
  stuck: boolean;
  /** Earliest open-task due date, for context (null when none / no due date). */
  nextTaskDueAt: Date | null;
};

export type AttentionQueue = {
  rows: AttentionQueueRow[];
  /** Bucket counts across ALL rows (before any issue filter), for the summary chips. */
  counts: { total: number; sla: number; noTask: number; stuck: number; abandoned: number };
};

/**
 * The full, uncapped list of active owned leads that hit at least one attention
 * bucket (SLA breach / no next step / stuck / abandoned), optionally narrowed to
 * one consultant — the data behind `/crm/team/queue`. Shares every threshold and
 * the deliberate-assignment carve-out with {@link getTeamActivity} (via
 * {@link attentionFlags}), so its counts reconcile exactly with the dashboard.
 */
export async function getAttentionQueue(opts: {
  scope: TeamScope;
  /** Restrict to one consultant (userId). Ignored under a self-scoped BDE (already restricted to self). */
  consultantId?: string | null;
  now: Date;
}): Promise<AttentionQueue> {
  const { scope, now } = opts;
  const self = scope.restrictToUserId;
  // Self-view forces self; a team-view may narrow to a single consultant.
  const ownerId = self ?? (opts.consultantId || null);

  const roster = (await getAssignableBdes()).filter((b) => !self || b.userId === self);
  const nameById = new Map(roster.map((b) => [b.userId, b.displayName]));

  // Owned, active leads — the population, carryover-excluded below so the
  // unassigned/imported backlog never shows up as someone's attention item.
  const activeAssignedRaw = await prisma.lead.findMany({
    where: { status: { kind: "active" }, assignedToId: ownerId ? ownerId : { not: null } },
    select: {
      id: true,
      candidateName: true,
      assignedToId: true,
      assignedAt: true,
      createdAt: true,
      importBatch: { select: { createdAt: true } },
      status: { select: { code: true, label: true, color: true } },
    },
  });

  const attentionLeads = activeAssignedRaw.filter((l) =>
    isDeliberateAssignment({
      assignedToId: l.assignedToId,
      assignedAt: l.assignedAt,
      importBatchCreatedAt: l.importBatch?.createdAt ?? null,
    }),
  );
  const ids = attentionLeads.map((l) => l.id);

  const [openTaskGroups, touchGroups, statusChangeGroups] = await Promise.all([
    ids.length
      ? prisma.crmTask.groupBy({ by: ["leadId"], where: { status: "open", leadId: { in: ids } }, _min: { dueAt: true } })
      : Promise.resolve([] as Array<{ leadId: string; _min: { dueAt: Date | null } }>),
    ids.length
      ? prisma.leadActivity.groupBy({
          by: ["leadId"],
          where: { leadId: { in: ids }, ...touchActivityWhere() },
          _max: { occurredAt: true },
        })
      : Promise.resolve([] as Array<{ leadId: string; _max: { occurredAt: Date | null } }>),
    ids.length
      ? prisma.leadActivity.groupBy({
          by: ["leadId"],
          where: { leadId: { in: ids }, type: "STATUS_CHANGED" },
          _max: { occurredAt: true },
        })
      : Promise.resolve([] as Array<{ leadId: string; _max: { occurredAt: Date | null } }>),
  ]);

  const nextTaskByLead = new Map(openTaskGroups.map((g) => [g.leadId, g._min.dueAt]));
  const openTaskLeads = new Set(openTaskGroups.map((g) => g.leadId));
  const touchByLead = new Map(touchGroups.map((g) => [g.leadId, g._max.occurredAt]));
  const statusChangeByLead = new Map(statusChangeGroups.map((g) => [g.leadId, g._max.occurredAt]));

  const rows: AttentionQueueRow[] = [];
  const counts = { total: 0, sla: 0, noTask: 0, stuck: 0, abandoned: 0 };

  for (const l of attentionLeads) {
    const lastTouch = touchByLead.get(l.id) ?? null;
    const stuckSince = statusChangeByLead.get(l.id) ?? l.createdAt;
    const f = attentionFlags({
      statusCode: l.status.code,
      lastTouchAt: lastTouch ?? l.createdAt,
      stuckSince,
      hasOpenTask: openTaskLeads.has(l.id),
      nextTaskDueAt: nextTaskByLead.get(l.id) ?? null,
      now,
    });
    if (!f.flagged) continue;

    counts.total++;
    if (f.slaBreached) counts.sla++;
    if (f.noNextStep) counts.noTask++;
    if (f.stuck) counts.stuck++;
    if (f.abandoned) counts.abandoned++;

    rows.push({
      id: l.id,
      name: l.candidateName,
      statusCode: l.status.code,
      statusLabel: l.status.label,
      statusColor: l.status.color,
      assigneeId: l.assignedToId,
      assigneeName: l.assignedToId ? nameById.get(l.assignedToId) ?? null : null,
      daysSinceTouch: f.daysSinceTouch,
      lastTouchAt: lastTouch,
      daysInStage: f.daysInStage,
      slaDays: f.slaDays,
      slaBreached: f.slaBreached,
      abandoned: f.abandoned,
      noNextStep: f.noNextStep,
      stuck: f.stuck,
      nextTaskDueAt: nextTaskByLead.get(l.id) ?? null,
    });
  }

  // Worst-first: stalest (longest since a touch) at the top.
  rows.sort((a, b) => b.daysSinceTouch - a.daysSinceTouch);
  return { rows, counts };
}
