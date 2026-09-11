// Sales Objective — the DESMA collection target model.
//
// One rule drives the whole thing: a quarter's STRETCH target is twice the
// previous quarter's actual collection, and the business commits to 70% of
// that stretch. The committed target is split evenly across the quarter's
// three months. Every target on the page is recomputed from that chain — none
// of them are copied out of the workbook, so a corrected actual re-targets
// every quarter after it automatically.
//
// PROVENANCE. DesGro's finance ledger only starts at Apr 2026 (FY 2026-27 is
// the first year the module ran), so the series is split at LEDGER_FROM:
//
//   before it         frozen archive, read from SalesObjectiveArchive — the
//                     workbook's figures, loaded by
//                     prisma/seed-sales-objective-archive.ts. Never recomputes.
//                     It lives in the database and NOT in this file on purpose:
//                     the repo is public and these are real collections.
//   Apr-26 → today    live: summed off Transaction rows the same way the CEO
//                     Dashboard's revenue tile sums them, so the two screens
//                     cannot disagree.
//
// The archive normally stops where the ledger starts, so the two never overlap
// and there is nothing to reconcile. The seed can optionally load the overlap
// months as a REFERENCE (--with-reference), and then: the LEDGER STILL WINS —
// that is the whole point of putting this on DesGro — but a small disagreement
// is adopted silently while anything past DEVIATION_TOLERANCE is flagged for
// Finance, because at that size it usually means the sheet netted something off
// (the workbook's own formulas do exactly that on at least one month).

import { prisma } from "./prisma";

/** Share of the 2x stretch target the business is actually held to. */
export const COMMIT_RATE = 0.7;

/** First month DesGro's own ledger is authoritative for. */
export const LEDGER_FROM = "2026-04";

/** Ledger-vs-sheet gap past this share raises a review flag. */
export const DEVIATION_TOLERANCE = 0.02;

/**
 * The archive, as the model wants it: collection by "YYYY-MM".
 *
 * Rows before LEDGER_FROM are the only record of those months and are shown
 * as-is — that is the whole archive under the default seed. Rows from
 * LEDGER_FROM on are optional, and are purely the reconciliation reference the
 * ledger gets checked against; the ledger still supplies the displayed figure.
 */
export type Archive = Map<string, number>;

export type MonthSource = "archive" | "ledger" | "pending";

export type ObjectiveMonth = {
  /** "2026-04" */
  key: string;
  /** "Apr-26" */
  label: string;
  /** "FY 26-27" */
  fy: string;
  /** Fiscal quarter, 1 = Apr-Jun. */
  q: number;
  quarterId: string;
  collected: number | null;
  /** Committed target for this month = quarter committed / 3. */
  target: number | null;
  /** collected / target. */
  achievement: number | null;
  /** target - collected. Positive = short of target. */
  gap: number | null;
  source: MonthSource;
  /** The month the clock is currently in — a partial figure, never scored. */
  running: boolean;
  /** Workbook figure, where one exists. */
  sheet: number | null;
  /** ledger - sheet, for months where both exist. */
  deviation: number | null;
  deviationPct: number | null;
  /** Deviation past tolerance — Finance should look at this row. */
  needsReview: boolean;
  /**
   * A past month inside the ledger band that carries no Revenue rows at all.
   * The sheet figure stands in so the page isn't full of holes, but the row is
   * called out — an empty month is far more likely to be un-posted data than a
   * month nobody collected anything in.
   */
  archiveFallback: boolean;
};

export type ObjectiveQuarter = {
  /** "2026-Q2" — fiscal year start year + fiscal quarter. */
  id: string;
  /** "Q2 FY 26-27" */
  label: string;
  /** "Q2 26-27" */
  short: string;
  fy: string;
  q: number;
  months: ObjectiveMonth[];
  collected: number;
  /** Every month in the quarter has landed. */
  complete: boolean;
  /** Any month in the quarter is served from the ledger. */
  live: boolean;
  /** 2 x the previous quarter's collection. Null until that quarter closes. */
  stretch: number | null;
  /** COMMIT_RATE of stretch — the target the business is held to. */
  committed: number | null;
  /** committed / 3. */
  monthlyTarget: number | null;
  /** collected / committed. */
  achievement: number | null;
  /** collected / stretch — what the workbook mislabels "% of Growth". */
  vsStretch: number | null;
  /** collected - committed. Negative = short. */
  surplus: number | null;
};

