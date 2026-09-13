import { annualisedContribution } from "./wealth-reminders";
import type { DueBucket, WealthFrequency } from "./wealth-reminders";

/**
 * The Personal Wealth desk's shapes and arithmetic.
 *
 * Deliberately free of Prisma and node:crypto so the page's client components
 * can import it: lib/wealth.ts holds everything that touches the database or a
 * key, and re-exports this file for server callers. Keeping the split explicit
 * is what stops a `node:crypto` import being dragged into the browser bundle.
 */

export type AssetClassKey =
  | "equity"
  | "gold"
  | "cash"
  | "lending"
  | "insurance"
  | "savings"
  | "protection"
  | "other";

/**
 * Series colours are a validated categorical palette — checked for the
 * lightness band, chroma floor, colour-vision separation and contrast against
 * a white card. Assigned per class and fixed: a filter that removes a class
 * must never repaint the survivors.
 *
 * `countsToCorpus: false` marks cover-only rows (a term policy protects, it is
 * not savings), which are shown separately and never inflate net worth.
 */
export const ASSET_CLASS_META: Record<
  AssetClassKey,
  { label: string; color: string; order: number; countsToCorpus: boolean }
> = {
  equity: { label: "Equity & Mutual Funds", color: "#2563EB", order: 1, countsToCorpus: true },
  gold: { label: "Gold", color: "#A16207", order: 2, countsToCorpus: true },
  cash: { label: "Cash & Bank", color: "#0E8A6E", order: 3, countsToCorpus: true },
  lending: { label: "Lending & Receivables", color: "#9333EA", order: 4, countsToCorpus: true },
  insurance: { label: "Insurance-linked", color: "#C2410C", order: 5, countsToCorpus: true },
  savings: { label: "Small Savings", color: "#0891B2", order: 6, countsToCorpus: true },
  other: { label: "Uncategorised", color: "#6B6862", order: 7, countsToCorpus: true },
  protection: { label: "Protection (cover only)", color: "#4A4744", order: 8, countsToCorpus: false },
};

/** The classes a holding can be filed under, in display order. Gold is derived
 *  from the vault rather than entered as a holding, so it is not selectable. */
export const SELECTABLE_ASSET_CLASSES: AssetClassKey[] = (
  Object.keys(ASSET_CLASS_META) as AssetClassKey[]
)
  .filter((k) => k !== "gold")
  .sort((a, b) => ASSET_CLASS_META[a].order - ASSET_CLASS_META[b].order);

export const LIABILITY_KINDS = ["housing", "car", "gold", "personal", "business", "other"] as const;
export type LiabilityKind = (typeof LIABILITY_KINDS)[number];

export const LIABILITY_KIND_LABEL: Record<LiabilityKind, string> = {
  housing: "Housing loan",
  car: "Vehicle loan",
  gold: "Gold loan",
  personal: "Personal loan",
  business: "Business loan",
  other: "Other borrowing",
};

/** How stale a valuation has to be before the page nags about it. */
export const STALE_AFTER_MONTHS = 6;

// ---------------------------------------------------------------------------
// Shapes handed to the client
// ---------------------------------------------------------------------------

export type HoldingRow = {
  id: string;
  name: string;
  assetClass: AssetClassKey;
  scope: "personal" | "business";
  holderLabel: string;
  institution: string | null;
  policyNo: string | null;
  investedAmount: number | null;
  contributionAmount: number | null;
  frequency: WealthFrequency;
  dueDayOfMonth: number | null;
  renewalOn: string | null;
  termYears: number | null;
  sumAssured: number | null;
  reminderLeadDays: number;
  portalUrl: string | null;
  portalUsername: string | null;
  /** Whether a password is stored — never the password itself. */
  hasSecret: boolean;
  notes: string | null;
  /** Latest valuation, 0 when never valued. */
  value: number;
  valuedOn: string | null;
  /** Whole months since the valuation; null when never valued. */
  valuationAgeMonths: number | null;
  isStale: boolean;
  nextDueOn: string | null;
};

export type GoldItemRow = {
  id: string;
  category: string;
  name: string;
  grams: number;
  holderLabel: string;
  purityKarat: number | null;
  dueOn: string | null;
  notes: string | null;
  value: number;
};

export type LiabilityRow = {
  id: string;
  name: string;
  kind: LiabilityKind;
  scope: "personal" | "business";
  lender: string | null;
  principal: number | null;
  outstanding: number;
  interestRate: number | null;
  emiAmount: number | null;
  emiDayOfMonth: number | null;
  startedOn: string | null;
  tenureMonths: number | null;
  notes: string | null;
  isClosed: boolean;
  /** Fields the page needs before it can show payoff maths. */
  missingFields: string[];
};

