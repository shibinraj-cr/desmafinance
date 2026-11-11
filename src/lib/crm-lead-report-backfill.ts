/**
 * Backfill the daily lead report for days before tracking began.
 *
 * Contact tracking (CrmLeadAssignment) only starts at go-live. Everything the
 * report needs for earlier days is in the ledger, though: every assignment,
 * reassignment and release is a LeadActivity, and so is every call, note,
 * WhatsApp and stage/Status change, each with who did it and when. This
 * rebuilds the assignments from before tracking began, judges each against its
 * cutoff with today's rule (R1), and builds every BDE's report for every
 * working day in the range — merged with the assignments already tracked.
 *
 * Bulk-import carryover (leads pre-assigned by a file import) is left out, the
 * same rule the CRM's SLA and first-response numbers use (isDeliberateAssignment).
 *
 * Dry run computes everything and writes nothing. Apply:
 *   - adds the rebuilt assignments (CrmLeadAssignment, judged and closed);
 *   - adds the day's lead report to every BDE's CrmDailyReport, keeping any
 *     report a BDE submitted before (its narrative and activity numbers stay);
 *     creates the missing ones, generated at that day's cutoff;
 *   - moves the tracking start back to the first day.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getAssignableBdes } from "./crm-leads";
import { loadHolidaySet } from "./ops-dates";
import { addDays, toPrismaDate } from "./lead-pulse-dates";
import { computeDailyReport, istDayWindow } from "./crm-daily-report";
import { cutoffOn, nextCutoff } from "./crm-cutoff";
import { evaluateContact, type ContactHalves, type ContactRule, type ContactStatus } from "./crm-contact";
import { LEAD_REPORT_START_KEY, leadReportStart, loadContactEvents } from "./crm-contact-data";
import { isDeliberateAssignment } from "./crm-team";
import { handoverChannels, leadReportJson } from "./crm-lead-report-data";
import { buildLeadReport, reportSource, type LeadReport, type ReportAssignment } from "./crm-lead-report";

const ASSIGNMENT_TYPES = ["ASSIGNED", "REASSIGNED", "UNASSIGNED"] as const;
/** How far before the first day assignments are rebuilt, for leads carried in to it. */
const LOOKBACK_DAYS = 7;
/** The ASSIGNED entry is written just after Lead.assignedAt is stamped; this matches the two up. */
const SAME_ASSIGNMENT_MS = 5 * 60_000;
const CHUNK = 500;

// ── Rebuilding assignments (pure) ────────────────────────────────────────────

export type AssignmentEvent = { leadId: string; type: string; toUserId: string | null; at: Date };
export type LeadState = {
  id: string;
  assignedToId: string | null;
  assignedAt: Date | null;
  importBatchCreatedAt: Date | null;
  createdAt?: Date | null;
};
export type Episode = {
  leadId: string;
  userId: string;
  assignedAt: Date;
  endedAt: Date | null;
  /** The BDE the lead was taken from, when this assignment was a reassignment. */
  previousUserId: string | null;
};

/**
 * Replay each lead's assignment history into episodes — one per time it was
 * given to a BDE — and keep those starting in [from, until). `events` should run
 * up to now so an episode that ends after `until` ends at the right moment. The
 * lead's current episode takes the exact `Lead.assignedAt` (the key the live
 * tracking uses), an assignment the ledger never logged (re-enrolment) comes
 * from the lead itself, and bulk-import carryover is dropped.
 */
