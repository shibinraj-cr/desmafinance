/**
 * Month-by-month comparison for the BDE Enrollment dashboard: the same three
 * facts the single-month view shows — leads given, enrolments, enrolled ₹ —
 * laid out across a window of months, once per BDE and once per source.
 *
 * Pure: the caller fetches the facts (`getCrmMonthlyFacts`) and this only
 * buckets them, so it is unit-tested without a database. Both tables are built
 * from the same facts, which is what makes their team totals agree.
 */

export type MonthKey = string; // YYYY-MM

export type ComparisonMonth = { value: MonthKey; label: string; short: string; partial: boolean };

/** One (assignee, source, month) count of deliberately-assigned leads. */
export type LeadFact = { userId: string; sourceId: string | null; month: MonthKey; count: number };
/** One closed_won pipeline (a CRM enrolment), dated by its close month. */
export type SaleFact = { userId: string; sourceId: string; month: MonthKey; value: number };

export type ComparisonCell = { leads: number; enrolled: number; value: number };

export type ComparisonRow = {
  id: string;
  name: string;
  /** Short qualifier shown after the name: the BDE's level, or "inactive" / "not on roster". */
  note: string | null;
  /** Roster BDEs open the consultant drawer on click; anyone else has no drawer payload. */
  clickable: boolean;
  cells: ComparisonCell[];
  total: ComparisonCell;
};

export type ComparisonTable = { rows: ComparisonRow[]; totals: ComparisonCell[]; grandTotal: ComparisonCell };

export type MonthlyComparison = { months: ComparisonMonth[]; byBde: ComparisonTable; bySource: ComparisonTable };

export const NO_SOURCE_ID = "__none__";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The `count` calendar months (oldest→newest) ending at `year`-`month`. */
export function monthsEnding(year: number, month: number, count: number): Array<{ year: number; month: number; value: MonthKey }> {
  const out: Array<{ year: number; month: number; value: MonthKey }> = [];
  for (let i = count - 1; i >= 0; i--) {
    let y = year;
    let m = month - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    out.push({ year: y, month: m, value: `${y}-${String(m).padStart(2, "0")}` });
  }
  return out;
}

/** Column headers for a window; the year is shown only when the window spans two. */
export function comparisonMonths(window: Array<{ year: number; month: number; value: MonthKey }>, currentMonth: MonthKey): ComparisonMonth[] {
  const spansYears = new Set(window.map((w) => w.year)).size > 1;
  return window.map((w) => ({
    value: w.value,
    label: `${MONTH_ABBR[w.month - 1]} ${w.year}`,
    short: spansYears ? `${MONTH_ABBR[w.month - 1]} ’${String(w.year).slice(2)}` : MONTH_ABBR[w.month - 1],
    partial: w.value === currentMonth,
  }));
}

/** Enrolled ÷ leads given, as a 1-dp percent; null when no leads were given. */
export function cellConversion(c: ComparisonCell): number | null {
  if (!c.leads) return null;
  return Math.round((c.enrolled / c.leads) * 1000) / 10;
}

const emptyCell = (): ComparisonCell => ({ leads: 0, enrolled: 0, value: 0 });

function addInto(into: ComparisonCell, from: ComparisonCell) {
  into.leads += from.leads;
  into.enrolled += from.enrolled;
  into.value += from.value;
}

/** Accumulates facts into per-key rows of month cells. */
class Grid {
  private readonly index: Map<MonthKey, number>;
  readonly rows = new Map<string, ComparisonCell[]>();

  constructor(private readonly months: MonthKey[]) {
    this.index = new Map(months.map((m, i) => [m, i]));
  }

  ensure(key: string): ComparisonCell[] {
    let cells = this.rows.get(key);
    if (!cells) {
      cells = this.months.map(emptyCell);
      this.rows.set(key, cells);
    }
    return cells;
  }

