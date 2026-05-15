/**
 * Lead Pulse aggregation queries. All metrics flow through this module so
 * the dashboard, monthly report, and BDE-performance views are guaranteed
 * to agree on numbers. Inline SQL is used in places where Prisma's
 * groupBy can't conditionally pivot L1 vs L2 fields cleanly.
 *
 * Conventions:
 * - "L1 leads" = SUM(leadsReceived) on entries with roleAtEntry='l1'.
 * - "L2 leads" = SUM(receivedFromL1 + directLeads) on entries with roleAtEntry='l2'.
 * - "L1 won" (a.k.a. transfers to L2) = SUM(transferredToL2).
 * - "L2 won" = SUM(closedWon).
 * - Conversion% = won / leads * 100, with leads=0 → null.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { addDays, todayIst, toPrismaDate } from "./lead-pulse-dates";

export type FunnelTotals = {
  l1Leads: number;
  l1Won: number;
  l1ConversionPct: number | null;
  l2Leads: number;
  l2Won: number;
  l2ConversionPct: number | null;
};

export function pct(won: number, leads: number): number | null {
  if (leads <= 0) return null;
  return Math.round((won / leads) * 1000) / 10; // 1 decimal place
}

/** First/last day (inclusive) of a given (year, month) in YYYY-MM-DD. */
export function monthBounds(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-based here
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

/** Pull totals for a date range, optionally narrowed to a single source. */
export async function getFunnelTotals(opts: {
  start: string;
  end: string;
  sourceId?: string | null;
  userId?: string | null;
  status?: "submitted" | "any";
}): Promise<FunnelTotals> {
  const where: Prisma.LeadPulseDailyEntryWhereInput = {
    entryDate: { gte: toPrismaDate(opts.start), lte: toPrismaDate(opts.end) },
    ...(opts.sourceId ? { sourceId: opts.sourceId } : {}),
    ...(opts.userId ? { userId: opts.userId } : {}),
    ...(opts.status === "any" ? {} : { status: "submitted" }),
  };
  const [l1, l2] = await Promise.all([
    prisma.leadPulseDailyEntry.aggregate({
      where: { ...where, roleAtEntry: "l1" },
      _sum: { leadsReceived: true, transferredToL2: true },
    }),
    prisma.leadPulseDailyEntry.aggregate({
      where: { ...where, roleAtEntry: "l2" },
      _sum: { receivedFromL1: true, directLeads: true, closedWon: true },
    }),
  ]);
  const l1Leads = l1._sum.leadsReceived ?? 0;
  const l1Won = l1._sum.transferredToL2 ?? 0;
  const l2Leads = (l2._sum.receivedFromL1 ?? 0) + (l2._sum.directLeads ?? 0);
  const l2Won = l2._sum.closedWon ?? 0;
  return {
    l1Leads,
    l1Won,
    l1ConversionPct: pct(l1Won, l1Leads),
    l2Leads,
    l2Won,
    l2ConversionPct: pct(l2Won, l2Leads),
  };
}

/** Per-source totals (one row per source) for the date range. */
export async function getFunnelBySource(opts: {
  start: string;
  end: string;
}): Promise<Array<{ sourceId: string; sourceCode: string; sourceLabel: string } & FunnelTotals>> {
  const sources = await prisma.leadPulseSource.findMany({
    orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
  });
  const out: Array<{ sourceId: string; sourceCode: string; sourceLabel: string } & FunnelTotals> = [];
  for (const s of sources) {
    const totals = await getFunnelTotals({ start: opts.start, end: opts.end, sourceId: s.id });
    out.push({ sourceId: s.id, sourceCode: s.code, sourceLabel: s.label, ...totals });
  }
  return out;
}

/** Daily lead volume for the last N days, used by the dashboard line chart. */
export async function getDailyLeadVolume(days: number): Promise<Array<{ date: string; leads: number }>> {
  const today = todayIst();
  const start = addDays(today, -(days - 1));
  // Pull all entries in range, then aggregate in JS (data volume is small —
  // ~25 BDEs × 8 sources × 30 days = 6k rows max).
  const entries = await prisma.leadPulseDailyEntry.findMany({
    where: {
      entryDate: { gte: toPrismaDate(start), lte: toPrismaDate(today) },
      status: "submitted",
    },
    select: {
      entryDate: true,
      roleAtEntry: true,
      leadsReceived: true,
      receivedFromL1: true,
      directLeads: true,
    },
  });
  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    buckets.set(addDays(start, i), 0);
  }
  for (const e of entries) {
    const dayStr = e.entryDate.toISOString().slice(0, 10);
    const bump =
      e.roleAtEntry === "l1"
        ? (e.leadsReceived ?? 0)
        : (e.receivedFromL1 ?? 0) + (e.directLeads ?? 0);
    buckets.set(dayStr, (buckets.get(dayStr) ?? 0) + bump);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, leads]) => ({ date, leads }));
}

/**
 * Dual-window daily lead volume — returns the current N-day window
 * (today − N + 1 … today) overlaid with the matching prior N-day
 * window (today − 2N + 1 … today − N), aligned by offset so the two
 * series can be drawn on the same chart for direct comparison.
 *
 * Each output row has:
 *   - `date`        — calendar date in the *current* window
 *   - `leads`       — current-window leads on that date
 *   - `priorDate`   — calendar date one window-length earlier
 *   - `priorLeads`  — leads on that prior date (the comparison value)
 */
