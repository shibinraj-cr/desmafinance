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

/** Per-BDE roster snapshot for "today's entries" panel. */
export async function getTodaysEntryStatus(): Promise<
  Array<{
    userId: string;
    displayName: string;
    role: string;
    leadsLogged: number;
    status: "submitted" | "draft" | "missing";
  }>
> {
  const today = todayIst();
  const dateValue = toPrismaDate(today);
  const roles = await prisma.leadPulseRole.findMany({
    where: { active: true, role: { in: ["l1", "l2"] } },
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
      active: true,
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
