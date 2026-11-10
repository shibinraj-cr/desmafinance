/**
 * The DB side of the daily lead report (rules: crm-lead-report.ts).
 *
 * BDEs submit nothing: at each day's cutoff the lead-cutoff cron generates
 * every active BDE's report (generateDayReports) and freezes it into
 * `CrmDailyReport` (`locked`). A generated day is read from that snapshot; any
 * other day is computed live, and every live reader first re-judges the
 * assignments it is about to count (evaluateAssignments), so a lead contacted
 * a minute ago shows as contacted without waiting for the cron.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { Permissions } from "./rbac";
import { getCrmAccess, type CrmAccess } from "./crm-rbac";
import { getAssignableBdes } from "./crm-leads";
import { loadHolidaySet } from "./ops-dates";
import { todayIst, toPrismaDate } from "./lead-pulse-dates";
import { computeDailyReport, istDayWindow, getStoredReport, type StoredReportRow } from "./crm-daily-report";
import { logger } from "./logger";
import { cutoffOn } from "./crm-cutoff";
import { evaluateContact, type ContactHalves } from "./crm-contact";
import { MISSED_RECHECK_DAYS, evaluateAssignments, loadContactEvents } from "./crm-contact-data";
import { getHandoverAccess, listHandovers, type HandoverRow } from "./crm-handover-data";
import { OPEN_HANDOVER_STATUSES } from "./crm-handover";
import {
  buildLeadReport,
  leadReportShareText,
  reportSource,
  sumReports,
  type HandoverCounts,
  type LeadCounts,
  type LeadReport,
  type LeadReportSource,
  type ReportAssignment,
} from "./crm-lead-report";

const DAY_MS = 86_400_000;
const QUEUE_LIMIT = 200;

// ── Access ───────────────────────────────────────────────────────────────────

export type LeadReportAccess = {
  crm: CrmAccess;
  /** May open any BDE's report and the team view: CRM managers and the Marketing Admin. */
  canViewOthers: boolean;
};

export async function getLeadReportAccess(userId: string, perms: Permissions | null): Promise<LeadReportAccess> {
  const crm = await getCrmAccess(userId, perms);
  const handover = await getHandoverAccess(userId, perms, crm);
  return {
    crm,
    canViewOthers: crm.isAdmin || crm.isSupervisor || crm.canManageCrm || crm.isCrmTeamLead || handover.canManage,
  };
}

// ── Loading ──────────────────────────────────────────────────────────────────

type DayAssignment = ReportAssignment & {
  id: string;
  userId: string;
  leadId: string;
  candidateName: string;
  firstContactedAt: Date | null;
};

/** Assignments received or due on `day` — one BDE's, or everyone's. */
async function loadDayAssignments(day: string, userId?: string): Promise<DayAssignment[]> {
  const { fromUtc, toUtc } = istDayWindow(day);
  const window = { gte: fromUtc, lt: toUtc };
  const rows = await prisma.crmLeadAssignment.findMany({
    where: { ...(userId ? { userId } : {}), OR: [{ assignedAt: window }, { contactDueAt: window }] },
    select: {
      id: true,
      userId: true,
      leadId: true,
      assignedAt: true,
      contactDueAt: true,
      contactStatus: true,
      firstContactedAt: true,
      lead: { select: { candidateName: true, sourceId: true, source: { select: { label: true } } } },
    },
  });
  const channelByLead = await handoverChannels(rows.map((r) => r.leadId));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    leadId: r.leadId,
    candidateName: r.lead.candidateName,
    assignedAt: r.assignedAt,
    contactDueAt: r.contactDueAt,
    contactStatus: r.contactStatus,
    firstContactedAt: r.firstContactedAt,
    ...reportSource(
      { sourceId: r.lead.sourceId, sourceLabel: r.lead.source?.label ?? null },
      channelByLead.get(r.leadId) ?? null,
    ),
  }));
}