export async function getDailyLeadVolumeWithPrior(
  days: number,
): Promise<
  Array<{ date: string; leads: number; priorDate: string; priorLeads: number }>
> {
  const today = todayIst();
  const start = addDays(today, -(days - 1));
  const priorStart = addDays(start, -days);
  const priorEnd = addDays(start, -1);

  // Single query covering both windows — saves a round-trip and keeps
  // the data-volume tax low (~12k rows max for a 60-day span).
  const entries = await prisma.leadPulseDailyEntry.findMany({
    where: {
      entryDate: { gte: toPrismaDate(priorStart), lte: toPrismaDate(today) },
      status: "submitted",
    },
    select: {
      entryDate: true,
      roleAtEntry: true,
      leadsReceived: true,
      receivedFromL1: true,
      directLeads: true,
    },
  });
  const buckets = new Map<string, number>();
  // Pre-seed every day in the combined range so empty days show zero.
  for (let i = 0; i < days * 2; i++) {
    buckets.set(addDays(priorStart, i), 0);
  }
  for (const e of entries) {
    const dayStr = e.entryDate.toISOString().slice(0, 10);
    const bump =
      e.roleAtEntry === "l1"
        ? (e.leadsReceived ?? 0)
        : (e.receivedFromL1 ?? 0) + (e.directLeads ?? 0);
    buckets.set(dayStr, (buckets.get(dayStr) ?? 0) + bump);
  }
  // Build the aligned series: index 0 = start-of-current-window vs
  // start-of-prior-window, …, index N-1 = today vs today − N.
  const out: Array<{
    date: string;
    leads: number;
    priorDate: string;
    priorLeads: number;
  }> = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const priorDate = addDays(priorStart, i);
    out.push({
      date,
      leads: buckets.get(date) ?? 0,
      priorDate,
      priorLeads: buckets.get(priorDate) ?? 0,
    });
  }
  // Used in case the caller wants the raw priorEnd; not returned but
  // referenced via the priorDate of the last row for clarity.
  void priorEnd;
  return out;
}

/**
 * Per-BDE roster snapshot. Default subject = today, default filter = all
 * rostered L1/L2 BDEs. Pass `date` to look at a different working day
 * (e.g. last working day) and `activeOnly` to scope to active BDEs only.
 */
export async function getTodaysEntryStatus(opts?: {
  date?: string;
  activeOnly?: boolean;
}): Promise<
  Array<{
    userId: string;
    displayName: string;
    role: string;
    leadsLogged: number;
    status: "submitted" | "draft" | "missing";
  }>
> {
  const targetDate = opts?.date ?? todayIst();
  const dateValue = toPrismaDate(targetDate);
  const roles = await prisma.leadPulseRole.findMany({
    where: {
      role: { in: ["l1", "l2"] },
      ...(opts?.activeOnly ? { active: true } : {}),
    },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
  });
  const todays = await prisma.leadPulseDailyEntry.findMany({
    where: { entryDate: dateValue },
    select: {
      userId: true,
      status: true,
      leadsReceived: true,
      receivedFromL1: true,
      directLeads: true,
      roleAtEntry: true,
    },
  });
  const grouped = new Map<string, { leads: number; submitted: boolean; draft: boolean }>();
  for (const e of todays) {
    const cur = grouped.get(e.userId) ?? { leads: 0, submitted: false, draft: false };
    cur.leads +=
      e.roleAtEntry === "l1"
        ? (e.leadsReceived ?? 0)
        : (e.receivedFromL1 ?? 0) + (e.directLeads ?? 0);
    if (e.status === "submitted") cur.submitted = true;
    else cur.draft = true;
    grouped.set(e.userId, cur);
  }
  return roles.map((r) => {
    const g = grouped.get(r.userId);
    let status: "submitted" | "draft" | "missing" = "missing";
    if (g?.submitted) status = "submitted";
    else if (g?.draft) status = "draft";
    return {
      userId: r.userId,
      displayName: r.displayName,
      role: r.role,
      leadsLogged: g?.leads ?? 0,
      status,
    };
  });
}

/** Auto-generated alert list for the dashboard's Priority Alerts panel. */
export type Alert = {
  kind: "performance_dip" | "target_achieved" | "pending_drafts" | "inactive_bde";
  message: string;
  href?: string;
};

