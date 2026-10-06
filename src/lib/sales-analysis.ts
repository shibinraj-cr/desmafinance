/**
 * Sales Analysis — the pivot engine behind /executive/sales-analysis.
 *
 * The server ships three fact sets for the chosen period (and the equal-length
 * period before it, for the "vs previous" deltas):
 *
 *   - enrollments  — CRM closed-won deals (`LeadPulsePipeline`), dated by
 *                    `closedDate`, carrying their lead's attributes;
 *   - collections  — finance Revenue transactions, dated by `date`, carrying
 *                    the candidate's source / BDE / service where known;
 *   - leads        — CRM leads created in the period (duplicates excluded).
 *
 * Every fact carries the same dimension slots, so any measure can be cut by any
 * dimension. A slot a fact cannot know (payment mode on a lead, say) is -1 and
 * reads as "Not applicable". The engine is pure — no Prisma — so the client can
 * re-pivot instantly and the tests can drive it with plain rows.
 */

// ── Dimensions ───────────────────────────────────────────────────────────────

/** Dimensions stored on each fact as an index into `dicts[key]`. */
export const STORED_DIMS = [
  "source",
  "originalSource",
  "bde",
  "service",
  "serviceGroup",
  "qualification",
  "country",
  "destination",
  "campaign",
  "temperature",
  "customerType",
  "revenueCategory",
  "paymentMode",
  "market",
  "closeSpeed",
] as const;
export type StoredDim = (typeof STORED_DIMS)[number];

/** Dimensions derived from the fact's day. */
export const TIME_DIMS = ["month", "quarter", "week", "weekday"] as const;
export type TimeDim = (typeof TIME_DIMS)[number];

export type DimKey = StoredDim | TimeDim;

export const DIM_LABELS: Record<DimKey, string> = {
  source: "Source",
  originalSource: "Original source",
  bde: "BDE",
  service: "Service",
  serviceGroup: "Service group",
  qualification: "Qualification",
  country: "Country",
  destination: "Study destination",
  campaign: "Campaign",
  temperature: "Temperature",
  customerType: "New vs repeat",
  revenueCategory: "Revenue category",
  paymentMode: "Payment mode",
  market: "Export / Domestic",
  closeSpeed: "Lead → close time",
  month: "Month",
  quarter: "FY quarter",
  week: "Week (Sat–Fri)",
  weekday: "Weekday",
};

/** Dimensions that only exist on collections — worth a hint in the UI. */
export const COLLECTION_ONLY_DIMS: readonly DimKey[] = ["revenueCategory", "paymentMode", "market"];
/** Dimensions that only exist on enrollments. */
export const ENROLLMENT_ONLY_DIMS: readonly DimKey[] = ["closeSpeed"];

export const NOT_APPLICABLE = "Not applicable";
export const UNKNOWN = "Not set";