/** The handover channel of each lead created from a handover. */
async function handoverChannels(leadIds: string[]): Promise<Map<string, string>> {
  if (leadIds.length === 0) return new Map();
  const rows = await prisma.crmLeadHandover.findMany({
    where: { linkedLeadId: { in: [...new Set(leadIds)] }, status: "created" },
    select: { linkedLeadId: true, channel: true },
    orderBy: { createdAt: "asc" },
  });
  const out = new Map<string, string>();
  for (const r of rows) if (r.linkedLeadId && !out.has(r.linkedLeadId)) out.set(r.linkedLeadId, r.channel);
  return out;
}

async function handoversGiven(day: string, userId?: string) {
  return prisma.crmLeadHandover.findMany({
    where: { handoverDate: toPrismaDate(day), ...(userId ? { assignedBdeId: userId } : {}) },
    select: { assignedBdeId: true, status: true, isLate: true },
  });
}

async function buildFor(userId: string, day: string): Promise<LeadReport> {
  const [rows, handovers] = await Promise.all([loadDayAssignments(day, userId), handoversGiven(day, userId)]);
  return buildLeadReport(day, rows, handovers);
}

/** The BDE's report for `day`, computed now. */
export async function computeLeadReport(userId: string, day: string, now: Date = new Date()): Promise<LeadReport> {
  await evaluateAssignments({ userId, now });
  return buildFor(userId, day);
}

/** The frozen lead report of a generated day, or null. */
async function lockedSnapshot(userId: string, day: string): Promise<LeadReport | null> {
  const r = await prisma.crmDailyReport.findUnique({
    where: { userId_day: { userId, day: toPrismaDate(day) } },
    select: { locked: true, leadReport: true },
  });
  return r?.locked && r.leadReport ? (r.leadReport as unknown as LeadReport) : null;
}

// ── Generated at the cutoff ──────────────────────────────────────────────────

/**
 * Generate `day`'s report for every active BDE: the lead report and the
 * activity snapshot, frozen into their CrmDailyReport and locked. The
 * lead-cutoff cron calls it once the day's cutoff has passed (after re-judging
 * the assignments), and again for the day before in case a tick was missed. A
 * BDE whose day is already locked is skipped; remarks they added are kept.
 * Returns how many reports were generated.
 */