export async function getPriorityAlerts(): Promise<Alert[]> {
  const today = todayIst();
  const out: Alert[] = [];

  // Performance dip — 7d avg vs prior 7d, per BDE.
  const last7Start = addDays(today, -6);
  const prev7Start = addDays(today, -13);
  const prev7End = addDays(today, -7);
  const roles = await prisma.leadPulseRole.findMany({
    where: { active: true, role: { in: ["l1", "l2"] } },
  });
  for (const r of roles) {
    const [recent, prior] = await Promise.all([
      getFunnelTotals({ start: last7Start, end: today, userId: r.userId }),
      getFunnelTotals({ start: prev7Start, end: prev7End, userId: r.userId }),
    ]);
    const recentLeads = recent.l1Leads + recent.l2Leads;
    const priorLeads = prior.l1Leads + prior.l2Leads;
    if (priorLeads >= 7 && recentLeads < priorLeads * 0.85) {
      out.push({
        kind: "performance_dip",
        message: `${r.displayName}'s 7-day lead volume dropped ${Math.round((1 - recentLeads / priorLeads) * 100)}% vs prior week.`,
        href: `/marketing/lead-pulse/bde-performance/${r.userId}`,
      });
    }
  }

  // Pending drafts: L1/L2 with status=draft for entries dated yesterday or earlier.
  const yesterday = addDays(today, -1);
  const draftYesterday = await prisma.leadPulseDailyEntry.count({
    where: {
      entryDate: { lte: toPrismaDate(yesterday) },
      status: "draft",
    },
  });
  if (draftYesterday > 0) {
    out.push({
      kind: "pending_drafts",
      message: `${draftYesterday} entries from yesterday or earlier still in draft.`,
      href: `/marketing/lead-pulse/team-roster`,
    });
  }

  // Target achieved: any source with month-to-date conversion ≥ 35%.
  const today2 = todayIst();
  const monthStart = today2.slice(0, 8) + "01";
  const bySrc = await getFunnelBySource({ start: monthStart, end: today2 });
  for (const row of bySrc) {
    const overall = row.l1ConversionPct ?? row.l2ConversionPct;
    if (overall != null && overall >= 35) {
      out.push({
        kind: "target_achieved",
        message: `${row.sourceLabel}: ${overall.toFixed(1)}% conversion this month — target met.`,
        href: `/marketing/lead-pulse/monthly-report?source=${row.sourceCode}`,
      });
    }
  }

  // Inactive BDE: no submitted entry for 3+ working days.
  const cutoff = addDays(today, -3);
  for (const r of roles) {
    const last = await prisma.leadPulseDailyEntry.findFirst({
      where: { userId: r.userId, status: "submitted" },
      orderBy: { entryDate: "desc" },
      select: { entryDate: true },
    });
    const lastDate = last?.entryDate ? last.entryDate.toISOString().slice(0, 10) : null;
    if (!lastDate || lastDate < cutoff) {
      out.push({
        kind: "inactive_bde",
        message: `${r.displayName} hasn't submitted an entry${lastDate ? ` since ${lastDate}` : " yet"}.`,
        href: `/marketing/lead-pulse/bde-performance/${r.userId}`,
      });
    }
  }

  return out.slice(0, 8);
}

/** Per-source conversion % across all BDEs in a date range. */
export async function getConversionBySource(opts: {
  start: string;
  end: string;
}): Promise<Array<{ sourceLabel: string; sourceCode: string; conversionPct: number | null; leads: number }>> {
  const rows = await getFunnelBySource(opts);
  return rows.map((r) => {
    const totalLeads = r.l1Leads + r.l2Leads;
    const totalWon = r.l1Won + r.l2Won;
    return {
      sourceLabel: r.sourceLabel,
      sourceCode: r.sourceCode,
      leads: totalLeads,
      conversionPct: pct(totalWon, totalLeads),
    };
  });
}

/** Per-BDE per-source matrix for the monthly report. */
export type MatrixCell = { leads: number; won: number; conversionPct: number | null };
export type MatrixBdeRow = {
  userId: string;
  displayName: string;
  role: "l1" | "l2";
  perSource: Map<string, MatrixCell>; // keyed by source.code
  total: MatrixCell;
};
export type Matrix = {
  sources: Array<{ id: string; code: string; label: string }>;
  l1Rows: MatrixBdeRow[];
  l2Rows: MatrixBdeRow[];
  l1Subtotal: { perSource: Map<string, MatrixCell>; total: MatrixCell };
  l2Subtotal: { perSource: Map<string, MatrixCell>; total: MatrixCell };
  globalTotal: { perSource: Map<string, MatrixCell>; total: MatrixCell };
};