/** Fixed display order for dims whose values have a natural sequence. */
export const CLOSE_SPEED_BUCKETS = ["0–7 days", "8–30 days", "31–60 days", "61–90 days", "90+ days"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function closeSpeedBucket(days: number): string {
  if (days <= 7) return CLOSE_SPEED_BUCKETS[0];
  if (days <= 30) return CLOSE_SPEED_BUCKETS[1];
  if (days <= 60) return CLOSE_SPEED_BUCKETS[2];
  if (days <= 90) return CLOSE_SPEED_BUCKETS[3];
  return CLOSE_SPEED_BUCKETS[4];
}

// ── Facts ────────────────────────────────────────────────────────────────────

export const FACT_ENROLLMENT = 0;
export const FACT_COLLECTION = 1;
export const FACT_LEAD = 2;
export type FactKind = typeof FACT_ENROLLMENT | typeof FACT_COLLECTION | typeof FACT_LEAD;

/**
 * One fact. `day` is days since 1970-01-01 for the IST calendar day; `dims` is
 * aligned to {@link STORED_DIMS}. `weight` is the service weight (enrollments),
 * `booked` the package value (enrollments), `amount` the money received
 * (collections). Unused numbers are 0.
 */
export type Fact = {
  kind: FactKind;
  day: number;
  dims: number[];
  weight: number;
  booked: number;
  amount: number;
};

/** Wire format: `[kind, day, ...dims, weight, booked, amount]` — compact JSON. */
export type WireFact = number[];

export function encodeFact(f: Fact): WireFact {
  return [f.kind, f.day, ...f.dims, Math.round(f.weight * 100) / 100, Math.round(f.booked), Math.round(f.amount)];
}

export function decodeFact(w: WireFact): Fact {
  const n = STORED_DIMS.length;
  return {
    kind: w[0] as FactKind,
    day: w[1],
    dims: w.slice(2, 2 + n),
    weight: w[2 + n],
    booked: w[3 + n],
    amount: w[4 + n],
  };
}

export type Dicts = Record<StoredDim, string[]>;

// ── Day helpers (UTC arithmetic on IST calendar days) ────────────────────────

const DAY_MS = 86_400_000;

export function dayFromYmd(ymd: string): number {
  return Math.floor(Date.parse(`${ymd}T00:00:00.000Z`) / DAY_MS);
}

export function ymdFromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** IST calendar day of an instant (e.g. `Lead.createdAt`). */
export function istDay(d: Date): number {
  return Math.floor((d.getTime() + 330 * 60_000) / DAY_MS);
}

/** Day number of a `@db.Date` / midnight-UTC date column. */
export function utcDay(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}

function dayLabel(day: number): string {
  const d = new Date(day * DAY_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Saturday on or before the day — the company week used by Weekly P&L. */
export function weekStartDay(day: number): number {
  const dow = new Date(day * DAY_MS).getUTCDay(); // 0=Sun … 6=Sat
  return day - ((dow + 1) % 7);
}

/**
 * Sortable key + display label for a time dimension. Keys sort
 * chronologically as strings; labels are what the table shows.
 */
export function timeBucket(dim: TimeDim, day: number): { key: string; label: string } {
  const d = new Date(day * DAY_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (dim) {
    case "month":
      return { key: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MONTHS[m]} ${y}` };
    case "quarter": {
      // Indian FY: Q1 = Apr–Jun. FY "2026" runs Apr-26 → Mar-27.
      const fy = m >= 3 ? y : y - 1;
      const q = Math.floor(((m + 9) % 12) / 3) + 1;
      return { key: `${fy}-Q${q}`, label: quarterLabel(fy, q) };
    }
    case "week": {
      const s = weekStartDay(day);
      return { key: ymdFromDay(s), label: `${dayLabel(s)} – ${dayLabel(s + 6)}` };
    }
    case "weekday": {
      const i = (d.getUTCDay() + 6) % 7; // Mon=0
      return { key: String(i), label: WEEKDAYS[i] };
    }
  }
}

export function isTimeDim(dim: DimKey): dim is TimeDim {
  return (TIME_DIMS as readonly string[]).includes(dim);
}

/** Bucket key of a fact on a dimension (labels resolved separately). */
export function bucketKey(f: Fact, dim: DimKey): string {
  if (isTimeDim(dim)) return timeBucket(dim, f.day).key;
  const idx = f.dims[STORED_DIMS.indexOf(dim)];
  return idx < 0 ? NOT_APPLICABLE : String(idx);
}

export function bucketLabel(key: string, dim: DimKey, dicts: Dicts): string {
  if (key === NOT_APPLICABLE) return NOT_APPLICABLE;
  if (isTimeDim(dim)) {
    if (dim === "month") {
      const [y, m] = key.split("-").map(Number);
      return `${MONTHS[m - 1]} ${y}`;
    }
    if (dim === "quarter") return quarterLabel(Number(key.slice(0, 4)), Number(key.slice(-1)));
    if (dim === "week") return timeBucket("week", dayFromYmd(key)).label;
    return WEEKDAYS[Number(key)];
  }
  return dicts[dim][Number(key)] ?? UNKNOWN;
}

function quarterLabel(fy: number, q: number): string {
  return `Q${q} FY${String(fy).slice(2)}-${String(fy + 1).slice(2)}`;
}

/** Chronological / natural order for dims that have one; null = sort by value. */
function naturalOrder(dim: DimKey, dicts: Dicts): ((a: string, b: string) => number) | null {
  if (isTimeDim(dim)) {
    if (dim === "weekday") return (a, b) => Number(a) - Number(b);
    // Quarter keys are "<FY>-Q<n>", so FY Q4 (Jan–Mar) already sorts after Q3.
    return (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  }
  if (dim === "closeSpeed") {
    const pos = (k: string) => (k === NOT_APPLICABLE ? 99 : CLOSE_SPEED_BUCKETS.indexOf(dicts.closeSpeed[Number(k)]));
    return (a, b) => pos(a) - pos(b);
  }
  return null;
}

// ── Measures ─────────────────────────────────────────────────────────────────

export type Acc = {
  enrollments: number;
  weighted: number;
  booked: number;
  collected: number;
  leads: number;
};

export const emptyAcc = (): Acc => ({ enrollments: 0, weighted: 0, booked: 0, collected: 0, leads: 0 });

export function addFact(acc: Acc, f: Fact): void {
  if (f.kind === FACT_ENROLLMENT) {
    acc.enrollments += 1;
    acc.weighted += f.weight;
    acc.booked += f.booked;
  } else if (f.kind === FACT_COLLECTION) {
    acc.collected += f.amount;
  } else {
    acc.leads += 1;
  }
}

export const MEASURES = ["enrollments", "weighted", "booked", "avgTicket", "collected", "leads", "conversion"] as const;
export type MeasureKey = (typeof MEASURES)[number];

export type MeasureFormat = "count" | "decimal" | "inr" | "pct";

export const MEASURE_META: Record<MeasureKey, { label: string; short: string; format: MeasureFormat; hint: string }> = {
  enrollments: { label: "Enrollments", short: "Enrol.", format: "count", hint: "CRM deals closed-won in the period" },
  weighted: { label: "Weighted enrollments", short: "Weighted", format: "decimal", hint: "Enrollments × service weight (the target-matrix count)" },
  booked: { label: "Booked value", short: "Booked", format: "inr", hint: "Package amount on the candidate's finance record; deal value when none" },
  avgTicket: { label: "Avg ticket", short: "Avg ticket", format: "inr", hint: "Booked value ÷ enrollments" },
  collected: { label: "Collected revenue", short: "Collected", format: "inr", hint: "Finance Revenue transactions dated in the period" },
  leads: { label: "Leads created", short: "Leads", format: "count", hint: "CRM leads created in the period, duplicates excluded" },
  conversion: { label: "Conversion", short: "Conv.", format: "pct", hint: "Enrollments ÷ leads created, same period" },
};

/** Measures whose total is not the sum of its parts (ratios). */
export const RATIO_MEASURES: readonly MeasureKey[] = ["avgTicket", "conversion"];

export function measureValue(acc: Acc, m: MeasureKey): number | null {
  switch (m) {
    case "enrollments":
      return acc.enrollments;
    case "weighted":
      return acc.weighted;
    case "booked":
      return acc.booked;
    case "collected":
      return acc.collected;
    case "leads":
      return acc.leads;
    case "avgTicket":
      return acc.enrollments ? acc.booked / acc.enrollments : null;
    case "conversion":
      return acc.leads ? (acc.enrollments / acc.leads) * 100 : null;
  }
}

/** Percentage change, or null when there is no base to compare with. */
export function deltaPct(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

// ── Filtering ────────────────────────────────────────────────────────────────

/** Selected bucket keys per dimension; an absent / empty list = no filter. */
export type Filters = Partial<Record<DimKey, string[]>>;

export function matches(f: Fact, filters: Filters): boolean {
  for (const [dim, keys] of Object.entries(filters) as Array<[DimKey, string[] | undefined]>) {
    if (!keys || keys.length === 0) continue;
    if (!keys.includes(bucketKey(f, dim))) return false;
  }
  return true;
}

export function inRange(f: Fact, from: number, to: number): boolean {
  return f.day >= from && f.day <= to;
}

// ── Pivot ────────────────────────────────────────────────────────────────────

export type PivotRow = {
  key: string;
  label: string;
  acc: Acc;
  prev: Acc;
  /** Per split-column accumulators, keyed by split bucket key. */
  cells: Record<string, Acc>;
};

export type PivotColumn = { key: string; label: string; acc: Acc };

export type Pivot = {
  rows: PivotRow[];
  /** Rows beyond `topN`, folded into one "Other" row (null when none). */
  other: PivotRow | null;
  columns: PivotColumn[];
  total: Acc;
  prevTotal: Acc;
};

export const OTHER_KEY = "__other__";

/**
 * Group `facts` by `rowDim` (and optionally `colDim`), within the current range
 * and its previous-period twin. Rows are ordered naturally for time-like dims,
 * otherwise by `sortBy` descending; past `topN` they fold into "Other". Split
 * columns keep the top `topCols` by `sortBy` and fold the rest into "Other".
 */
export function pivot(opts: {
  facts: Fact[];
  dicts: Dicts;
  rowDim: DimKey;
  colDim?: DimKey | null;
  filters: Filters;
  range: { from: number; to: number };
  prevRange: { from: number; to: number };
  sortBy: MeasureKey;
  topN?: number;
  topCols?: number;
}): Pivot {
  const { facts, dicts, rowDim, colDim, filters, range, prevRange, sortBy } = opts;
  const topN = opts.topN ?? 25;
  const topCols = opts.topCols ?? 6;

  const rowMap = new Map<string, PivotRow>();
  const colMap = new Map<string, PivotColumn>();
  const total = emptyAcc();
  const prevTotal = emptyAcc();

  const rowFor = (key: string): PivotRow => {
    let r = rowMap.get(key);
    if (!r) {
      r = { key, label: bucketLabel(key, rowDim, dicts), acc: emptyAcc(), prev: emptyAcc(), cells: {} };
      rowMap.set(key, r);
    }
    return r;
  };

  for (const f of facts) {
    const cur = inRange(f, range.from, range.to);
    const prv = !cur && inRange(f, prevRange.from, prevRange.to);
    if (!cur && !prv) continue;
    if (!matches(f, filters)) continue;
    // A previous-period fact has no place on a time axis that only spans the
    // current period, so only categorical rows collect "prev".
    if (prv) {
      addFact(prevTotal, f);
      if (!isTimeDim(rowDim)) addFact(rowFor(bucketKey(f, rowDim)).prev, f);
      continue;
    }
    addFact(total, f);
    const row = rowFor(bucketKey(f, rowDim));
    addFact(row.acc, f);
    if (colDim) {
      const ck = bucketKey(f, colDim);
      const cell = (row.cells[ck] ??= emptyAcc());
      addFact(cell, f);
      let col = colMap.get(ck);
      if (!col) {
        col = { key: ck, label: bucketLabel(ck, colDim, dicts), acc: emptyAcc() };
        colMap.set(ck, col);
      }
      addFact(col.acc, f);
    }
  }

  // Previous-only rows (a source that sold last period, nothing this one) still
  // matter for a "what dropped" read, but rows with nothing in either are noise.
  const byValue = (a: { acc: Acc }, b: { acc: Acc }) =>
    (measureValue(b.acc, sortBy) ?? -Infinity) - (measureValue(a.acc, sortBy) ?? -Infinity);

  const natural = naturalOrder(rowDim, dicts);
  let rows = [...rowMap.values()];
  rows.sort(natural ? (a, b) => natural(a.key, b.key) : byValue);

  let other: PivotRow | null = null;
  if (!natural && rows.length > topN) {
    const rest = rows.slice(topN);
    rows = rows.slice(0, topN);
    other = { key: OTHER_KEY, label: `Other (${rest.length})`, acc: emptyAcc(), prev: emptyAcc(), cells: {} };
    for (const r of rest) {
      mergeAcc(other.acc, r.acc);
      mergeAcc(other.prev, r.prev);
      for (const [ck, a] of Object.entries(r.cells)) mergeAcc((other.cells[ck] ??= emptyAcc()), a);
    }
  }

  let columns: PivotColumn[] = [];
  if (colDim) {
    const colNatural = naturalOrder(colDim, dicts);
    columns = [...colMap.values()];
    if (colNatural) {
      columns.sort((a, b) => colNatural(a.key, b.key));
    } else {
      columns.sort(byValue);
      if (columns.length > topCols) {
        const rest = columns.slice(topCols - 1);
        columns = columns.slice(0, topCols - 1);
        const restKeys = new Set(rest.map((c) => c.key));
        const otherCol: PivotColumn = { key: OTHER_KEY, label: `Other (${rest.length})`, acc: emptyAcc() };
        for (const c of rest) mergeAcc(otherCol.acc, c.acc);
        for (const r of [...rows, ...(other ? [other] : [])]) {
          const folded = emptyAcc();
          for (const k of restKeys) if (r.cells[k]) mergeAcc(folded, r.cells[k]);
          r.cells[OTHER_KEY] = folded;
        }
        columns.push(otherCol);
      }
    }
  }

  return { rows, other, columns, total, prevTotal };
}

export function mergeAcc(into: Acc, from: Acc): void {
  into.enrollments += from.enrollments;
  into.weighted += from.weighted;
  into.booked += from.booked;
  into.collected += from.collected;
  into.leads += from.leads;
}

/** Bucket keys present for a dimension across the facts, labelled — for filter pickers. */
export function dimOptions(facts: Fact[], dim: DimKey, dicts: Dicts): Array<{ value: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const f of facts) {
    const k = bucketKey(f, dim);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const natural = naturalOrder(dim, dicts);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: bucketLabel(value, dim, dicts), count }))
    .sort(natural ? (a, b) => natural(a.value, b.value) : (a, b) => a.label.localeCompare(b.label));
}

// ── Period presets ───────────────────────────────────────────────────────────

export const PERIODS = [
  { value: "mtd", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "qtd", label: "This quarter" },
  { value: "last-quarter", label: "Last quarter" },
  { value: "fytd", label: "This FY" },
  { value: "last-fy", label: "Last FY" },
  { value: "last-90", label: "Last 90 days" },
  { value: "custom", label: "Custom" },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["value"];

/**
 * Resolve a period preset (or a custom from/to) against today's IST date into
 * inclusive day bounds, plus the equal-length window immediately before it.
 */
export function resolvePeriod(
  period: string | undefined,
  todayYmd: string,
  custom?: { from?: string; to?: string },
): { period: PeriodKey; from: string; to: string; prevFrom: string; prevTo: string } {
  const today = dayFromYmd(todayYmd);
  const y = Number(todayYmd.slice(0, 4));
  const m = Number(todayYmd.slice(5, 7)); // 1-12
  const ymd = (yy: number, mm: number, dd: number) => ymdFromDay(Math.floor(Date.UTC(yy, mm - 1, dd) / DAY_MS));
  const fyStartYear = m >= 4 ? y : y - 1;
  // FY quarters start Apr / Jul / Oct / Jan — always in the current calendar year.
  const qStartMonth = ((Math.floor(((m + 8) % 12) / 3) * 3 + 3) % 12) + 1;

  let key = (PERIODS.some((p) => p.value === period) ? period : "fytd") as PeriodKey;
  let from: string;
  let to: string = todayYmd;
  const valid = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

  switch (key) {
    case "mtd":
      from = ymd(y, m, 1);
      break;
    case "last-month":
      from = ymd(y, m - 1, 1);
      to = ymd(y, m, 0);
      break;
    case "qtd":
      from = ymd(y, qStartMonth, 1);
      break;
    case "last-quarter":
      from = ymd(y, qStartMonth - 3, 1);
      to = ymdFromDay(dayFromYmd(ymd(y, qStartMonth, 1)) - 1);
      break;
    case "last-fy":
      from = ymd(fyStartYear - 1, 4, 1);
      to = ymd(fyStartYear, 3, 31);
      break;
    case "last-90":
      from = ymdFromDay(today - 89);
      break;
    case "custom":
      if (valid(custom?.from) && valid(custom?.to) && custom!.from! <= custom!.to!) {
        from = custom!.from!;
        to = custom!.to!;
      } else {
        key = "fytd";
        from = ymd(fyStartYear, 4, 1);
      }
      break;
    case "fytd":
    default:
      from = ymd(fyStartYear, 4, 1);
  }

  const len = dayFromYmd(to) - dayFromYmd(from) + 1;
  const prevTo = ymdFromDay(dayFromYmd(from) - 1);
  const prevFrom = ymdFromDay(dayFromYmd(from) - len);
  return { period: key, from, to, prevFrom, prevTo };
}