export function rebuildEpisodes(events: AssignmentEvent[], leads: LeadState[], from: Date, until: Date): Episode[] {
  const byLead = new Map<string, AssignmentEvent[]>();
  for (const e of events) {
    const list = byLead.get(e.leadId);
    if (list) list.push(e);
    else byLead.set(e.leadId, [e]);
  }
  const out: Episode[] = [];
  for (const lead of leads) {
    const evs = (byLead.get(lead.id) ?? []).sort((a, b) => a.at.getTime() - b.at.getTime());
    const episodes: Episode[] = [];
    let open = null as Episode | null;
    for (const e of evs) {
      if (e.type === "UNASSIGNED" || !e.toUserId) {
        if (open) open.endedAt = e.at;
        open = null;
        continue;
      }
      if (open?.userId === e.toUserId) continue; // same owner again — not a new assignment
      if (open) open.endedAt = e.at;
      open = { leadId: lead.id, userId: e.toUserId, assignedAt: e.at, endedAt: null, previousUserId: open?.userId ?? null };
      episodes.push(open);
    }
    // The current owner: line the episode up with Lead.assignedAt, or add it if
    // the ledger never logged it (and nothing logged after contradicts it).
    if (lead.assignedToId && lead.assignedAt) {
      const last = evs[evs.length - 1];
      if (open && open.userId === lead.assignedToId) {
        open.assignedAt = lead.assignedAt;
      } else if (!last || lead.assignedAt.getTime() >= last.at.getTime() - SAME_ASSIGNMENT_MS) {
        if (open) open.endedAt = lead.assignedAt;
        episodes.push({ leadId: lead.id, userId: lead.assignedToId, assignedAt: lead.assignedAt, endedAt: null, previousUserId: open?.userId ?? null });
      }
    }
    for (const ep of episodes) {
      const at = ep.assignedAt.getTime();
      if (at < from.getTime() || at >= until.getTime()) continue;
      const deliberate = isDeliberateAssignment({
        assignedToId: ep.userId,
        assignedAt: ep.assignedAt,
        importBatchCreatedAt: lead.importBatchCreatedAt,
      });
      if (deliberate) out.push(ep);
    }
  }
  return out;
}

// ── What the history shows (pure) ────────────────────────────────────────────

export type AssignmentKind = "fresh" | "older" | "reassigned";

/**
 * A new lead (created within a day of the assignment), an older one handed out
 * (from the pool, a backlog, a revival), or one taken over from another BDE.
 */
export function assignmentKind(ep: Pick<Episode, "assignedAt" | "previousUserId">, leadCreatedAt: Date | null): AssignmentKind {
  if (ep.previousUserId) return "reassigned";
  if (leadCreatedAt && ep.assignedAt.getTime() - leadCreatedAt.getTime() <= 86_400_000) return "fresh";
  return "older";
}

export type MissReason = "nothing" | "call_no_note" | "stage_only" | "whatsapp_no_stage" | "note_only" | "late";

/** Why a lead counted as missed: what the BDE had logged by the time it was judged. */
export function missReason(status: string, h: ContactHalves): MissReason {
  if (status === "contacted_late") return "late";
  if (h.call && !h.note) return "call_no_note";
  if (h.whatsapp && !h.stage) return "whatsapp_no_stage";
  if (h.stage) return "stage_only";
  if (h.note) return "note_only";
  return "nothing";
}

export type Breakdown = {
  byKind: Record<AssignmentKind, { received: number; contacted: number; missed: number }>;
  missed: Record<MissReason, number>;
};

/** The working days (those with a cutoff) from `from` to `to`, inclusive. */
export function workingDays(from: string, to: string, holidays: ReadonlySet<string>): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (cutoffOn(d, holidays)) days.push(d);
  return days;
}

// ── The run ──────────────────────────────────────────────────────────────────

export type BackfillRow = {
  day: string;
  userId: string;
  name: string;
  report: LeadReport;
  /** What is stored for that BDE and day before the run. */
  existing: "none" | "submitted" | "generated";
};

export type BackfillResult = {
  from: string;
  to: string;
  rule: ContactRule;
  trackingStart: string;
  days: number;
  rebuilt: number;
  excludedImports: number;
  /** For the rebuilt assignments due in the range: what kind they were, and why the misses missed. */
  breakdown: Breakdown;
  rows: BackfillRow[];
  applied: { assignmentsAdded: number; reportsUpdated: number; reportsCreated: number; trackingStartMovedTo: string | null } | null;
};

type Judged = ReportAssignment & { userId: string; leadId: string; key: string; olderRule?: boolean };

const keyOf = (leadId: string, userId: string, at: Date) => `${leadId}|${userId}|${at.getTime()}`;

