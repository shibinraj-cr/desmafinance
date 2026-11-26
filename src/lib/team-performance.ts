// Data layer for the Team Performance module (/performance/*).
// Candidate support = PerfWaStaffDaily / PerfWaUnanswered (written by the
// daily WhatsApp scoring routine). Sales = Lead Pulse daily entries,
// L2 targets and Voxbay calls that Desgro already holds.
import { prisma } from "./prisma";
import { parsePeriod, rangeFor } from "./period";
import { addDays, fromPrismaDate, toPrismaDate, todayIst } from "./lead-pulse-dates";
import { getMonthlyMatrix } from "./lead-pulse-metrics";

export type DayRange = { start: string; end: string; label: string };

/** Resolve ?period/from/to into an inclusive YYYY-MM-DD range. Defaults to this month (IST). */
export function resolveRange(sp: { period?: string; from?: string; to?: string }): DayRange {
  const period = parsePeriod(sp);
  const r = rangeFor(period);
  if (r.from && r.to) {
    const start = fromPrismaDate(r.from);
    const end = addDays(fromPrismaDate(r.to), -1);
    return { start, end, label: `${fmtDay(start)} – ${fmtDay(end)}` };
  }
  const today = todayIst();
  const start = today.slice(0, 8) + "01";
  return { start, end: today, label: `${fmtDay(start)} – ${fmtDay(today)} (month to date)` };
}

export function fmtDay(d: string): string {
  const dt = toPrismaDate(d);
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
const round1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

// ── Holidays (Desgro HR calendar) ─────────────────────────────────────────
export async function getHolidayMap(start: string, end: string): Promise<Map<string, string>> {
  const rows = await prisma.holiday.findMany({
    where: { date: { gte: toPrismaDate(start), lte: toPrismaDate(end) } },
    select: { date: true, label: true },
  });
  return new Map(rows.map((h) => [fromPrismaDate(h.date), h.label]));
}

export function isSunday(d: string): boolean {
  return toPrismaDate(d).getUTCDay() === 0;
}

// ── Candidate support ─────────────────────────────────────────────────────
export type StaffSummary = {
  staff: string;
  queries: number;
  sharePct: number;
  typicalReplyMin: number | null;
  quality: number | null;
  accuracy: number | null;
  completeness: number | null;
  tone: number | null;
  nextStep: number | null;
  closuresDone: number;
  closuresNeeded: number;
  keptPct: number | null;
  offDaysActive: number;
  offDays: number;
};

export async function getStaffSummary(range: DayRange): Promise<{ rows: StaffSummary[]; total: number; offDays: number }> {
  const rows = await prisma.perfWaStaffDaily.findMany({
    where: { date: { gte: toPrismaDate(range.start), lte: toPrismaDate(range.end) } },
    orderBy: [{ date: "asc" }],
  });
  const offDayDates = new Set(rows.filter((r) => r.sundayHolidayActive !== null).map((r) => fromPrismaDate(r.date)));
  const by = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!by.has(r.staff)) by.set(r.staff, []);
    by.get(r.staff)!.push(r);
  }
  const total = rows.reduce((a, r) => a + r.queriesAnswered, 0);
  const out: StaffSummary[] = [];
  for (const [staff, rs] of by) {
    const queries = rs.reduce((a, r) => a + r.queriesAnswered, 0);
    const pick = (k: "avgAccuracy" | "avgCompleteness" | "avgTone" | "avgNextStep") =>
      rs.flatMap((r) => (r[k] == null ? [] : [r[k] as number]));
    const acc = mean(pick("avgAccuracy"));
    const comp = mean(pick("avgCompleteness"));
    const tone = mean(pick("avgTone"));
    const nxt = mean(pick("avgNextStep"));
    const parts = [acc, comp, tone, nxt].filter((x): x is number => x != null);
    const done = rs.reduce((a, r) => a + r.closuresDone, 0);
    const needed = rs.reduce((a, r) => a + r.closuresNeeded, 0);
    out.push({
      staff,
      queries,
      sharePct: total ? Math.round((queries / total) * 1000) / 10 : 0,
      typicalReplyMin: round1(median(rs.flatMap((r) => (r.medianResponseMin == null ? [] : [r.medianResponseMin])))),
      quality: round1(mean(parts)),
      accuracy: round1(acc),
      completeness: round1(comp),
      tone: round1(tone),
      nextStep: round1(nxt),
      closuresDone: done,
      closuresNeeded: needed,
      keptPct: needed ? Math.round((done / needed) * 100) : null,
      offDaysActive: rs.filter((r) => r.sundayHolidayActive === true).length,
      offDays: offDayDates.size,
    });
  }
  out.sort((a, b) => b.queries - a.queries);
  return { rows: out, total, offDays: offDayDates.size };
}