export type SalesObjective = {
  months: ObjectiveMonth[];
  quarters: ObjectiveQuarter[];
  /** Fiscal years present, oldest first. */
  fyList: string[];
  /** The quarter the clock is in. */
  current: ObjectiveQuarter | null;
  /** Most recent quarter that closed with a target to score against. */
  lastClosed: ObjectiveQuarter | null;
  /** What the running quarter still has to collect to close at committed. */
  currentShortfall: number | null;
  /** Days left in the running quarter, today included. */
  daysLeftInQuarter: number;
  /** 2 x the running quarter SO FAR — where the next bar is heading. */
  nextStretchProvisional: number | null;
  rolling12: number;
  prior12: number;
  rolling12GrowthPct: number | null;
  fyToDate: number;
  fyPriorSamePeriod: number;
  fyGrowthPct: number | null;
  reviewCount: number;
  /** No archive rows at all — the seed hasn't been run on this database. */
  archiveEmpty: boolean;
  /**
   * The archive carries workbook figures for months the ledger also covers, so
   * there is something to reconcile. False under the default seed, which stops
   * where the ledger starts — and then the "vs sheet" column has nothing to say
   * and is not rendered.
   */
  hasReference: boolean;
  asOf: Date;
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Fiscal year an Apr-Mar year belongs to: Jan-Mar belong to the previous. */
function fyStartYear(year: number, month1: number): number {
  return month1 >= 4 ? year : year - 1;
}

export function fyLabel(startYear: number): string {
  return `FY ${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;
}

/** Fiscal quarter: 1 = Apr-Jun, 4 = Jan-Mar. */
export function fiscalQuarter(month1: number): number {
  if (month1 >= 4 && month1 <= 6) return 1;
  if (month1 >= 7 && month1 <= 9) return 2;
  if (month1 >= 10) return 3;
  return 4;
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabelFromKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]}-${String(y).slice(2)}`;
}

function parseKey(key: string): { y: number; m: number } {
  const [y, m] = key.split("-").map(Number);
  return { y, m };
}

/** The month before `key`. Used to name where the archive stops. */
export function previousMonthKey(key: string): string {
  return addMonths(key, -1);
}

function addMonths(key: string, n: number): string {
  const { y, m } = parseKey(key);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Inclusive list of month keys from `from` to `to`. */
function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to; k = addMonths(k, 1)) out.push(k);
  return out;
}

/** Last month of the fiscal quarter `key` sits in. */
function quarterEndKey(key: string): string {
  const { y, m } = parseKey(key);
  const q = fiscalQuarter(m);
  // Q4 is Jan-Mar, so its closing month sits in the same calendar year as any
  // of its months — no year roll needed for any quarter.
  const endMonth = [6, 9, 12, 3][q - 1];
  return `${y}-${String(endMonth).padStart(2, "0")}`;
}

/** One month's ledger read: what it summed to and how many rows it summed. */
export type LedgerMonth = { total: number; count: number };

/**
 * The whole model, with no database in it — every derivation lives here so it
 * can be exercised directly.
 *
 * @param archive Workbook collection by month key. Its earliest row is where
 *                the series starts; with no rows the page is live-band only.
 * @param ledger  Revenue totals by month key, for LEDGER_FROM onward only.
 * @param asOf    "Now". The running month and quarter are read off this.
 */