export async function backfillLeadReports(opts: {
  from: string;
  to: string;
  apply: boolean;
  /**
   * How rebuilt (pre-go-live) assignments are judged: "any" logged action — the
   * default, since nobody was asked to pair actions before go-live — or "pair" (R1).
   */
  rule?: ContactRule;
  now?: Date;
  log?: (msg: string) => void;
}): Promise<BackfillResult> {
  const now = opts.now ?? new Date();
  const rule = opts.rule ?? "any";
  const log = opts.log ?? (() => {});
  const start = await leadReportStart();
  if (!start) throw new Error(`No ${LEAD_REPORT_START_KEY} setting — has the daily lead report migration run?`);
  const holidays = await loadHolidaySet(prisma);
  const days = workingDays(opts.from, opts.to, holidays);
  const windowFrom = istDayWindow(addDays(opts.from, -LOOKBACK_DAYS)).fromUtc;
  const rangeFrom = istDayWindow(opts.from).fromUtc;
  const rangeTo = istDayWindow(opts.to).toUtc;

  // 1. Rebuild assignments from before tracking began.
  // Events up to now, so an assignment released or reassigned after go-live
  // ends when it really did; only episodes starting before `start` are kept.
  const events = await prisma.leadActivity.findMany({
    where: { type: { in: [...ASSIGNMENT_TYPES] }, occurredAt: { gte: windowFrom } },
    select: { leadId: true, type: true, metadata: true, occurredAt: true },
  });
  const assignmentEvents: AssignmentEvent[] = events.map((e) => {
    const meta = (e.metadata ?? {}) as { toUserId?: unknown };
    return { leadId: e.leadId, type: e.type, toUserId: typeof meta.toUserId === "string" ? meta.toUserId : null, at: e.occurredAt };
  });
  const leadIds = new Set(assignmentEvents.map((e) => e.leadId));
  const unlogged = await prisma.lead.findMany({
    where: { assignedToId: { not: null }, assignedAt: { gte: windowFrom, lt: start } },
    select: { id: true },
  });
  for (const l of unlogged) leadIds.add(l.id);
  const leads: LeadState[] = [];
  for (let i = 0; i < [...leadIds].length; i += CHUNK) {
    const part = [...leadIds].slice(i, i + CHUNK);
    const rows = await prisma.lead.findMany({
      where: { id: { in: part } },
      select: { id: true, assignedToId: true, assignedAt: true, createdAt: true, importBatch: { select: { createdAt: true } } },
    });
    for (const r of rows) {
      leads.push({ id: r.id, assignedToId: r.assignedToId, assignedAt: r.assignedAt, createdAt: r.createdAt, importBatchCreatedAt: r.importBatch?.createdAt ?? null });
    }
  }
  const all = rebuildEpisodes(assignmentEvents, leads.map((l) => ({ ...l, importBatchCreatedAt: null })), windowFrom, start);
  const episodes = rebuildEpisodes(assignmentEvents, leads, windowFrom, start);
  log(`rebuilt ${episodes.length} assignment(s) before ${start.toISOString()} (${all.length - episodes.length} bulk-import carryover left out)`);

  // 2. Judge each against its cutoff, with what the BDE actually did.
  const createdAtOf = new Map(leads.map((l) => [l.id, l.createdAt ?? null]));
  const breakdown: Breakdown = {
    byKind: { fresh: { received: 0, contacted: 0, missed: 0 }, older: { received: 0, contacted: 0, missed: 0 }, reassigned: { received: 0, contacted: 0, missed: 0 } },
    missed: { nothing: 0, call_no_note: 0, stage_only: 0, whatsapp_no_stage: 0, note_only: 0, late: 0 },
  };
  const judgedRebuilt: (Judged & Episode & { firstContactedAt: Date | null })[] = [];
  const sourceOf = await leadSources(episodes.map((e) => e.leadId));
  for (let i = 0; i < episodes.length; i += CHUNK) {
    const part = episodes.slice(i, i + CHUNK);
    const evs = await loadContactEvents(part);
    for (const ep of part) {
      const contactDueAt = nextCutoff(ep.assignedAt, holidays);
      const v = evaluateContact({ ...ep, contactDueAt }, evs.get(ep.leadId) ?? [], now, rule);
      if (contactDueAt >= rangeFrom && contactDueAt < rangeTo && v.status !== "reassigned") {
        const k = breakdown.byKind[assignmentKind(ep, createdAtOf.get(ep.leadId) ?? null)];
        k.received++;
        if (v.status === "contacted") k.contacted++;
        else if (v.status === "missed" || v.status === "contacted_late") {
          k.missed++;
          breakdown.missed[missReason(v.status, v.halves)]++;
        }
      }
      judgedRebuilt.push({
        ...ep,
        contactDueAt,
        contactStatus: v.status as ContactStatus,
        firstContactedAt: v.firstContactedAt,
        key: keyOf(ep.leadId, ep.userId, ep.assignedAt),
        olderRule: rule === "any",
        ...(sourceOf.get(ep.leadId) ?? { sourceKey: "none", sourceLabel: "No source" }),
      });
    }
  }

  // 3. What tracking already has for the range (from go-live on).
  const tracked = await prisma.crmLeadAssignment.findMany({
    where: { OR: [{ assignedAt: { gte: rangeFrom, lt: rangeTo } }, { contactDueAt: { gte: rangeFrom, lt: rangeTo } }] },
    select: { leadId: true, userId: true, assignedAt: true, contactDueAt: true, contactStatus: true },
  });
  const trackedKeys = new Set(tracked.map((t) => keyOf(t.leadId, t.userId, t.assignedAt)));
  const trackedSource = await leadSources(tracked.map((t) => t.leadId));
  const assignments: Judged[] = [
    ...tracked.map((t) => ({
      ...t,
      key: keyOf(t.leadId, t.userId, t.assignedAt),
      ...(trackedSource.get(t.leadId) ?? { sourceKey: "none", sourceLabel: "No source" }),
    })),
    ...judgedRebuilt.filter((j) => !trackedKeys.has(j.key)),
  ];
  const toAdd = judgedRebuilt.filter((j) => !trackedKeys.has(j.key));

  // 4. Every BDE's report for every working day.
  const [roster, handovers, stored] = await Promise.all([
    getAssignableBdes(),
    prisma.crmLeadHandover.findMany({
      where: { handoverDate: { gte: toPrismaDate(opts.from), lte: toPrismaDate(opts.to) } },
      select: { assignedBdeId: true, handoverDate: true, status: true, isLate: true },
    }),
    prisma.crmDailyReport.findMany({
      where: { day: { gte: toPrismaDate(opts.from), lte: toPrismaDate(opts.to) } },
      select: { userId: true, day: true, locked: true, leadReport: true },
    }),
  ]);
  const storedBy = new Map(stored.map((s) => [`${s.userId}|${s.day.toISOString().slice(0, 10)}`, s]));
  const userIds = new Set([...roster.map((b) => b.userId), ...assignments.map((a) => a.userId)]);
  const names = await userNames([...userIds]);
  // A BDE gets a report from the first day they had a lead in the range (or
  // had already submitted one) — not for days before they started.
  const firstSeen = new Map<string, Date>();
  for (const a of assignments) {
    const seen = firstSeen.get(a.userId);
    if (!seen || a.assignedAt < seen) firstSeen.set(a.userId, a.assignedAt);
  }
  const rows: BackfillRow[] = [];
  for (const day of days) {
    const { fromUtc, toUtc } = istDayWindow(day);
    const inDay = (d: Date) => d >= fromUtc && d < toUtc;
    const active = new Set<string>();
    for (const b of roster) {
      const seen = firstSeen.get(b.userId);
      if (seen && seen < toUtc) active.add(b.userId);
    }
    for (const s of stored) if (s.day.toISOString().slice(0, 10) === day) active.add(s.userId);
    for (const a of assignments) if (inDay(a.assignedAt) || inDay(a.contactDueAt)) active.add(a.userId);
    for (const userId of active) {
      const mine = assignments.filter((a) => a.userId === userId && (inDay(a.assignedAt) || inDay(a.contactDueAt)));
      const given = handovers.filter((h) => h.assignedBdeId === userId && h.handoverDate.toISOString().slice(0, 10) === day);
      const s = storedBy.get(`${userId}|${day}`);
      rows.push({
        day,
        userId,
        name: names.get(userId) ?? userId,
        report: buildLeadReport(day, mine, given, { olderRule: mine.some((a) => a.olderRule) }),
        existing: !s ? "none" : s.leadReport ? "generated" : "submitted",
      });
    }
  }

  const result: BackfillResult = {
    from: opts.from,
    to: opts.to,
    rule,
    trackingStart: start.toISOString(),
    days: days.length,
    rebuilt: episodes.length,
    excludedImports: all.length - episodes.length,
    breakdown,
    rows,
    applied: null,
  };
  if (!opts.apply) return result;

  // 5. Apply.
  let assignmentsAdded = 0;
  for (let i = 0; i < toAdd.length; i += CHUNK) {
    const res = await prisma.crmLeadAssignment.createMany({
      data: toAdd.slice(i, i + CHUNK).map((a) => ({
        leadId: a.leadId,
        userId: a.userId,
        assignedAt: a.assignedAt,
        contactDueAt: a.contactDueAt,
        firstContactedAt: a.firstContactedAt,
        contactStatus: a.contactStatus,
        endedAt: a.endedAt,
      })),
      skipDuplicates: true,
    });
    assignmentsAdded += res.count;
  }
  log(`added ${assignmentsAdded} assignment row(s)`);

  let reportsUpdated = 0;
  let reportsCreated = 0;
  for (const r of rows) {
    const where = { userId_day: { userId: r.userId, day: toPrismaDate(r.day) } };
    const leadReport = leadReportJson(r.report);
    if (r.existing !== "none") {
      // A BDE's own report (narrative, activity numbers) stays as it was.
      await prisma.crmDailyReport.update({ where, data: { leadReport, locked: true } });
      reportsUpdated++;
    } else {
      const { metrics, details } = await computeDailyReport({ userId: r.userId, dayStr: r.day });
      await prisma.crmDailyReport.create({
        data: {
          userId: r.userId,
          day: toPrismaDate(r.day),
          status: "submitted",
          summary: "",
          metrics: metrics as unknown as Prisma.InputJsonValue,
          details: details as unknown as Prisma.InputJsonValue,
          leadReport,
          locked: true,
          submittedAt: cutoffOn(r.day, holidays) ?? now,
        },
      });
      reportsCreated++;
    }
    if ((reportsUpdated + reportsCreated) % 50 === 0) log(`  ${reportsUpdated + reportsCreated} / ${rows.length} reports…`);
  }

  const firstDay = istDayWindow(opts.from).fromUtc;
  let trackingStartMovedTo: string | null = null;
  if (firstDay.getTime() < start.getTime()) {
    await prisma.appSetting.update({ where: { key: LEAD_REPORT_START_KEY }, data: { value: firstDay.toISOString() } });
    trackingStartMovedTo = firstDay.toISOString();
  }
  result.applied = { assignmentsAdded, reportsUpdated, reportsCreated, trackingStartMovedTo };
  return result;
}