export async function getMonthlyMatrix(opts: {
  year: number;
  month: number;
  sourceCode?: string | null;
  region?: string | null;
}): Promise<Matrix> {
  const { start, end } = monthBounds(opts.year, opts.month);
  const sources = await prisma.leadPulseSource.findMany({
    where: { active: true, ...(opts.sourceCode ? { code: opts.sourceCode } : {}) },
    orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
  });
  const roleRows = await prisma.leadPulseRole.findMany({
    where: {
      role: { in: ["l1", "l2"] },
      ...(opts.region ? { regionFocus: { has: opts.region } } : {}),
    },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
  });
  const userIds = roleRows.map((r) => r.userId);
  const entries = await prisma.leadPulseDailyEntry.findMany({
    where: {
      entryDate: { gte: toPrismaDate(start), lte: toPrismaDate(end) },
      status: "submitted",
      userId: { in: userIds },
      ...(opts.sourceCode ? { source: { code: opts.sourceCode } } : {}),
    },
    select: {
      userId: true,
      sourceId: true,
      roleAtEntry: true,
      leadsReceived: true,
      transferredToL2: true,
      receivedFromL1: true,
      directLeads: true,
      closedWon: true,
    },
  });
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  function buildRow(role: "l1" | "l2", userId: string, displayName: string): MatrixBdeRow {
    const perSource = new Map<string, MatrixCell>();
    for (const s of sources) perSource.set(s.code, { leads: 0, won: 0, conversionPct: null });
    return {
      userId,
      displayName,
      role,
      perSource,
      total: { leads: 0, won: 0, conversionPct: null },
    };
  }
  const rowByUser = new Map<string, MatrixBdeRow>();
  for (const r of roleRows) {
    rowByUser.set(r.userId, buildRow(r.role as "l1" | "l2", r.userId, r.displayName));
  }
  for (const e of entries) {
    const row = rowByUser.get(e.userId);
    if (!row) continue;
    const src = sourceById.get(e.sourceId);
    if (!src) continue;
    const cell = row.perSource.get(src.code);
    if (!cell) continue;
    if (e.roleAtEntry === "l1") {
      cell.leads += e.leadsReceived ?? 0;
      cell.won += e.transferredToL2 ?? 0;
    } else {
      cell.leads += (e.receivedFromL1 ?? 0) + (e.directLeads ?? 0);
      cell.won += e.closedWon ?? 0;
    }
  }
  for (const row of rowByUser.values()) {
    let totalLeads = 0;
    let totalWon = 0;
    for (const cell of row.perSource.values()) {
      cell.conversionPct = pct(cell.won, cell.leads);
      totalLeads += cell.leads;
      totalWon += cell.won;
    }
    row.total = { leads: totalLeads, won: totalWon, conversionPct: pct(totalWon, totalLeads) };
  }
  const l1Rows = Array.from(rowByUser.values()).filter((r) => r.role === "l1");
  const l2Rows = Array.from(rowByUser.values()).filter((r) => r.role === "l2");

  function subtotal(rows: MatrixBdeRow[]): { perSource: Map<string, MatrixCell>; total: MatrixCell } {
    const perSource = new Map<string, MatrixCell>();
    for (const s of sources) perSource.set(s.code, { leads: 0, won: 0, conversionPct: null });
    let totalLeads = 0;
    let totalWon = 0;
    for (const r of rows) {
      for (const [code, cell] of r.perSource) {
        const acc = perSource.get(code)!;
        acc.leads += cell.leads;
        acc.won += cell.won;
      }
      totalLeads += r.total.leads;
      totalWon += r.total.won;
    }
    for (const cell of perSource.values()) cell.conversionPct = pct(cell.won, cell.leads);
    return { perSource, total: { leads: totalLeads, won: totalWon, conversionPct: pct(totalWon, totalLeads) } };
  }
  const l1Subtotal = subtotal(l1Rows);
  const l2Subtotal = subtotal(l2Rows);
  const globalTotal = subtotal([...l1Rows, ...l2Rows]);

  return {
    sources: sources.map((s) => ({ id: s.id, code: s.code, label: s.label })),
    l1Rows,
    l2Rows,
    l1Subtotal,
    l2Subtotal,
    globalTotal,
  };
}

/** Months for which we have any submitted entry. */
export async function getMonthsWithData(): Promise<Array<{ year: number; month: number }>> {
  const rows = await prisma.leadPulseDailyEntry.findMany({
    where: { status: "submitted" },
    select: { entryDate: true },
    distinct: ["entryDate"],
  });
  const set = new Set<string>();
  for (const r of rows) set.add(r.entryDate.toISOString().slice(0, 7));
  return Array.from(set)
    .sort()
    .reverse()
    .map((s) => ({ year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) }));
}

/** 6-month historical funnel — used by Monthly Report's trend chart. */
export async function getHistoricalFunnel(opts: {
  endYear: number;
  endMonth: number;
  monthsBack: number;
}): Promise<Array<{ year: number; month: number; label: string } & FunnelTotals>> {
  const out: Array<{ year: number; month: number; label: string } & FunnelTotals> = [];
  for (let i = opts.monthsBack - 1; i >= 0; i--) {
    let m = opts.endMonth - i;
    let y = opts.endYear;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    const { start, end } = monthBounds(y, m);
    const t = await getFunnelTotals({ start, end });
    out.push({
      year: y,
      month: m,
      label: new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
        month: "short",
      }),
      ...t,
    });
  }
  return out;
}

/** Auto-generate a 2-3 sentence narrative for the Quick Insight panel. */
export function generateInsightNarrative(matrix: Matrix): string {
  const sources = matrix.sources;
  const sentences: string[] = [];
  // Best L2 conversion source
  let bestL2: { label: string; pct: number } | null = null;
  let worstL2: { label: string; pct: number } | null = null;
  for (const s of sources) {
    const cell = matrix.l2Subtotal.perSource.get(s.code);
    if (!cell || cell.leads < 5 || cell.conversionPct == null) continue;
    if (!bestL2 || cell.conversionPct > bestL2.pct) bestL2 = { label: s.label, pct: cell.conversionPct };
    if (!worstL2 || cell.conversionPct < worstL2.pct) worstL2 = { label: s.label, pct: cell.conversionPct };
  }
  const l1Conv = matrix.l1Subtotal.total.conversionPct;
  if (l1Conv != null && l1Conv >= 35) {
    sentences.push(`L1 conversion is exceeding the 35% benchmark at ${l1Conv.toFixed(1)}%.`);
  } else if (l1Conv != null) {
    sentences.push(`L1 conversion sits at ${l1Conv.toFixed(1)}%.`);
  }
  if (worstL2 && worstL2.pct < 10) {
    sentences.push(
      `L2 drop-off on ${worstL2.label} leads is critical at ${worstL2.pct.toFixed(1)}% — immediate intervention needed.`,
    );
  } else if (bestL2) {
    sentences.push(`Best L2 conversion: ${bestL2.label} at ${bestL2.pct.toFixed(1)}%.`);
  }
  const totalLeads = matrix.globalTotal.total.leads;
  if (totalLeads === 0) return "No submitted entries yet for this month.";
  return sentences.join(" ");
}