export async function generateDayReports(day: string, now: Date = new Date()): Promise<number> {
  const roster = await getAssignableBdes();
  if (roster.length === 0) return 0;
  const dayDate = toPrismaDate(day);
  const existing = await prisma.crmDailyReport.findMany({
    where: { day: dayDate, userId: { in: roster.map((b) => b.userId) } },
    select: { userId: true, locked: true },
  });
  const done = new Set(existing.filter((r) => r.locked).map((r) => r.userId));

  let generated = 0;
  for (const b of roster) {
    if (done.has(b.userId)) continue;
    try {
      const [{ metrics, details }, leadReport] = await Promise.all([
        computeDailyReport({ userId: b.userId, dayStr: day }),
        buildFor(b.userId, day),
      ]);
      const snapshot = {
        metrics: metrics as unknown as Prisma.InputJsonValue,
        details: details as unknown as Prisma.InputJsonValue,
        leadReport: leadReportJson(leadReport),
        locked: true,
        submittedAt: now,
      };
      await prisma.crmDailyReport.upsert({
        where: { userId_day: { userId: b.userId, day: dayDate } },
        create: { userId: b.userId, day: dayDate, status: "submitted", summary: "", ...snapshot },
        update: snapshot,
      });
      generated++;
    } catch (err) {
      logger.error("lead_report_generate_failed", {
        userId: b.userId,
        day,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return generated;
}

// ── "Contact before the cutoff" ──────────────────────────────────────────────

export type QueueItem = {
  assignmentId: string;
  leadId: string;
  candidateName: string;
  phone: string | null;
  sourceLabel: string | null;
  assignedAt: string;
  dueAt: string;
  /** "missed" = past its cutoff and still uncontacted — still worth contacting. */
  status: "pending" | "missed";
  halves: ContactHalves;
};

/**
 * The BDE's leads still waiting for contact — due soonest first, so recent
 * misses lead the list — with what they have done so far on each, for hints
 * like "called, note missing".
 */
export async function contactQueue(userId: string, now: Date = new Date()): Promise<QueueItem[]> {
  const rows = await prisma.crmLeadAssignment.findMany({
    where: {
      userId,
      endedAt: null,
      OR: [
        { contactStatus: "pending" },
        { contactStatus: "missed", assignedAt: { gte: new Date(now.getTime() - MISSED_RECHECK_DAYS * DAY_MS) } },
      ],
    },
    orderBy: [{ contactDueAt: "asc" }, { assignedAt: "asc" }],
    take: QUEUE_LIMIT,
    select: {
      id: true,
      leadId: true,
      userId: true,
      assignedAt: true,
      contactDueAt: true,
      endedAt: true,
      contactStatus: true,
      lead: { select: { candidateName: true, phone: true, phoneE164: true, source: { select: { label: true } } } },
    },
  });
  const events = await loadContactEvents(rows);
  return rows.map((r) => ({
    assignmentId: r.id,
    leadId: r.leadId,
    candidateName: r.lead.candidateName,
    phone: r.lead.phoneE164 ?? r.lead.phone,
    sourceLabel: r.lead.source?.label ?? null,
    assignedAt: r.assignedAt.toISOString(),
    dueAt: r.contactDueAt.toISOString(),
    status: r.contactStatus === "missed" ? "missed" : "pending",
    halves: evaluateContact(r, events.get(r.leadId) ?? [], now).halves,
  }));
}

// ── One BDE ──────────────────────────────────────────────────────────────────

export type LeadReportView = {
  day: string;
  today: string;
  bde: { id: string; name: string };
  report: LeadReport;
  /** False when read from the report generated at the cutoff. */
  live: boolean;
  submission: StoredReportRow | null;
  /** Leads to contact — today only. */
  queue: QueueItem[] | null;
  /** Handovers given on the day, plus any still open. */
  handovers: HandoverRow[];
  shareText: string;
  /** Today's cutoff (null on Sundays, holidays and past days). */
  cutoff: string | null;
};

export async function bdeName(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, leadPulseRole: { select: { displayName: true } } },
  });
  return u ? (u.leadPulseRole?.displayName ?? u.username) : null;
}

export async function getLeadReportView(opts: {
  userId: string;
  name: string;
  day: string;
  now?: Date;
}): Promise<LeadReportView> {
  const now = opts.now ?? new Date();
  const today = todayIst();
  const isToday = opts.day === today;

  const [snapshot, submission] = await Promise.all([
    lockedSnapshot(opts.userId, opts.day),
    getStoredReport(opts.userId, opts.day),
  ]);
  const report = snapshot ?? (await computeLeadReport(opts.userId, opts.day, now));
  const [queue, handovers, holidays] = await Promise.all([
    isToday ? contactQueue(opts.userId, now) : Promise.resolve(null),
    listHandovers({
      assignedBdeId: opts.userId,
      OR: [{ handoverDate: toPrismaDate(opts.day) }, ...(isToday ? [{ status: { in: OPEN_HANDOVER_STATUSES } }] : [])],
    }),
    loadHolidaySet(prisma),
  ]);
  const cutoff = isToday ? cutoffOn(today, holidays) : null;
  return {
    day: opts.day,
    today,
    bde: { id: opts.userId, name: opts.name },
    report,
    live: !snapshot,
    submission,
    queue,
    handovers,
    shareText: leadReportShareText(report, opts.name),
    cutoff: cutoff?.toISOString() ?? null,
  };
}

// ── The team ─────────────────────────────────────────────────────────────────

export type TeamLeadReportRow = {
  userId: string;
  name: string;
  role: string;
  totals: LeadCounts;
  sources: LeadReportSource[];
  handovers: HandoverCounts;
  live: boolean;
  submission: { reportId: string; status: string; locked: boolean; submittedAt: string } | null;
};

export type MissedLead = {
  assignmentId: string;
  leadId: string;
  candidateName: string;
  bdeId: string;
  bdeName: string;
  sourceLabel: string;
  assignedAt: string;
  dueAt: string;
  /** Set when it was contacted after the cutoff. */
  contactedLateAt: string | null;
};

export type TeamLeadReport = {
  day: string;
  /** The day's cutoff (null on a Sunday or holiday). */
  cutoff: string | null;
  rows: TeamLeadReportRow[];
  totals: LeadCounts;
  handoverTotals: HandoverCounts;
  missed: MissedLead[];
  /** Given on the day, plus any still overdue. */
  handovers: HandoverRow[];
};

export async function getTeamLeadReport(day: string, now: Date = new Date()): Promise<TeamLeadReport> {
  await evaluateAssignments({ now });
  const [roster, assignments, given, stored, handovers, holidays] = await Promise.all([
    getAssignableBdes(),
    loadDayAssignments(day),
    handoversGiven(day),
    prisma.crmDailyReport.findMany({
      where: { day: toPrismaDate(day) },
      select: { id: true, userId: true, status: true, locked: true, submittedAt: true, leadReport: true },
    }),
    listHandovers({ OR: [{ handoverDate: toPrismaDate(day) }, { status: "overdue" }] }),
    loadHolidaySet(prisma),
  ]);
  const storedBy = new Map(stored.map((s) => [s.userId, s]));

  const rows: TeamLeadReportRow[] = roster.map((b) => {
    const s = storedBy.get(b.userId);
    const snapshot = s?.locked && s.leadReport ? (s.leadReport as unknown as LeadReport) : null;
    const report =
      snapshot ??
      buildLeadReport(
        day,
        assignments.filter((a) => a.userId === b.userId),
        given.filter((h) => h.assignedBdeId === b.userId),
      );
    return {
      userId: b.userId,
      name: b.displayName,
      role: b.role,
      totals: report.totals,
      sources: report.sources,
      handovers: report.handovers,
      live: !snapshot,
      submission: s
        ? { reportId: s.id, status: s.status, locked: s.locked, submittedAt: s.submittedAt.toISOString() }
        : null,
    };
  });
  const sum = sumReports(rows.map((r) => ({ totals: r.totals, handovers: r.handovers })));
  const names = new Map(roster.map((b) => [b.userId, b.displayName]));
  const { fromUtc, toUtc } = istDayWindow(day);

  const missed: MissedLead[] = assignments
    .filter(
      (a) =>
        (a.contactStatus === "missed" || a.contactStatus === "contacted_late") &&
        a.contactDueAt >= fromUtc &&
        a.contactDueAt < toUtc &&
        names.has(a.userId),
    )
    .sort((x, y) => x.contactDueAt.getTime() - y.contactDueAt.getTime())
    .map((a) => ({
      assignmentId: a.id,
      leadId: a.leadId,
      candidateName: a.candidateName,
      bdeId: a.userId,
      bdeName: names.get(a.userId)!,
      sourceLabel: a.sourceLabel,
      assignedAt: a.assignedAt.toISOString(),
      dueAt: a.contactDueAt.toISOString(),
      contactedLateAt: a.contactStatus === "contacted_late" ? (a.firstContactedAt?.toISOString() ?? null) : null,
    }));

  return {
    day,
    cutoff: cutoffOn(day, holidays)?.toISOString() ?? null,
    rows,
    totals: sum.totals,
    handoverTotals: sum.handovers,
    missed,
    handovers,
  };
}

/** Freeze `report` into the BDE's CrmDailyReport for submit. */
export function leadReportJson(report: LeadReport): Prisma.InputJsonValue {
  return report as unknown as Prisma.InputJsonValue;
}