export type DayPoint = { date: string; label: string; answered: number; missed: number; offDay: boolean; holiday: string | null };

export async function getDailySeries(range: DayRange): Promise<DayPoint[]> {
  const [scores, unans, holidays] = await Promise.all([
    prisma.perfWaStaffDaily.groupBy({
      by: ["date"],
      where: { date: { gte: toPrismaDate(range.start), lte: toPrismaDate(range.end) } },
      _sum: { queriesAnswered: true },
    }),
    prisma.perfWaUnanswered.groupBy({
      by: ["date"],
      where: { date: { gte: toPrismaDate(range.start), lte: toPrismaDate(range.end) } },
      _count: { _all: true },
    }),
    getHolidayMap(range.start, range.end),
  ]);
  const ans = new Map(scores.map((s) => [fromPrismaDate(s.date), s._sum.queriesAnswered ?? 0]));
  const miss = new Map(unans.map((u) => [fromPrismaDate(u.date), u._count._all]));
  const out: DayPoint[] = [];
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
    const holiday = holidays.get(d) ?? null;
    out.push({
      date: d,
      label: String(Number(d.slice(8))),
      answered: ans.get(d) ?? 0,
      missed: miss.get(d) ?? 0,
      offDay: isSunday(d) || !!holiday,
      holiday,
    });
  }
  return out;
}

export async function getUnanswered(range: DayRange) {
  return prisma.perfWaUnanswered.findMany({
    where: { date: { gte: toPrismaDate(range.start), lte: toPrismaDate(range.end) } },
    orderBy: [{ date: "desc" }, { queryAt: "desc" }],
  });
}

export async function getDailyRows(range: DayRange) {
  return prisma.perfWaStaffDaily.findMany({
    where: { date: { gte: toPrismaDate(range.start), lte: toPrismaDate(range.end) } },
    orderBy: [{ date: "desc" }, { queriesAnswered: "desc" }],
  });
}

// ── Sales (BDE) ───────────────────────────────────────────────────────────
export type BdeRow = {
  userId: string;
  name: string;
  role: "l1" | "l2";
  leads: number;
  won: number;
  conversionPct: number | null;
  target: number | null;
  calls: number;
  talkMin: number;
};

export async function getBdeSummary(range: DayRange): Promise<BdeRow[]> {
  const year = Number(range.start.slice(0, 4));
  const month = Number(range.start.slice(5, 7));
  const [matrix, targets, calls] = await Promise.all([
    getMonthlyMatrix({ year, month, startDate: range.start, endDate: range.end }),
    prisma.leadPulseTarget.groupBy({
      by: ["userId"],
      where: { year, month },
      _sum: { target: true },
    }),
    prisma.voxbayCall.groupBy({
      by: ["agentName"],
      where: {
        callStartTime: { gte: toPrismaDate(range.start), lt: toPrismaDate(addDays(range.end, 1)) },
        answeredDurationSec: { gt: 0 },
      },
      _count: { _all: true },
      _sum: { answeredDurationSec: true },
    }),
  ]);
  const targetBy = new Map(targets.map((t) => [t.userId, t._sum.target ?? 0]));
  // Voxbay only knows the agent's display name: match on the first name.
  const first = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const callsBy = new Map<string, { n: number; sec: number }>();
  for (const c of calls) {
    const k = first(c.agentName);
    if (!k) continue;
    const prev = callsBy.get(k) ?? { n: 0, sec: 0 };
    callsBy.set(k, { n: prev.n + c._count._all, sec: prev.sec + (c._sum.answeredDurationSec ?? 0) });
  }
  const rows = [...matrix.l2Rows, ...matrix.l1Rows].map((r) => {
    const c = callsBy.get(first(r.displayName)) ?? { n: 0, sec: 0 };
    return {
      userId: r.userId,
      name: r.displayName,
      role: r.role,
      leads: r.total.leads,
      won: r.total.won,
      conversionPct: r.total.conversionPct,
      target: r.role === "l2" ? (targetBy.get(r.userId) ?? null) : null,
      calls: c.n,
      talkMin: Math.round(c.sec / 60),
    };
  });
  return rows;
}