export function deriveSalesObjective(
  archive: Archive,
  ledger: Map<string, LedgerMonth>,
  asOf: Date,
): SalesObjective {
  const nowKey = monthKey(asOf);
  // The series starts at the oldest month anyone has a figure for. An unseeded
  // database still renders — it just starts where the ledger does.
  const archiveKeys = [...archive.keys()].sort();
  const seriesFrom =
    archiveKeys.length && archiveKeys[0] < LEDGER_FROM ? archiveKeys[0] : LEDGER_FROM;
  // The series runs to the end of the quarter we're standing in. Beyond that
  // there is nothing honest to draw: the next quarter's target is 2x a quarter
  // that hasn't closed, so it isn't set yet.
  const months: ObjectiveMonth[] = monthRange(seriesFrom, quarterEndKey(nowKey)).map(
    (key) => {
      const { y, m } = parseKey(key);
      const sheet = archive.get(key) ?? null;
      const inLedgerBand = key >= LEDGER_FROM;
      const read = inLedgerBand ? ledger.get(key) : undefined;
      const running = key === nowKey;

      let collected: number | null;
      let source: MonthSource;
      let archiveFallback = false;

      if (!inLedgerBand) {
        collected = sheet;
        source = "archive";
      } else if (key > nowKey) {
        collected = null;
        source = "pending";
      } else if (read && read.count > 0) {
        collected = read.total;
        source = "ledger";
      } else if (running) {
        // The month is open and nothing has been posted yet. That is a real
        // zero, not a hole — showing the sheet's figure here would invent
        // collection that hasn't happened.
        collected = read ? read.total : 0;
        source = "ledger";
      } else if (sheet !== null) {
        collected = sheet;
        source = "archive";
        archiveFallback = true;
      } else {
        collected = null;
        source = "pending";
      }

      const deviation =
        source === "ledger" && !running && sheet !== null && collected !== null
          ? collected - sheet
          : null;
      const deviationPct = deviation !== null && sheet ? deviation / sheet : null;

      return {
        key,
        label: monthLabelFromKey(key),
        fy: fyLabel(fyStartYear(y, m)),
        q: fiscalQuarter(m),
        quarterId: `${fyStartYear(y, m)}-Q${fiscalQuarter(m)}`,
        collected,
        target: null,
        achievement: null,
        gap: null,
        source,
        running,
        sheet,
        deviation,
        deviationPct,
        needsReview:
          deviationPct !== null && Math.abs(deviationPct) > DEVIATION_TOLERANCE,
        archiveFallback,
      };
    },
  );

  // Group into fiscal quarters, then walk them in order applying the chain
  // rule. An open quarter sets no target for the next one — you cannot double
  // a number that isn't final.
  const quarters: ObjectiveQuarter[] = [];
  const byId = new Map<string, ObjectiveQuarter>();
  for (const mo of months) {
    let q = byId.get(mo.quarterId);
    if (!q) {
      q = {
        id: mo.quarterId,
        label: `Q${mo.q} ${mo.fy}`,
        short: `Q${mo.q} ${mo.fy.slice(3)}`,
        fy: mo.fy,
        q: mo.q,
        months: [],
        collected: 0,
        complete: false,
        live: false,
        stretch: null,
        committed: null,
        monthlyTarget: null,
        achievement: null,
        vsStretch: null,
        surplus: null,
      };
      byId.set(q.id, q);
      quarters.push(q);
    }
    q.months.push(mo);
  }

  let previousClose: number | null = null;
  for (const q of quarters) {
    q.collected = q.months.reduce((s, m) => s + (m.collected ?? 0), 0);
    q.complete = q.months.length === 3 && q.months.every((m) => m.collected !== null && !m.running);
    q.live = q.months.some((m) => m.source === "ledger");
    q.stretch = previousClose === null ? null : previousClose * 2;
    q.committed = q.stretch === null ? null : q.stretch * COMMIT_RATE;
    q.monthlyTarget = q.committed === null ? null : q.committed / 3;
    q.achievement = q.committed ? q.collected / q.committed : null;
    q.vsStretch = q.stretch ? q.collected / q.stretch : null;
    q.surplus = q.committed === null ? null : q.collected - q.committed;

    for (const m of q.months) {
      m.target = q.monthlyTarget;
      m.achievement =
        m.collected !== null && q.monthlyTarget ? m.collected / q.monthlyTarget : null;
      m.gap = m.collected !== null && q.monthlyTarget ? q.monthlyTarget - m.collected : null;
    }

    if (q.complete) previousClose = q.collected;
  }

  const current = quarters.find((q) => q.months.some((m) => m.running)) ?? null;
  const closed = quarters.filter((q) => q.complete && q.committed !== null);
  const lastClosed = closed.length ? closed[closed.length - 1] : null;

  const sumBetween = (from: string, to: string) =>
    months
      .filter((m) => m.key >= from && m.key <= to)
      .reduce((s, m) => s + (m.collected ?? 0), 0);

  // Rolling twelve, ending with the last CLOSED month — the running month is a
  // partial and would drag the comparison down for no reason.
  const lastClosedMonth = addMonths(nowKey, -1);
  const rolling12 = sumBetween(addMonths(lastClosedMonth, -11), lastClosedMonth);
  const prior12 = sumBetween(addMonths(lastClosedMonth, -23), addMonths(lastClosedMonth, -12));

  const { y, m } = parseKey(nowKey);
  const fyStart = `${fyStartYear(y, m)}-04`;
  const fyToDate = sumBetween(fyStart, lastClosedMonth);
  const fyPriorSamePeriod = sumBetween(addMonths(fyStart, -12), addMonths(lastClosedMonth, -12));

  const daysInQuarter = (() => {
    const endKey = quarterEndKey(nowKey);
    const { y: ey, m: em } = parseKey(endKey);
    const lastDay = new Date(Date.UTC(ey, em, 0)).getUTCDate();
    const today = asOf.getUTCDate();
    const monthsLeft = (ey * 12 + em) - (y * 12 + m);
    if (monthsLeft === 0) return Math.max(0, lastDay - today + 1);
    // Rest of this month, plus the whole months between, plus the closing month.
    const daysThisMonth = new Date(Date.UTC(y, m, 0)).getUTCDate() - today + 1;
    let between = 0;
    for (let i = 1; i < monthsLeft; i++) {
      const k = parseKey(addMonths(nowKey, i));
      between += new Date(Date.UTC(k.y, k.m, 0)).getUTCDate();
    }
    return daysThisMonth + between + lastDay;
  })();

  return {
    months,
    quarters,
    fyList: [...new Set(months.map((mo) => mo.fy))],
    current,
    lastClosed,
    currentShortfall:
      current && current.committed !== null ? current.committed - current.collected : null,
    daysLeftInQuarter: daysInQuarter,
    nextStretchProvisional: current ? current.collected * 2 : null,
    rolling12,
    prior12,
    rolling12GrowthPct: prior12 > 0 ? (rolling12 / prior12 - 1) * 100 : null,
    fyToDate,
    fyPriorSamePeriod,
    fyGrowthPct: fyPriorSamePeriod > 0 ? (fyToDate / fyPriorSamePeriod - 1) * 100 : null,
    reviewCount: months.filter((mo) => mo.needsReview).length,
    archiveEmpty: archive.size === 0,
    hasReference: months.some((mo) => mo.key >= LEDGER_FROM && mo.sheet !== null),
    asOf,
  };
}