// ──────────────────────────────────────────────────────────────────────
// Dashboard v2 helpers — multi-window comparisons, source labels, and
// the service-conversion matrix that powers /marketing/lead-pulse/targets.
// ──────────────────────────────────────────────────────────────────────

/** First/last YYYY-MM-DD of (year, month - 1), wrapping years. */
function prevMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

/** The previous N complete months (excludes the current). */
function lastNCompleteMonths(
  year: number,
  month: number,
  n: number,
): Array<{ year: number; month: number }> {
  const out: Array<{ year: number; month: number }> = [];
  let y = year;
  let m = month;
  for (let i = 0; i < n; i++) {
    ({ year: y, month: m } = prevMonth(y, m));
    out.push({ year: y, month: m });
  }
  return out;
}

/** Average L1 + L2 monthly leads across the previous N complete months. */
export async function getAvgMonthlyTotals(
  year: number,
  month: number,
  n = 3,
): Promise<{ avgL1Leads: number; avgL2Leads: number; months: number }> {
  const months = lastNCompleteMonths(year, month, n);
  let l1 = 0;
  let l2 = 0;
  let counted = 0;
  for (const ym of months) {
    const { start, end } = monthBounds(ym.year, ym.month);
    const t = await getFunnelTotals({ start, end });
    l1 += t.l1Leads;
    l2 += t.l2Leads;
    counted++;
  }
  return {
    avgL1Leads: counted ? Math.round(l1 / counted) : 0,
    avgL2Leads: counted ? Math.round(l2 / counted) : 0,
    months: counted,
  };
}

/**
 * Per-source lead count using the user-defined formula:
 *   leads(source) = L1.leadsReceived(source) + L2.directLeads(source)
 *
 * Drops L2's receivedFromL1 so the leads that come via the L1→L2
 * hand-off aren't double-counted with the upstream L1 row.
 */
export async function getSourceLeadCount(opts: {
  start: string;
  end: string;
  /**
   * Calendar days (YYYY-MM-DD) whose lead numbers should be left out
   * of the totals. Used to drop the 2026-03-27 lump-import outlier
   * from rolling averages.
   */
  excludeDates?: string[];
}): Promise<Array<{ sourceId: string; sourceCode: string; sourceLabel: string; leads: number }>> {
  const sources = await prisma.leadPulseSource.findMany({
    orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
  });
  const excluded = (opts.excludeDates ?? []).map(toPrismaDate);
  const dateFilter: { gte: Date; lte: Date; notIn?: Date[] } = {
    gte: toPrismaDate(opts.start),
    lte: toPrismaDate(opts.end),
  };
  if (excluded.length > 0) dateFilter.notIn = excluded;
  const out: Array<{ sourceId: string; sourceCode: string; sourceLabel: string; leads: number }> = [];
  for (const s of sources) {
    const l1 = await prisma.leadPulseDailyEntry.aggregate({
      where: {
        sourceId: s.id,
        roleAtEntry: "l1",
        status: "submitted",
        entryDate: dateFilter,
      },
      _sum: { leadsReceived: true },
    });
    const l2 = await prisma.leadPulseDailyEntry.aggregate({
      where: {
        sourceId: s.id,
        roleAtEntry: "l2",
        status: "submitted",
        entryDate: dateFilter,
      },
      _sum: { directLeads: true },
    });
    out.push({
      sourceId: s.id,
      sourceCode: s.code,
      sourceLabel: s.label,
      leads: (l1._sum.leadsReceived ?? 0) + (l2._sum.directLeads ?? 0),
    });
  }
  return out;
}

/**
 * Per-source mean monthly lead count averaged over the previous N
 * complete months (default 3). `excludeDates` lets callers drop
 * specific calendar days from the underlying sums (e.g. the
 * 2026-03-27 historical-import lump that distorts averages).
 */
