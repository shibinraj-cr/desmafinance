// Fiscal-year date math for FY 2026-27 (Apr 2026 – Mar 2027). All ranges are
// half-open: [from, to) — `from` inclusive, `to` exclusive at midnight UTC.

export const FY_START = new Date(Date.UTC(2026, 3, 1)); // Apr 1, 2026
export const FY_END = new Date(Date.UTC(2027, 3, 1)); // Apr 1, 2027 (exclusive)

export const MONTH_LABELS = [
  "Apr-26",
  "May-26",
  "Jun-26",
  "Jul-26",
  "Aug-26",
  "Sep-26",
  "Oct-26",
  "Nov-26",
  "Dec-26",
  "Jan-27",
  "Feb-27",
  "Mar-27",
] as const;

const MONTH_TO_INDEX: Record<string, number> = Object.fromEntries(
  MONTH_LABELS.map((m, i) => [m, i]),
);

export type Period =
  | { kind: "all" }
  | { kind: "fy" }
  | { kind: "month"; label: string }
  | { kind: "quarter"; q: 1 | 2 | 3 | 4 }
  | { kind: "half"; h: 1 | 2 }
  | { kind: "custom"; from?: Date; to?: Date };

export type Range = { from?: Date; to?: Date };

const QUARTER_RANGES: Record<1 | 2 | 3 | 4, [number, number]> = {
  1: [0, 3], // Apr-Jun
  2: [3, 6], // Jul-Sep
  3: [6, 9], // Oct-Dec
  4: [9, 12], // Jan-Mar
};

const HALF_RANGES: Record<1 | 2, [number, number]> = {
  1: [0, 6], // Apr-Sep
  2: [6, 12], // Oct-Mar
};

function monthStart(idx: number): Date {
  // idx is offset from FY start (0 = Apr 2026, 11 = Mar 2027)
  const m = (3 + idx) % 12;
  const yr = 2026 + Math.floor((3 + idx) / 12);
  return new Date(Date.UTC(yr, m, 1));
}

export function rangeFor(period: Period): Range {
  switch (period.kind) {
    case "all":
      return {};
    case "fy":
      return { from: FY_START, to: FY_END };
    case "month": {
      const idx = MONTH_TO_INDEX[period.label];
      if (idx === undefined) return {};
      return { from: monthStart(idx), to: monthStart(idx + 1) };
    }
    case "quarter": {
      const [s, e] = QUARTER_RANGES[period.q];
      return { from: monthStart(s), to: monthStart(e) };
    }
    case "half": {
      const [s, e] = HALF_RANGES[period.h];
      return { from: monthStart(s), to: monthStart(e) };
    }
    case "custom": {
      return { from: period.from, to: period.to };
    }
  }
}

export function parsePeriod(searchParams: { period?: string; from?: string; to?: string }): Period {
  const p = searchParams.period;
  if (!p || p === "all") return { kind: "all" };
  if (p === "fy") return { kind: "fy" };
  if (p === "q1" || p === "q2" || p === "q3" || p === "q4") {
    return { kind: "quarter", q: Number(p[1]) as 1 | 2 | 3 | 4 };
  }
  if (p === "h1" || p === "h2") {
    return { kind: "half", h: Number(p[1]) as 1 | 2 };
  }
  if (MONTH_TO_INDEX[p] !== undefined) {
    return { kind: "month", label: p };
  }
  // A custom range may be open-ended (only `from` or only `to` set) — e.g. the
  // Leads "Created" filter applies each side independently as it's typed.
  if (p === "custom" && (searchParams.from || searchParams.to)) {
    const from = searchParams.from ? new Date(searchParams.from) : undefined;
    let to = searchParams.to ? new Date(searchParams.to) : undefined;
    // Treat `to` as inclusive end-of-day
    if (to) to.setUTCDate(to.getUTCDate() + 1);
    const fromOk = !from || !isNaN(+from);
    const toOk = !to || !isNaN(+to);
    if (fromOk && toOk && (!from || !to || from < to)) {
      return { kind: "custom", from, to };
    }
  }
  return { kind: "all" };
}

export function periodLabel(period: Period): string {
  switch (period.kind) {
    case "all":
      return "All time";
    case "fy":
      return "FY 2026-27";
    case "month":
      return period.label;
    case "quarter":
      return `Q${period.q} (${labelForQuarter(period.q)})`;
    case "half":
      return `H${period.h} (${labelForHalf(period.h)})`;
    case "custom": {
      const f = period.from ? period.from.toISOString().slice(0, 10) : null;
      const t = period.to ? new Date(+period.to - 86400000).toISOString().slice(0, 10) : null;
      if (f && t) return `${f} → ${t}`;
      if (f) return `From ${f}`;
      if (t) return `Until ${t}`;
      return "Custom range";
    }
  }
}

function labelForQuarter(q: 1 | 2 | 3 | 4): string {
  return ["Apr-Jun", "Jul-Sep", "Oct-Dec", "Jan-Mar"][q - 1];
}
function labelForHalf(h: 1 | 2): string {
  return ["Apr-Sep", "Oct-Mar"][h - 1];
}