export type ReminderRow = {
  id: string;
  label: string;
  kind: string;
  dueOn: string;
  amount: number | null;
  status: string;
  paidOn: string | null;
  holdingId: string | null;
  liabilityId: string | null;
  leadDays: number;
  bucket: DueBucket;
  daysUntil: number;
};

export type AllocationSlice = {
  key: AssetClassKey;
  label: string;
  color: string;
  value: number;
  share: number;
};

export type WealthTotals = {
  corpus: number;
  goldValue: number;
  assets: number;
  liabilities: number;
  netWorth: number;
  debtToAssetPct: number | null;
  /** Cover from protection policies — reported, never added to assets. */
  protectionCover: number;
  /** Cover minus what is owed. Negative means a gap. */
  protectionGap: number;
  annualCommitment: number;
  /** Recurring holdings whose contribution amount has not been captured. */
  commitmentUnknownCount: number;
  dueNext90Days: number;
  dueNext90Count: number;
  overdueCount: number;
  overdueAmount: number;
  staleCount: number;
  staleValue: number;
  staleOldestMonths: number | null;
};

export type WealthSnapshot = {
  today: string;
  holdings: HoldingRow[];
  gold: {
    items: GoldItemRow[];
    totalGrams: number;
    ratePerGram: number;
    rateAsOn: string | null;
    value: number;
    byCategory: { category: string; grams: number; value: number }[];
  };
  liabilities: LiabilityRow[];
  reminders: ReminderRow[];
  settings: {
    goldRatePerGram: number;
    goldRateAsOn: string | null;
    hideBusinessScope: boolean;
    remindersEnabled: boolean;
  };
  totals: WealthTotals;
  allocation: AllocationSlice[];
  /** Whether WEALTH_SECRET_KEY is configured, so the UI can hide the password
   *  field rather than pretend it will be stored safely. */
  secretVaultConfigured: boolean;
  isEmpty: boolean;
};

// ---------------------------------------------------------------------------
// Pure derivation — unit-tested without a database
// ---------------------------------------------------------------------------

/** Whole months between two calendar dates, rounded down. */
export function monthsBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months;
}