  cell(key: string, month: MonthKey): ComparisonCell | null {
    const i = this.index.get(month);
    return i === undefined ? null : this.ensure(key)[i];
  }
}

function finish(rows: Array<Omit<ComparisonRow, "total">>, monthCount: number): ComparisonTable {
  const totals = Array.from({ length: monthCount }, emptyCell);
  const grandTotal = emptyCell();
  const withTotals = rows.map((r) => {
    const total = emptyCell();
    r.cells.forEach((c, i) => {
      addInto(total, c);
      addInto(totals[i], c);
    });
    addInto(grandTotal, total);
    return { ...r, total };
  });
  return { rows: withTotals, totals, grandTotal };
}

const byResult = (a: ComparisonRow, b: ComparisonRow) =>
  b.total.enrolled - a.total.enrolled || b.total.value - a.total.value || b.total.leads - a.total.leads || a.name.localeCompare(b.name);

const isEmpty = (r: ComparisonRow) => !r.total.leads && !r.total.enrolled && !r.total.value;

/**
 * Builds both tables from one set of facts.
 *
 * BDE rows: every roster member (even at zero, as the single-month table shows
 * them), then anyone else who was given leads or closed an enrolment in the
 * window — typically a BDE who has since left, whose past months would
 * otherwise vanish and leave the team totals short of the source totals.
 *
 * Source rows: every source with any activity in the window, including an
 * inactive one and leads with no source, so the two tables always reconcile.
 */
export function buildMonthlyComparison(input: {
  months: MonthKey[];
  leads: LeadFact[];
  sales: SaleFact[];
  roster: Array<{ userId: string; name: string; role: string }>;
  /** Display names for people outside the roster who appear in the facts. */
  otherNames: Map<string, string>;
  sources: Array<{ id: string; label: string; active: boolean }>;
}): { byBde: ComparisonTable; bySource: ComparisonTable } {
  const bde = new Grid(input.months);
  const src = new Grid(input.months);

  for (const f of input.leads) {
    const b = bde.cell(f.userId, f.month);
    if (b) b.leads += f.count;
    const s = src.cell(f.sourceId ?? NO_SOURCE_ID, f.month);
    if (s) s.leads += f.count;
  }
  for (const f of input.sales) {
    const b = bde.cell(f.userId, f.month);
    if (b) {
      b.enrolled += 1;
      b.value += f.value;
    }
    const s = src.cell(f.sourceId, f.month);
    if (s) {
      s.enrolled += 1;
      s.value += f.value;
    }
  }

  const rosterIds = new Set(input.roster.map((r) => r.userId));
  const rosterRows = input.roster.map((r) => ({
    id: r.userId,
    name: r.name,
    note: r.role.toUpperCase(),
    clickable: true,
    cells: bde.ensure(r.userId),
  }));
  const otherRows = [...bde.rows.keys()]
    .filter((id) => !rosterIds.has(id))
    .map((id) => ({ id, name: input.otherNames.get(id) ?? "Unknown user", note: "not on roster", clickable: false, cells: bde.ensure(id) }));
  const bdeTable = finish([...rosterRows, ...otherRows], input.months.length);
  bdeTable.rows = [
    ...bdeTable.rows.filter((r) => r.clickable).sort(byResult),
    ...bdeTable.rows.filter((r) => !r.clickable && !isEmpty(r)).sort(byResult),
  ];

  const sourceById = new Map(input.sources.map((s) => [s.id, s]));
  const sourceTable = finish(
    [...src.rows.entries()].map(([id, cells]) => {
      const s = sourceById.get(id);
      return {
        id,
        name: id === NO_SOURCE_ID ? "No source" : (s?.label ?? "Unknown source"),
        note: s && !s.active ? "inactive" : null,
        clickable: false,
        cells,
      };
    }),
    input.months.length,
  );
  sourceTable.rows = sourceTable.rows.filter((r) => !isEmpty(r)).sort(byResult);

  return { byBde: bdeTable, bySource: sourceTable };
}