async function leadSources(leadIds: string[]): Promise<Map<string, { sourceKey: string; sourceLabel: string }>> {
  const ids = [...new Set(leadIds)];
  const out = new Map<string, { sourceKey: string; sourceLabel: string }>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const [leads, channels] = await Promise.all([
      prisma.lead.findMany({ where: { id: { in: part } }, select: { id: true, sourceId: true, source: { select: { label: true } } } }),
      handoverChannels(part),
    ]);
    for (const l of leads) {
      out.set(l.id, reportSource({ sourceId: l.sourceId, sourceLabel: l.source?.label ?? null }, channels.get(l.id) ?? null));
    }
  }
  return out;
}

async function userNames(ids: string[]): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, username: true, leadPulseRole: { select: { displayName: true } } },
  });
  return new Map(users.map((u) => [u.id, u.leadPulseRole?.displayName ?? u.username]));
}

/** The dry-run / apply output as CSV, one line per BDE per day. */
export function backfillCsv(rows: BackfillRow[]): string {
  const head = ["day", "bde", "received", "carried_in", "contacted", "missed", "contacted_late", "pending", "due_later", "handovers_given", "stored_before"];
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = rows
    .slice()
    .sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name))
    .map((r) => {
      const t = r.report.totals;
      return [r.day, esc(r.name), t.received, t.carriedIn, t.contacted, t.missed, t.late, t.pending, t.dueLater, r.report.handovers.given, r.existing].join(",");
    });
  return [head.join(","), ...lines].join("\n") + "\n";
}