export function computeAllocation(
  holdings: readonly Pick<HoldingRow, "assetClass" | "value">[],
  goldValue: number,
): AllocationSlice[] {
  const byClass = new Map<AssetClassKey, number>();
  for (const h of holdings) {
    if (!ASSET_CLASS_META[h.assetClass]?.countsToCorpus) continue;
    byClass.set(h.assetClass, (byClass.get(h.assetClass) ?? 0) + h.value);
  }
  if (goldValue > 0) byClass.set("gold", (byClass.get("gold") ?? 0) + goldValue);

  const total = [...byClass.values()].reduce((a, b) => a + b, 0);
  return [...byClass.entries()]
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({
      key,
      label: ASSET_CLASS_META[key].label,
      color: ASSET_CLASS_META[key].color,
      value,
      share: total > 0 ? value / total : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

export function computeTotals(args: {
  holdings: readonly HoldingRow[];
  goldValue: number;
  liabilities: readonly LiabilityRow[];
  reminders: readonly ReminderRow[];
  today: string;
}): WealthTotals {
  const { holdings, goldValue, liabilities, reminders, today } = args;

  const corpus = holdings
    .filter((h) => ASSET_CLASS_META[h.assetClass]?.countsToCorpus)
    .reduce((s, h) => s + h.value, 0);

  const protectionCover = holdings.reduce((s, h) => s + (h.sumAssured ?? 0), 0);
  const assets = corpus + goldValue;
  const liabTotal = liabilities.filter((l) => !l.isClosed).reduce((s, l) => s + l.outstanding, 0);

  let annual = 0;
  let unknown = 0;
  for (const h of holdings) {
    const recurring = h.frequency !== "none" && h.frequency !== "one_time";
    if (!recurring) continue;
    if (h.contributionAmount == null || h.contributionAmount <= 0) unknown += 1;
    else annual += annualisedContribution(h.contributionAmount, h.frequency);
  }
  // EMIs are a commitment too, even though they are not an investment.
  for (const l of liabilities) {
    if (l.isClosed) continue;
    if (l.emiAmount && l.emiAmount > 0) annual += l.emiAmount * 12;
  }

  const horizon = addDaysKey(today, 90);
  const open = reminders.filter((r) => r.status === "open");
  const inWindow = open.filter((r) => r.dueOn <= horizon);
  const overdue = open.filter((r) => r.bucket === "overdue");

  const stale = holdings.filter((h) => h.isStale);
  const oldest = stale.reduce<number | null>(
    (m, h) =>
      h.valuationAgeMonths != null && (m === null || h.valuationAgeMonths > m)
        ? h.valuationAgeMonths
        : m,
    null,
  );

  return {
    corpus,
    goldValue,
    assets,
    liabilities: liabTotal,
    netWorth: assets - liabTotal,
    debtToAssetPct: assets > 0 ? (liabTotal / assets) * 100 : null,
    protectionCover,
    protectionGap: protectionCover - liabTotal,
    annualCommitment: annual,
    commitmentUnknownCount: unknown,
    dueNext90Days: inWindow.reduce((s, r) => s + (r.amount ?? 0), 0),
    dueNext90Count: inWindow.length,
    overdueCount: overdue.length,
    overdueAmount: overdue.reduce((s, r) => s + (r.amount ?? 0), 0),
    staleCount: stale.length,
    staleValue: stale.reduce((s, h) => s + h.value, 0),
    staleOldestMonths: oldest,
  };
}

function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** Which loan fields are still missing before payoff maths can be shown. */
export function missingLiabilityFields(l: {
  lender: string | null;
  interestRate: number | null;
  emiAmount: number | null;
  tenureMonths: number | null;
}): string[] {
  const out: string[] = [];
  if (!l.lender) out.push("lender");
  if (l.interestRate == null) out.push("interest rate");
  if (l.emiAmount == null) out.push("EMI");
  if (l.tenureMonths == null) out.push("tenure");
  return out;
}

// ---------------------------------------------------------------------------
// Chart series
// ---------------------------------------------------------------------------

export type OutflowMonth = {
  key: string;
  label: string;
  total: number;
  count: number;
  /** A month carrying a renewal on top of the usual instalments. */
  heavy: boolean;
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Committed outflow month by month, starting with the current month.
 *
 * Only open reminders count — something already paid is not still promised.
 * A month is "heavy" when it carries at least one renewal-sized item, which is
 * what turns the chart from a record into a warning.
 */
export function outflowByMonth(
  reminders: readonly ReminderRow[],
  today: string,
  months = 12,
  heavyThreshold = 400_000,
): OutflowMonth[] {
  const [y0, m0] = today.split("-").map(Number);
  const out: OutflowMonth[] = [];
  const index = new Map<string, OutflowMonth>();

  for (let i = 0; i < months; i++) {
    const total = y0 * 12 + (m0 - 1) + i;
    const y = Math.floor(total / 12);
    const m = total % 12;
    const key = `${y}-${String(m + 1).padStart(2, "0")}`;
    const row: OutflowMonth = {
      key,
      label: `${MONTH_SHORT[m]}${m === 0 || i === 0 ? ` ${String(y).slice(-2)}` : ""}`,
      total: 0,
      count: 0,
      heavy: false,
    };
    out.push(row);
    index.set(key, row);
  }

  for (const r of reminders) {
    if (r.status !== "open") continue;
    const row = index.get(r.dueOn.slice(0, 7));
    if (!row) continue;
    row.total += r.amount ?? 0;
    row.count += 1;
    if ((r.amount ?? 0) >= heavyThreshold) row.heavy = true;
  }

  return out;
}

export type BridgeStep = { label: string; value: number; kind: "add" | "sub" | "total" };

/**
 * The net-worth bridge: what is owned, then what is owed against it, then the
 * difference. Liabilities are grouped by kind so a pair of car loans reads as
 * one bar — five separate slivers would say less, not more.
 */
export function bridgeSteps(
  totals: WealthTotals,
  liabilities: readonly LiabilityRow[],
): BridgeStep[] {
  const steps: BridgeStep[] = [];
  if (totals.corpus > 0) steps.push({ label: "Invested", value: totals.corpus, kind: "add" });
  if (totals.goldValue > 0) steps.push({ label: "Gold", value: totals.goldValue, kind: "add" });

  const byKind = new Map<LiabilityKind, number>();
  for (const l of liabilities) {
    if (l.isClosed || l.outstanding <= 0) continue;
    byKind.set(l.kind, (byKind.get(l.kind) ?? 0) + l.outstanding);
  }
  for (const [kind, amount] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    steps.push({ label: LIABILITY_KIND_LABEL[kind].replace(" loan", ""), value: -amount, kind: "sub" });
  }

  if (steps.length > 0) steps.push({ label: "Net worth", value: totals.netWorth, kind: "total" });
  return steps;
}
