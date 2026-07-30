/**
 * CRM Daily Report — the submit-&-review surface behind `/crm/report`.
 *
 * Answers the BDE's end-of-day question: *what did I actually do today, and let
 * me sign off on it* — and the manager's: *who has reported, and does it look
 * right*. The day's numbers are AUTO-generated from the `LeadActivity` ledger +
 * related tables (notes, tasks, comms, assignments, enrolments) and the active-
 * time telemetry, so the BDE never re-enters activity; they only add a narrative
 * and submit. On submit the computed payload is FROZEN into `CrmDailyReport`
 * (an immutable snapshot); managers view the snapshot and mark it reviewed.
 *
 * Design notes (mirrors crm-team.ts):
 *   - All decision logic (the IST day window, day validation, the submit backdate
 *     window, view scope, and the submit/review state machine) lives in the pure
 *     exported helpers so it is unit-testable without a DB. The DB functions only
 *     query and shape.
 *   - THE DAY WINDOW IS IST, NOT SERVER-LOCAL. crm-team's `startOfLocalDay`
 *     uses server-local getters (= UTC on Vercel); reusing it here would drift up
 *     to 5.5h from the IST active-time bucket (ModuleUsageDaily.day) and mis-place
 *     early-morning / late-night activity. We build the window from the IST date
 *     helpers instead, and reuse only the TZ-independent predicates
 *     (`touchActivityWhere`, `outboundContactWhere`, `isDeliberateAssignment`).
 */
import { prisma } from "./prisma";
import {
  todayIst,
  toPrismaDate,
  fromPrismaDate,
  addDays,
  isWithinBackdateWindow,
} from "./lead-pulse-dates";
import { touchActivityWhere, outboundContactWhere, isDeliberateAssignment } from "./crm-team";
import { getCrmUsageByUser } from "./usage-metrics";
import { getAssignableBdes } from "./crm-leads";

// ── IST day window (unit-tested) ─────────────────────────────────────────────

/** IST is UTC+5:30 — the offset applied to turn an IST calendar day into its UTC instants. */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 19_800_000

export type IstDayWindow = {
  /** Inclusive UTC instant at IST 00:00:00 of the day (for DateTime range `gte`). */
  fromUtc: Date;
  /** Exclusive UTC instant at IST 00:00:00 of the NEXT day (for DateTime range `lt`). */
  toUtc: Date;
  /** The `@db.Date` value for the day (UTC midnight) — matches ModuleUsageDaily.day. */
  dayDate: Date;
};

/**
 * The UTC window bounding one IST calendar day `YYYY-MM-DD`. DateTime columns
 * (occurredAt / completedAt / createdAt / assignedAt) are filtered with
 * `{ gte: fromUtc, lt: toUtc }`; the `@db.Date` active-time column is filtered
 * with `{ gte: dayDate, lt: <next day's dayDate> }` (the `Range` shape
 * getCrmUsageByUser accepts), so both line up on the same IST day.
 */
export function istDayWindow(dayStr: string): IstDayWindow {
  const dayDate = toPrismaDate(dayStr);
  const nextDate = toPrismaDate(addDays(dayStr, 1));
  return {
    fromUtc: new Date(dayDate.getTime() - IST_OFFSET_MS),
    toUtc: new Date(nextDate.getTime() - IST_OFFSET_MS),
    dayDate,
  };
}

/**
 * Validate/normalise a requested report day. Returns a real IST `YYYY-MM-DD`,
 * defaulting to today and never returning a future day (a report can only cover
 * a day that has started). Rejects malformed and impossible dates (e.g.
 * 2026-02-31, which JS would otherwise roll into March).
 */