export async function getSourceLeadCountAvgMonthly(
  year: number,
  month: number,
  n = 3,
  excludeDates: string[] = [],
): Promise<Array<{ sourceId: string; sourceCode: string; sourceLabel: string; avg: number }>> {
  const months = lastNCompleteMonths(year, month, n);
  const perSourceSums = new Map<string, { sourceCode: string; sourceLabel: string; total: number }>();
  for (const ym of months) {
    const { start, end } = monthBounds(ym.year, ym.month);
    const rows = await getSourceLeadCount({ start, end, excludeDates });
    for (const r of rows) {
      const cur = perSourceSums.get(r.sourceId) ?? {
        sourceCode: r.sourceCode,
        sourceLabel: r.sourceLabel,
        total: 0,
      };
      cur.total += r.leads;
      perSourceSums.set(r.sourceId, cur);
    }
  }
  const denom = Math.max(1, months.length);
  return Array.from(perSourceSums.entries()).map(([sourceId, v]) => ({
    sourceId,
    sourceCode: v.sourceCode,
    sourceLabel: v.sourceLabel,
    avg: Math.round((v.total / denom) * 10) / 10,
  }));
}

/**
 * L2 conversion% per source for three windows (this month / last
 * month / mean of the previous 3 complete months).
 *
 * Scope is intentionally L2-only — both numerator and denominator
 * come from L2 daily entries:
 *   - leads = L2.receivedFromL1 + L2.directLeads (i.e. every lead
 *             L2 actually worked on, regardless of origin)
 *   - won   = L2.closedWon
 * L1's transferred-to-L2 hand-off is *not* counted as a win here —
 * that lives in the L1→L2 % KPI instead.
 */
export async function getMonthlyConversionBySource(
  year: number,
  month: number,
): Promise<
  Array<{
    sourceLabel: string;
    sourceCode: string;
    thisMonthPct: number | null;
    lastMonthPct: number | null;
    avgPct: number | null;
    thisMonthWon: number;
    lastMonthWon: number;
    avgWon: number | null;
  }>
> {
  async function windowMaps(yy: number, mm: number) {
    const { start, end } = monthBounds(yy, mm);
    const rows = await getFunnelBySource({ start, end });
    const pctMap = new Map<string, number | null>();
    const wonMap = new Map<string, number>();
    for (const r of rows) {
      pctMap.set(r.sourceCode, pct(r.l2Won, r.l2Leads));
      wonMap.set(r.sourceCode, r.l2Won);
    }
    return { pctMap, wonMap };
  }
  const sources = await prisma.leadPulseSource.findMany({
    orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
  });
  const thisM = await windowMaps(year, month);
  const last = prevMonth(year, month);
  const lastM = await windowMaps(last.year, last.month);
  // 3-month average — collect each month's pct + won, then average per source.
  const lastThree = lastNCompleteMonths(year, month, 3);
  const perSourcePct: Map<string, number[]> = new Map();
  const perSourceWon: Map<string, number[]> = new Map();
  for (const ym of lastThree) {
    const m = await windowMaps(ym.year, ym.month);
    for (const [code, v] of m.pctMap) {
      if (v == null) continue;
      const arr = perSourcePct.get(code) ?? [];
      arr.push(v);
      perSourcePct.set(code, arr);
    }
    for (const [code, v] of m.wonMap) {
      const arr = perSourceWon.get(code) ?? [];
      arr.push(v);
      perSourceWon.set(code, arr);
    }
  }
  return sources.map((s) => {
    const pctArr = perSourcePct.get(s.code) ?? [];
    const wonArr = perSourceWon.get(s.code) ?? [];
    const avgPct = pctArr.length
      ? Math.round((pctArr.reduce((a, b) => a + b, 0) / pctArr.length) * 10) / 10
      : null;
    const avgWon = wonArr.length
      ? Math.round((wonArr.reduce((a, b) => a + b, 0) / wonArr.length) * 10) / 10
      : null;
    return {
      sourceLabel: s.label,
      sourceCode: s.code,
      thisMonthPct: thisM.pctMap.get(s.code) ?? null,
      lastMonthPct: lastM.pctMap.get(s.code) ?? null,
      avgPct,
      thisMonthWon: thisM.wonMap.get(s.code) ?? 0,
      lastMonthWon: lastM.wonMap.get(s.code) ?? 0,
      avgWon,
    };
  });
}

/**
 * Per-L2-BDE weekly closed-won counts of YouTube leads — current
 * week + the prior week. Week buckets are Mon–Sun in IST.
 */
export async function getL2WeeklyYouTubeConversion(): Promise<
  Array<{ userId: string; displayName: string; thisWeek: number; lastWeek: number }>
> {
  const today = todayIst();
  // Find Monday of the current ISO-ish week.
  const [yy, mm, dd] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(yy, mm - 1, dd));
  const dow = dt.getUTCDay() || 7; // Sunday → 7
  const thisMon = addDays(today, -(dow - 1));
  const lastMon = addDays(thisMon, -7);
  const lastSun = addDays(thisMon, -1);
  const thisSun = addDays(thisMon, 6);

  const ytSource = await prisma.leadPulseSource.findUnique({ where: { code: "youtube" } });
  if (!ytSource) return [];
  const roles = await prisma.leadPulseRole.findMany({
    where: { role: "l2" },
    orderBy: [{ displayName: "asc" }],
  });
  const out: Array<{ userId: string; displayName: string; thisWeek: number; lastWeek: number }> = [];
  for (const r of roles) {
    const [thisAgg, lastAgg] = await Promise.all([
      prisma.leadPulseDailyEntry.aggregate({
        where: {
          userId: r.userId,
          sourceId: ytSource.id,
          roleAtEntry: "l2",
          status: "submitted",
          entryDate: { gte: toPrismaDate(thisMon), lte: toPrismaDate(thisSun) },
        },
        _sum: { closedWon: true },
      }),
      prisma.leadPulseDailyEntry.aggregate({
        where: {
          userId: r.userId,
          sourceId: ytSource.id,
          roleAtEntry: "l2",
          status: "submitted",
          entryDate: { gte: toPrismaDate(lastMon), lte: toPrismaDate(lastSun) },
        },
        _sum: { closedWon: true },
      }),
    ]);
    out.push({
      userId: r.userId,
      displayName: r.displayName,
      thisWeek: thisAgg._sum.closedWon ?? 0,
      lastWeek: lastAgg._sum.closedWon ?? 0,
    });
  }
  return out;
}