/**
 * Read the ledger band off Transaction and build the model.
 *
 * Same filter the CEO Dashboard uses for revenue — `type = "Revenue"`, not
 * soft-deleted, bucketed by transaction date. Bucketing on `date` rather than
 * the denormalised `month` label keeps this correct even if a row's label was
 * written for a different period than its date.
 */
export async function getSalesObjective(asOf: Date = new Date()): Promise<SalesObjective> {
  const { y, m } = parseKey(LEDGER_FROM);
  const from = new Date(Date.UTC(y, m - 1, 1));

  let rows: Array<{ date: Date; amount: { toString(): string } }> = [];
  let archiveRows: Array<{ monthKey: string; collected: { toString(): string } }> = [];
  const [revenue, stored] = await Promise.allSettled([
    prisma.transaction.findMany({
      where: { deletedAt: null, type: "Revenue", date: { gte: from } },
      select: { date: true, amount: true },
    }),
    prisma.salesObjectiveArchive.findMany({
      select: { monthKey: true, collected: true },
    }),
  ]);
  // Either half is worth showing on its own, so a failure degrades that half
  // rather than blanking the page.
  if (revenue.status === "fulfilled") rows = revenue.value;
  else console.error("[sales-objective] revenue read failed", revenue.reason);
  if (stored.status === "fulfilled") archiveRows = stored.value;
  else console.error("[sales-objective] archive read failed", stored.reason);

  const archive: Archive = new Map(
    archiveRows.map((r) => [r.monthKey, Number(r.collected.toString())]),
  );

  const ledger = new Map<string, LedgerMonth>();
  for (const r of rows) {
    const key = monthKey(r.date);
    const cur = ledger.get(key) ?? { total: 0, count: 0 };
    cur.total += Number(r.amount.toString());
    cur.count += 1;
    ledger.set(key, cur);
  }

  return deriveSalesObjective(archive, ledger, asOf);
}