export function resolveReportDay(param: string | undefined, today: string = todayIst()): string {
  const p = (param ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p)) return today;
  const d = new Date(`${p}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || fromPrismaDate(d) !== p) return today; // impossible date
  if (p > today) return today; // never the future
  return p;
}

/**
 * Whether a BDE may still submit/resubmit a report for `dayStr`. Reuses the Lead
 * Pulse backdate window (today plus the prior {@link BACKDATE_DAYS} days), so a
 * BDE can file a late report for the last few days but not rewrite ancient
 * history. Future days are rejected by construction.
 */
export function canSubmitOn(dayStr: string, today: string = todayIst()): boolean {
  return isWithinBackdateWindow(dayStr, today);
}

// ── View scope + state machine (unit-tested) ─────────────────────────────────

export type ReportScope = {
  /** The signed-in user's own id (the report they may author). */
  selfUserId: string;
  /** True when the viewer may see OTHER BDEs' reports (a manager). */
  canViewOthers: boolean;
  /** The BDE whose report to render, or null to render the team roll-up. */
  targetUserId: string | null;
  /** True when the page should show the team roll-up rather than a single report. */
  rollup: boolean;
};

/**
 * Resolve whose report the `/crm/report` page shows. A plain BDE is locked to
 * their own report. A manager (system admin, CRM-admin tier, Lead Pulse
 * supervisor, or view-only CRM team lead) may pick any BDE via `?bde=<userId>`,
 * and with no selection lands on the team roll-up (who has / hasn't reported).
 */
export function resolveReportScope(
  access: {
    isAdmin: boolean;
    isSupervisor: boolean;
    canManageCrm: boolean;
    isCrmTeamLead?: boolean;
    userId: string;
  },
  requestedBde?: string,
): ReportScope {
  const canViewOthers =
    access.isAdmin || access.isSupervisor || access.canManageCrm || !!access.isCrmTeamLead;
  if (!canViewOthers) {
    return { selfUserId: access.userId, canViewOthers: false, targetUserId: access.userId, rollup: false };
  }
  const bde = (requestedBde ?? "").trim();
  if (bde) {
    return { selfUserId: access.userId, canViewOthers: true, targetUserId: bde, rollup: false };
  }
  return { selfUserId: access.userId, canViewOthers: true, targetUserId: null, rollup: true };
}

export type ReportStatus = "none" | "submitted" | "reviewed";

export function isReviewed(report: { status: string } | null | undefined): boolean {
  return report?.status === "reviewed";
}

/**
 * Whether the narrative form is editable: only the owner, and only until a
 * manager has reviewed it. A missing report (not yet submitted) is editable by
 * its owner.
 */
export function canEditNarrative(report: { status: string } | null | undefined, isOwner: boolean): boolean {
  if (!isOwner) return false;
  return !isReviewed(report);
}

/**
 * Whether the viewer may mark a report reviewed. Managers who can ACT on reports
 * (system admin, CRM-admin tier, Lead Pulse supervisor) — deliberately narrower
 * than `canViewOthers`, so a view-only CRM team lead can read reports without
 * signing them off.
 */
export function canReviewReports(access: {
  isAdmin: boolean;
  isSupervisor: boolean;
  canManageCrm: boolean;
}): boolean {
  return access.isAdmin || access.isSupervisor || access.canManageCrm;
}

// ── Payload types ────────────────────────────────────────────────────────────

export type DailyReportMetrics = {
  /** Distinct active leads the BDE touched (any activity except a passive view / bulk email). */
  leadsTouched: number;
  notesAdded: number;
  tasksCompleted: number;
  tasksCreated: number;
  /** Open tasks assigned to the BDE due on/before the end of the day (today's workload). */
  tasksOpen: number;
  calls: number;
  emails: number;
  whatsapp: number;
  /** calls + emails + whatsapp. */
  contacts: number;
  /** Leads genuinely (re)assigned to the BDE this day (bulk-import carryover excluded). */
  newLeadsAssigned: number;
  statusChanges: number;
  enrollments: number;
  /** Active CRM time in seconds for the day (focused & interacting, not open-tab). */
  activeSeconds: number;
};

export type ReportNoteItem = { id: string; leadId: string; leadName: string; body: string; createdAt: string };
export type ReportTaskItem = {
  id: string;
  leadId: string;
  leadName: string;
  subject: string;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
};
export type ReportCommItem = {
  id: string;
  leadId: string;
  leadName: string;
  type: string;
  summary: string | null;
  occurredAt: string;
};
export type ReportLeadItem = {
  id: string;
  name: string;
  statusLabel: string;
  statusColor: string | null;
  touches: number;
};

export type DailyReportDetails = {
  notes: ReportNoteItem[];
  tasksCompleted: ReportTaskItem[];
  tasksCreated: ReportTaskItem[];
  tasksOpen: ReportTaskItem[];
  comms: ReportCommItem[];
  leadsTouched: ReportLeadItem[];
};

/** The persisted report row, serialised to plain JSON for the client. */
export type StoredReportRow = {
  id: string;
  status: ReportStatus;
  summary: string;
  blockers: string | null;
  planNext: string | null;
  submittedAt: string;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewerNote: string | null;
};

export type DailyReportView = {
  day: string;
  userId: string;
  displayName: string;
  metrics: DailyReportMetrics;
  details: DailyReportDetails;
  /** The persisted report, or null when nothing has been submitted for this day yet. */
  report: StoredReportRow | null;
  /** True when metrics/details were computed live (draft); false when read from the frozen snapshot. */
  live: boolean;
};

export type TeamRollupRow = {
  userId: string;
  displayName: string;
  role: string;
  status: ReportStatus;
  reportId: string | null;
  submittedAt: string | null;
  reviewedByName: string | null;
  /** At-a-glance figures from the frozen snapshot (null until submitted). */
  contacts: number | null;
  tasksCompleted: number | null;
  notesAdded: number | null;
  leadsTouched: number | null;
};

// ── DB query layer ───────────────────────────────────────────────────────────

/**
 * Auto-generate the day's KPI summary + detail lists for one BDE, from the
 * activity ledger + related tables. Pure of any narrative/persistence — this is
 * what gets shown live in the draft and frozen into the snapshot on submit.
 */
export async function computeDailyReport(opts: {
  userId: string;
  dayStr: string;
}): Promise<{ metrics: DailyReportMetrics; details: DailyReportDetails }> {
  const { userId, dayStr } = opts;
  const { fromUtc, toUtc, dayDate } = istDayWindow(dayStr);
  const window = { gte: fromUtc, lt: toUtc };

  const [
    touchGroups,
    notes,
    tasksCompleted,
    tasksCreated,
    tasksOpen,
    commsRaw,
    assignedRaw,
    statusChanges,
    enrollments,
    usage,
  ] = await Promise.all([
    // Distinct leads touched, with a per-lead touch count.
    prisma.leadActivity.groupBy({
      by: ["leadId"],
      where: { actorId: userId, occurredAt: window, ...touchActivityWhere() },
      _count: { _all: true },
    }),
    // Notes authored today.
    prisma.leadNote.findMany({
      where: { authorId: userId, createdAt: window },
      select: { id: true, body: true, createdAt: true, lead: { select: { id: true, candidateName: true } } },
      orderBy: { createdAt: "asc" },
    }),
    // Tasks the BDE completed today.
    prisma.crmTask.findMany({
      where: { status: "done", completedById: userId, completedAt: window },
      select: {
        id: true,
        subject: true,
        status: true,
        dueAt: true,
        completedAt: true,
        lead: { select: { id: true, candidateName: true } },
      },
      orderBy: { completedAt: "asc" },
    }),
    // Tasks the BDE created today.
    prisma.crmTask.findMany({
      where: { createdById: userId, createdAt: window },
      select: {
        id: true,
        subject: true,
        status: true,
        dueAt: true,
        completedAt: true,
        lead: { select: { id: true, candidateName: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    // Open tasks assigned to the BDE due on/before the end of this day (workload).
    prisma.crmTask.findMany({
      where: { assignedToId: userId, status: "open", dueAt: { lt: toUtc } },
      select: {
        id: true,
        subject: true,
        status: true,
        dueAt: true,
        completedAt: true,
        lead: { select: { id: true, candidateName: true } },
      },
      orderBy: { dueAt: "asc" },
    }),
    // Outbound contacts logged today (calls / emails / whatsapp; bulk email excluded).
    prisma.leadActivity.findMany({
      where: { actorId: userId, occurredAt: window, ...outboundContactWhere() },
      select: { id: true, leadId: true, type: true, summary: true, occurredAt: true, lead: { select: { candidateName: true } } },
      orderBy: { occurredAt: "asc" },
    }),
    // Leads (re)assigned to the BDE today — carryover-filtered below.
    prisma.lead.findMany({
      where: { assignedToId: userId, assignedAt: window },
      select: { id: true, assignedToId: true, assignedAt: true, importBatch: { select: { createdAt: true } } },
    }),
    prisma.leadActivity.count({ where: { actorId: userId, type: "STATUS_CHANGED", occurredAt: window } }),
    prisma.leadActivity.count({ where: { actorId: userId, type: "ENROLLED", occurredAt: window } }),
    // Active CRM time — the @db.Date bucket for this IST day.
    getCrmUsageByUser({ from: dayDate, to: toPrismaDate(addDays(dayStr, 1)) }, [userId]),
  ]);

  // Lead context for the touched-leads list (names + status).
  const touchedIds = touchGroups.map((g) => g.leadId);
  const touchedLeads = touchedIds.length
    ? await prisma.lead.findMany({
        where: { id: { in: touchedIds } },
        select: { id: true, candidateName: true, status: { select: { label: true, color: true } } },
      })
    : [];
  const touchCountByLead = new Map(touchGroups.map((g) => [g.leadId, g._count._all]));
  const leadsTouched: ReportLeadItem[] = touchedLeads
    .map((l) => ({
      id: l.id,
      name: l.candidateName,
      statusLabel: l.status.label,
      statusColor: l.status.color,
      touches: touchCountByLead.get(l.id) ?? 0,
    }))
    .sort((a, b) => b.touches - a.touches || a.name.localeCompare(b.name));

  // Outbound-contact breakdown, derived from the fetched list (no extra query).
  let calls = 0;
  let emails = 0;
  let whatsapp = 0;
  const comms: ReportCommItem[] = commsRaw.map((c) => {
    if (c.type === "CALL_LOGGED") calls++;
    else if (c.type === "EMAIL_SENT") emails++;
    else if (c.type === "WHATSAPP_SENT") whatsapp++;
    return {
      id: c.id,
      leadId: c.leadId,
      leadName: c.lead?.candidateName ?? "—",
      type: c.type,
      summary: c.summary,
      occurredAt: c.occurredAt.toISOString(),
    };
  });

  const newLeadsAssigned = assignedRaw.filter((l) =>
    isDeliberateAssignment({
      assignedToId: l.assignedToId,
      assignedAt: l.assignedAt,
      importBatchCreatedAt: l.importBatch?.createdAt ?? null,
    }),
  ).length;

  const toTask = (t: {
    id: string;
    subject: string;
    status: string;
    dueAt: Date | null;
    completedAt: Date | null;
    lead: { id: string; candidateName: string };
  }): ReportTaskItem => ({
    id: t.id,
    leadId: t.lead.id,
    leadName: t.lead.candidateName,
    subject: t.subject,
    status: t.status,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
  });

  const metrics: DailyReportMetrics = {
    leadsTouched: touchGroups.length,
    notesAdded: notes.length,
    tasksCompleted: tasksCompleted.length,
    tasksCreated: tasksCreated.length,
    tasksOpen: tasksOpen.length,
    calls,
    emails,
    whatsapp,
    contacts: comms.length,
    newLeadsAssigned,
    statusChanges,
    enrollments,
    activeSeconds: usage.get(userId)?.totalSeconds ?? 0,
  };

  const details: DailyReportDetails = {
    notes: notes.map((n) => ({
      id: n.id,
      leadId: n.lead.id,
      leadName: n.lead.candidateName,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
    })),
    tasksCompleted: tasksCompleted.map(toTask),
    tasksCreated: tasksCreated.map(toTask),
    tasksOpen: tasksOpen.map(toTask),
    comms,
    leadsTouched,
  };

  return { metrics, details };
}

/** The persisted report for a (BDE, day), serialised, or null when none exists. */
export async function getStoredReport(userId: string, dayStr: string): Promise<StoredReportRow | null> {
  const r = await prisma.crmDailyReport.findUnique({
    where: { userId_day: { userId, day: toPrismaDate(dayStr) } },
    include: {
      reviewedBy: { select: { username: true, leadPulseRole: { select: { displayName: true } } } },
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    status: (r.status as ReportStatus) ?? "submitted",
    summary: r.summary,
    blockers: r.blockers,
    planNext: r.planNext,
    submittedAt: r.submittedAt.toISOString(),
    reviewedById: r.reviewedById,
    reviewedByName: r.reviewedBy
      ? r.reviewedBy.leadPulseRole?.displayName ?? r.reviewedBy.username
      : null,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    reviewerNote: r.reviewerNote,
  };
}

/**
 * The full view for one BDE's day: the frozen snapshot when a report exists
 * (so a reviewed report shows exactly what was submitted), else a live-computed
 * preview the owner can still edit and submit.
 */
export async function getDailyReportView(opts: {
  userId: string;
  displayName: string;
  dayStr: string;
}): Promise<DailyReportView> {
  const { userId, displayName, dayStr } = opts;
  const stored = await getStoredReport(userId, dayStr);
  if (stored) {
    const raw = await prisma.crmDailyReport.findUnique({
      where: { userId_day: { userId, day: toPrismaDate(dayStr) } },
      select: { metrics: true, details: true },
    });
    return {
      day: dayStr,
      userId,
      displayName,
      metrics: (raw?.metrics ?? {}) as unknown as DailyReportMetrics,
      details: (raw?.details ?? {}) as unknown as DailyReportDetails,
      report: stored,
      live: false,
    };
  }
  const { metrics, details } = await computeDailyReport({ userId, dayStr });
  return { day: dayStr, userId, displayName, metrics, details, report: null, live: true };
}

/** Order for the roll-up: not-yet-reported first (needs a nudge), then submitted, then reviewed. */
const STATUS_ORDER: Record<ReportStatus, number> = { none: 0, submitted: 1, reviewed: 2 };

/**
 * The team roll-up for a day — every active BDE joined to their report (if any),
 * so a manager sees who has reported, who is pending, and each report's headline
 * figures pulled from the frozen snapshot. Managers only.
 */
export async function getTeamRollup(opts: { dayStr: string }): Promise<TeamRollupRow[]> {
  const { dayStr } = opts;
  const roster = await getAssignableBdes();
  const reports = await prisma.crmDailyReport.findMany({
    where: { day: toPrismaDate(dayStr) },
    select: { id: true, userId: true, status: true, submittedAt: true, metrics: true, reviewedBy: { select: { username: true, leadPulseRole: { select: { displayName: true } } } } },
  });
  const byUser = new Map(reports.map((r) => [r.userId, r]));

  const rows: TeamRollupRow[] = roster.map((b) => {
    const r = byUser.get(b.userId);
    if (!r) {
      return {
        userId: b.userId,
        displayName: b.displayName,
        role: b.role,
        status: "none",
        reportId: null,
        submittedAt: null,
        reviewedByName: null,
        contacts: null,
        tasksCompleted: null,
        notesAdded: null,
        leadsTouched: null,
      };
    }
    const m = (r.metrics ?? {}) as unknown as Partial<DailyReportMetrics>;
    return {
      userId: b.userId,
      displayName: b.displayName,
      role: b.role,
      status: (r.status as ReportStatus) ?? "submitted",
      reportId: r.id,
      submittedAt: r.submittedAt.toISOString(),
      reviewedByName: r.reviewedBy ? r.reviewedBy.leadPulseRole?.displayName ?? r.reviewedBy.username : null,
      contacts: m.contacts ?? 0,
      tasksCompleted: m.tasksCompleted ?? 0,
      notesAdded: m.notesAdded ?? 0,
      leadsTouched: m.leadsTouched ?? 0,
    };
  });

  return rows.sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.displayName.localeCompare(b.displayName),
  );
}