/**
 * "Source Champion" label per active L2 BDE — the source with the
 * highest closed-won count this month. BDEs with zero closed-won are
 * still listed (no badge).
 */
export async function getL2SourceLabels(
  year: number,
  month: number,
): Promise<
  Array<{
    userId: string;
    displayName: string;
    topSourceLabel: string | null;
    topSourceCount: number;
    totalClosedWon: number;
  }>
> {
  const { start, end } = monthBounds(year, month);
  const roles = await prisma.leadPulseRole.findMany({
    where: { role: "l2" },
    orderBy: [{ displayName: "asc" }],
  });
  const sources = await prisma.leadPulseSource.findMany();
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const out: Array<{
    userId: string;
    displayName: string;
    topSourceLabel: string | null;
    topSourceCount: number;
    totalClosedWon: number;
  }> = [];
  for (const r of roles) {
    const grouped = await prisma.leadPulseDailyEntry.groupBy({
      by: ["sourceId"],
      where: {
        userId: r.userId,
        roleAtEntry: "l2",
        status: "submitted",
        entryDate: { gte: toPrismaDate(start), lte: toPrismaDate(end) },
      },
      _sum: { closedWon: true },
    });
    let topLabel: string | null = null;
    let topCount = 0;
    let total = 0;
    for (const g of grouped) {
      const wonCount = g._sum.closedWon ?? 0;
      total += wonCount;
      if (wonCount > topCount) {
        topCount = wonCount;
        topLabel = sourceById.get(g.sourceId)?.label ?? null;
      }
    }
    out.push({
      userId: r.userId,
      displayName: r.displayName,
      topSourceLabel: topCount > 0 ? topLabel : null,
      topSourceCount: topCount,
      totalClosedWon: total,
    });
  }
  return out;
}

/**
 * L2 BDE × Service matrix for the given month. Target read from the
 * LeadPulseTarget table; Actual = count of parties where
 * assignedL2BdeId = BDE AND linked to that service via PartyService
 * AND have at least one non-deleted Revenue Transaction in the month.
 */
export type ServiceMatrixCell = {
  target: number;
  actual: number;
  partyNames: string[]; // surfaced via hover on the targets page
};

export type ServiceMatrix = {
  bdes: Array<{ userId: string; displayName: string }>;
  services: Array<{ id: string; name: string }>;
  cells: Map<string, ServiceMatrixCell>; // key = `${userId}|${serviceId}`
};

