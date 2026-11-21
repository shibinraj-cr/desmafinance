/**
 * The daily lead report — one BDE, one IST day: leads received and contacted
 * per source, what is still pending or was missed, and the handover block.
 *
 * Every lead's outcome is counted ONCE, on the day it was due:
 *
 *   received    assigned to the BDE on the day
 *   carriedIn   due on the day but assigned earlier (after a cutoff, on a
 *               Sunday or a holiday)
 *   dueLater    received on the day but due on a later one — its outcome
 *               lands in that day's report
 *   contacted   due on the day, contacted by the cutoff
 *   missed      due on the day, not contacted by the cutoff (contacted late
 *               included — `late` counts those separately)
 *   pending     due on the day, not contacted yet, cutoff still ahead
 *
 * so received + carriedIn = contacted + missed + pending + dueLater. A lead
 * reassigned away before its cutoff, uncontacted, is on nobody's report (R6).
 *
 * Pure: the DB side is crm-lead-report-data.ts.
 */
import { istDateString } from "./lead-pulse-dates";
import { handoverGroupLabel } from "./crm-handover";

export type LeadCounts = {
  received: number;
  carriedIn: number;
  dueLater: number;
  contacted: number;
  missed: number;
  late: number;
  pending: number;
};

export type LeadReportSource = LeadCounts & { key: string; label: string };

export type HandoverCounts = {
  given: number;
  created: number;
  duplicate: number;
  rejected: number;
  overdue: number;
  pending: number;
  /** Given that day and not created/rejected by its cutoff (created late included). */
  late: number;
};

export type LeadReport = {
  day: string;
  totals: LeadCounts;
  sources: LeadReportSource[];
  handovers: HandoverCounts;
  /**
   * Some leads in it were judged by the older rule (any logged action counts) —
   * they were assigned before the daily lead report went live. Set by the backfill.
   */
  olderRule?: boolean;
};

/** One assignment row as the report sees it. */
export type ReportAssignment = {
  assignedAt: Date;
  contactDueAt: Date;
  contactStatus: string;
  /** Lead source id, `handover:<channel>` for a lead created from a handover, or "none". */
  sourceKey: string;
  sourceLabel: string;
};

const zero = (): LeadCounts => ({ received: 0, carriedIn: 0, dueLater: 0, contacted: 0, missed: 0, late: 0, pending: 0 });

/** Where a lead is grouped: a handover's channel wins over the lead's own source. */
export function reportSource(
  lead: { sourceId: string | null; sourceLabel: string | null },
  handoverChannel: string | null,
): { sourceKey: string; sourceLabel: string } {
  if (handoverChannel) return { sourceKey: `handover:${handoverChannel}`, sourceLabel: handoverGroupLabel(handoverChannel) };
  if (lead.sourceId) return { sourceKey: lead.sourceId, sourceLabel: lead.sourceLabel ?? "Unknown source" };
  return { sourceKey: "none", sourceLabel: "No source" };
}

function add(counts: LeadCounts, a: ReportAssignment, day: string): boolean {
  if (a.contactStatus === "reassigned") return false;
  const receivedOn = istDateString(a.assignedAt) === day;
  const dueOn = istDateString(a.contactDueAt) === day;
  if (!receivedOn && !dueOn) return false;
  if (receivedOn) counts.received++;
  if (dueOn && !receivedOn) counts.carriedIn++;
  if (receivedOn && !dueOn) counts.dueLater++;
  if (dueOn) {
    if (a.contactStatus === "contacted") counts.contacted++;
    else if (a.contactStatus === "missed") counts.missed++;
    else if (a.contactStatus === "contacted_late") {
      counts.missed++;
      counts.late++;
    } else counts.pending++;
  }
  return true;
}

export function buildHandoverCounts(handovers: { status: string; isLate: boolean }[]): HandoverCounts {
  const c: HandoverCounts = { given: 0, created: 0, duplicate: 0, rejected: 0, overdue: 0, pending: 0, late: 0 };
  for (const h of handovers) {
    c.given++;
    if (h.status === "created") c.created++;
    else if (h.status === "duplicate") c.duplicate++;
    else if (h.status === "rejected") c.rejected++;
    else if (h.status === "overdue") c.overdue++;
    else c.pending++;
    if (h.isLate) c.late++;
  }
  return c;
}

/**
 * Build the report for `day` from the BDE's assignment rows (any that were
 * received or due that day) and the handovers given to them that day.
 */
export function buildLeadReport(
  day: string,
  assignments: ReportAssignment[],
  handovers: { status: string; isLate: boolean }[],
  opts: { olderRule?: boolean } = {},
): LeadReport {
  const totals = zero();
  const bySource = new Map<string, LeadReportSource>();
  for (const a of assignments) {
    let row = bySource.get(a.sourceKey);
    if (!row) row = { key: a.sourceKey, label: a.sourceLabel, ...zero() };
    if (!add(row, a, day)) continue;
    add(totals, a, day);
    bySource.set(a.sourceKey, row);
  }
  const sources = [...bySource.values()].sort(
    (x, y) => y.received + y.carriedIn - (x.received + x.carriedIn) || x.label.localeCompare(y.label),
  );
  return { day, totals, sources, handovers: buildHandoverCounts(handovers), ...(opts.olderRule ? { olderRule: true } : {}) };
}

/** Sum of several reports' totals and handover blocks — the team row. */
export function sumReports(reports: Pick<LeadReport, "totals" | "handovers">[]): Pick<LeadReport, "totals" | "handovers"> {
  const totals = zero();
  const handovers = buildHandoverCounts([]);
  for (const r of reports) {
    for (const k of Object.keys(totals) as (keyof LeadCounts)[]) totals[k] += r.totals[k];
    for (const k of Object.keys(handovers) as (keyof HandoverCounts)[]) handovers[k] += r.handovers[k];
  }
  return { totals, handovers };
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "5:00 pm" — a cutoff in IST. */
export function istClock(at: Date): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
    .format(at)
    .toLowerCase();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "10 Nov" for "2026-11-10". */
export function shortDay(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]}`;
}

/**
 * The team's WhatsApp format. Sources listed only when they received leads
 * that day or carried some in; the extra counts appear only when non-zero.
 */
export function leadReportShareText(report: LeadReport, bdeName: string): string {
  const lines = [`Today Assigned Leads – ${bdeName} (${shortDay(report.day)})`];
  for (const s of report.sources) {
    if (s.received === 0 && s.carriedIn === 0) continue;
    const parts = [`Received: ${s.received}`, `Contacted: ${s.contacted}`, `Missed: ${s.missed}`];
    if (s.carriedIn) parts.push(`Carried in: ${s.carriedIn}`);
    if (s.pending) parts.push(`Pending: ${s.pending}`);
    if (s.dueLater) parts.push(`Due next working day: ${s.dueLater}`);
    lines.push("", s.label, parts.join(" | "));
  }
  const h = report.handovers;
  lines.push("", "Handovers", `Given: ${h.given} | Created: ${h.created} | Overdue: ${h.overdue}`);
  return lines.join("\n");
}