export async function getServiceConversionMatrix(
  year: number,
  month: number,
): Promise<ServiceMatrix> {
  const { start, end } = monthBounds(year, month);
  // All L2 BDEs (active flag intentionally not filtered — supervisor
  // wants the matrix to keep historical rosters in view).
  const roles = await prisma.leadPulseRole.findMany({
    where: { role: "l2" },
    include: { user: { select: { id: true, username: true } } },
    orderBy: [{ displayName: "asc" }],
  });

  // Show every active service as a column so the supervisor can set
  // targets even for services no L2 BDE has touched yet. We also
  // surface any historically-targeted inactive service so old targets
  // remain visible in their month.
  const allActiveServices = await prisma.service.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const partyServices = await prisma.partyService.findMany({
    where: {
      party: {
        assignedL2BdeId: { in: roles.map((r) => r.userId) },
      },
    },
    include: {
      party: { select: { id: true, name: true, assignedL2BdeId: true } },
      service: { select: { id: true, name: true, isActive: true } },
    },
  });
  const targets = await prisma.leadPulseTarget.findMany({
    where: { year, month },
  });

  const serviceMap = new Map<string, { id: string; name: string }>();
  for (const s of allActiveServices) serviceMap.set(s.id, s);
  for (const t of targets) {
    if (!serviceMap.has(t.serviceId)) {
      const svc = await prisma.service.findUnique({
        where: { id: t.serviceId },
        select: { id: true, name: true },
      });
      if (svc) serviceMap.set(svc.id, svc);
    }
  }
  const services = Array.from(serviceMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  // Build the (BDE × Service) cells, computing actuals via revenue
  // transactions in the window.
  const partyIdsToWatch = new Set(partyServices.map((ps) => ps.party.id));
  const revTxs =
    partyIdsToWatch.size === 0
      ? []
      : await prisma.transaction.findMany({
          where: {
            partyId: { in: Array.from(partyIdsToWatch) },
            deletedAt: null,
            type: "Revenue",
            date: { gte: toPrismaDate(start), lte: toPrismaDate(end) },
          },
          select: { partyId: true },
        });
  const partiesWithRev = new Set<string>();
  for (const t of revTxs) {
    if (t.partyId) partiesWithRev.add(t.partyId);
  }

  const cells = new Map<string, ServiceMatrixCell>();
  for (const r of roles) {
    for (const s of services) {
      const key = `${r.userId}|${s.id}`;
      cells.set(key, { target: 0, actual: 0, partyNames: [] });
    }
  }
  for (const t of targets) {
    const key = `${t.userId}|${t.serviceId}`;
    const c = cells.get(key);
    if (c) c.target = t.target;
    else cells.set(key, { target: t.target, actual: 0, partyNames: [] });
  }
  for (const ps of partyServices) {
    if (!ps.party.assignedL2BdeId) continue;
    if (!partiesWithRev.has(ps.party.id)) continue;
    const key = `${ps.party.assignedL2BdeId}|${ps.service.id}`;
    const c = cells.get(key);
    if (!c) continue;
    c.actual++;
    c.partyNames.push(ps.party.name);
  }
  return {
    bdes: roles.map((r) => ({ userId: r.userId, displayName: r.displayName })),
    services,
    cells,
  };
}

/**
 * Disqualified-lead analysis scoped to a single source (defaults to
 * Meta). Returns:
 *   - `monthly`: per-month totals for the current month + last N-1
 *     complete months, sorted chronologically.
 *   - `daily`: dual-window daily series — current 30 days + the
 *     matching prior 30 days (offset-aligned by day position),
 *     mirroring `getDailyLeadVolumeWithPrior` so the chart can
 *     overlay both lines.
 *   - `summary`: 30d vs prior 30d totals + % delta.
 */
export async function getSourceDisqualifiedAnalysis(
  sourceCode: string,
  year: number,
  month: number,
  monthsBack = 6,
): Promise<{
  sourceLabel: string;
  monthly: Array<{ year: number; month: number; label: string; count: number }>;
  daily: Array<{ date: string; count: number; priorDate: string; priorCount: number }>;
  summary: {
    last30d: number;
    prior30d: number;
    deltaPct: number | null;
  };
}> {
  const source = await prisma.leadPulseSource.findUnique({ where: { code: sourceCode } });
  if (!source) {
    return {
      sourceLabel: sourceCode,
      monthly: [],
      daily: [],
      summary: { last30d: 0, prior30d: 0, deltaPct: null },
    };
  }

  // Monthly view — current month + (monthsBack - 1) prior months.
  const monthList: Array<{ year: number; month: number }> = [{ year, month }];
  let y = year;
  let m = month;
  for (let i = 1; i < monthsBack; i++) {
    ({ year: y, month: m } = prevMonth(y, m));
    monthList.unshift({ year: y, month: m });
  }
  const monthly: Array<{ year: number; month: number; label: string; count: number }> = [];
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  for (const ym of monthList) {
    const { start, end } = monthBounds(ym.year, ym.month);
    const agg = await prisma.leadPulseDailyEntry.aggregate({
      where: {
        sourceId: source.id,
        status: "submitted",
        entryDate: { gte: toPrismaDate(start), lte: toPrismaDate(end) },
      },
      _sum: { disqualified: true },
    });
    monthly.push({
      year: ym.year,
      month: ym.month,
      label: `${monthNames[ym.month - 1]} '${String(ym.year).slice(-2)}`,
      count: agg._sum.disqualified ?? 0,
    });
  }

  // Daily 30d vs prior 30d.
  const today = todayIst();
  const currStart = addDays(today, -29);
  const priorStart = addDays(currStart, -30);
  const priorEnd = addDays(currStart, -1);
  const rows = await prisma.leadPulseDailyEntry.findMany({
    where: {
      sourceId: source.id,
      status: "submitted",
      entryDate: { gte: toPrismaDate(priorStart), lte: toPrismaDate(today) },
    },
    select: { entryDate: true, disqualified: true },
  });
  const buckets = new Map<string, number>();
  // Pre-seed the full 60-day range so missing days show 0.
  for (let i = 0; i < 60; i++) buckets.set(addDays(priorStart, i), 0);
  for (const r of rows) {
    const d = r.entryDate.toISOString().slice(0, 10);
    buckets.set(d, (buckets.get(d) ?? 0) + (r.disqualified ?? 0));
  }
  const daily: Array<{ date: string; count: number; priorDate: string; priorCount: number }> = [];
  for (let i = 0; i < 30; i++) {
    const date = addDays(currStart, i);
    const priorDate = addDays(priorStart, i);
    daily.push({
      date,
      count: buckets.get(date) ?? 0,
      priorDate,
      priorCount: buckets.get(priorDate) ?? 0,
    });
  }
  const last30d = daily.reduce((a, r) => a + r.count, 0);
  const prior30d = daily.reduce((a, r) => a + r.priorCount, 0);
  const deltaPct =
    prior30d === 0
      ? null
      : Math.round(((last30d - prior30d) / prior30d) * 1000) / 10;
  void priorEnd; // referenced via the last priorDate

  return {
    sourceLabel: source.label,
    monthly,
    daily,
    summary: { last30d, prior30d, deltaPct },
  };
}
