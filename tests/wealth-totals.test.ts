import { describe, it, expect } from "vitest";
import {
  ASSET_CLASS_META,
  computeAllocation,
  computeTotals,
  bridgeSteps,
  missingLiabilityFields,
  monthsBetween,
  outflowByMonth,
  type HoldingRow,
  type LiabilityRow,
  type ReminderRow,
} from "../src/lib/wealth-model";

// Synthetic, round figures — the real ones live in the database and this repo
// is public. What is under test is the arithmetic: what counts toward net
// worth, what is only cover, and how the due/stale bands are drawn.

function holding(over: Partial<HoldingRow> = {}): HoldingRow {
  return {
    id: "h",
    name: "A holding",
    assetClass: "equity",
    scope: "personal",
    holderLabel: "Self",
    institution: null,
    policyNo: null,
    investedAmount: null,
    contributionAmount: null,
    frequency: "none",
    dueDayOfMonth: null,
    renewalOn: null,
    termYears: null,
    sumAssured: null,
    reminderLeadDays: 7,
    portalUrl: null,
    portalUsername: null,
    hasSecret: false,
    notes: null,
    value: 0,
    valuedOn: null,
    valuationAgeMonths: null,
    isStale: false,
    nextDueOn: null,
    ...over,
  };
}

function liability(over: Partial<LiabilityRow> = {}): LiabilityRow {
  return {
    id: "l",
    name: "A loan",
    kind: "housing",
    scope: "personal",
    lender: null,
    principal: null,
    outstanding: 0,
    interestRate: null,
    emiAmount: null,
    emiDayOfMonth: null,
    startedOn: null,
    tenureMonths: null,
    notes: null,
    isClosed: false,
    missingFields: [],
    ...over,
  };
}

function reminder(over: Partial<ReminderRow> = {}): ReminderRow {
  return {
    id: "r",
    label: "Something due",
    kind: "sip",
    dueOn: "2026-10-01",
    amount: null,
    status: "open",
    paidOn: null,
    holdingId: null,
    liabilityId: null,
    leadDays: 7,
    bucket: "upcoming",
    daysUntil: 18,
    ...over,
  };
}

const TODAY = "2026-09-13";

describe("monthsBetween", () => {
  it("counts whole months only", () => {
    expect(monthsBetween("2026-03-31", "2026-09-13")).toBe(5);
    expect(monthsBetween("2026-09-13", "2026-09-13")).toBe(0);
    expect(monthsBetween("2024-12-20", "2026-09-13")).toBe(20);
  });

  it("does not round a part-month up", () => {
    expect(monthsBetween("2026-08-20", "2026-09-13")).toBe(0);
    expect(monthsBetween("2026-08-13", "2026-09-13")).toBe(1);
  });
});

describe("computeTotals", () => {
  it("builds net worth from corpus plus gold less open liabilities", () => {
    const totals = computeTotals({
      holdings: [holding({ value: 1_000_000 }), holding({ id: "h2", assetClass: "cash", value: 500_000 })],
      goldValue: 300_000,
      liabilities: [liability({ outstanding: 400_000 })],
      reminders: [],
      today: TODAY,
    });
    expect(totals.corpus).toBe(1_500_000);
    expect(totals.assets).toBe(1_800_000);
    expect(totals.liabilities).toBe(400_000);
    expect(totals.netWorth).toBe(1_400_000);
    expect(totals.debtToAssetPct).toBeCloseTo(22.222, 3);
  });

  it("excludes a closed loan from what is owed", () => {
    const totals = computeTotals({
      holdings: [holding({ value: 1_000_000 })],
      goldValue: 0,
      liabilities: [liability({ outstanding: 400_000 }), liability({ id: "l2", outstanding: 0, isClosed: true })],
      reminders: [],
      today: TODAY,
    });
    expect(totals.liabilities).toBe(400_000);
    expect(totals.netWorth).toBe(600_000);
  });

  it("reports protection as cover, never as corpus", () => {
    const totals = computeTotals({
      holdings: [
        holding({ value: 1_000_000 }),
        holding({ id: "term", assetClass: "protection", value: 0, sumAssured: 10_000_000 }),
      ],
      goldValue: 0,
      liabilities: [liability({ outstanding: 12_000_000 })],
      reminders: [],
      today: TODAY,
    });
    expect(ASSET_CLASS_META.protection.countsToCorpus).toBe(false);
    expect(totals.corpus).toBe(1_000_000);
    expect(totals.protectionCover).toBe(10_000_000);
    // Cover is 2,000,000 short of the debt — the number the page warns on.
    expect(totals.protectionGap).toBe(-2_000_000);
  });

  it("annualises every recurring commitment onto one year, EMIs included", () => {
    const totals = computeTotals({
      holdings: [
        holding({ id: "sip", frequency: "monthly", contributionAmount: 10_000 }),
        holding({ id: "ulip", frequency: "yearly", contributionAmount: 100_000 }),
        holding({ id: "health", frequency: "three_yearly", contributionAmount: 30_000 }),
        holding({ id: "lump", frequency: "one_time", contributionAmount: 500_000 }),
      ],
      goldValue: 0,
      liabilities: [liability({ outstanding: 100_000, emiAmount: 5_000 })],
      reminders: [],
      today: TODAY,
    });
    // 120,000 + 100,000 + 10,000 + 60,000 of EMI; the one-time 500,000 counts
    // for nothing because it does not repeat.
    expect(totals.annualCommitment).toBe(290_000);
  });

  it("counts recurring holdings whose amount was never captured", () => {
    const totals = computeTotals({
      holdings: [
        holding({ id: "known", frequency: "monthly", contributionAmount: 10_000 }),
        holding({ id: "blank", frequency: "monthly", contributionAmount: null }),
        holding({ id: "zero", frequency: "yearly", contributionAmount: 0 }),
      ],
      goldValue: 0,
      liabilities: [],
      reminders: [],
      today: TODAY,
    });
    expect(totals.annualCommitment).toBe(120_000);
    expect(totals.commitmentUnknownCount).toBe(2);
  });

  it("sums what falls due inside ninety days and what is already overdue", () => {
    const totals = computeTotals({
      holdings: [],
      goldValue: 0,
      liabilities: [],
      reminders: [
        reminder({ id: "late", dueOn: "2026-08-30", amount: 50_000, bucket: "overdue" }),
        reminder({ id: "soon", dueOn: "2026-09-20", amount: 25_000, bucket: "due_soon" }),
        reminder({ id: "in90", dueOn: "2026-12-01", amount: 100_000 }),
        reminder({ id: "beyond", dueOn: "2026-12-31", amount: 999_000 }),
        reminder({ id: "noamount", dueOn: "2026-10-01", amount: null }),
        reminder({ id: "paid", dueOn: "2026-09-05", amount: 77_000, status: "paid", bucket: "overdue" }),
      ],
      today: TODAY,
    });
    // 90 days from 13 Sep 2026 is 12 Dec, so the 31 Dec row is outside.
    expect(totals.dueNext90Days).toBe(175_000);
    expect(totals.dueNext90Count).toBe(4);
    // A settled reminder is neither due nor overdue.
    expect(totals.overdueCount).toBe(1);
    expect(totals.overdueAmount).toBe(50_000);
  });

  it("summarises stale valuations and names the oldest", () => {
    const totals = computeTotals({
      holdings: [
        holding({ id: "fresh", value: 100, valuationAgeMonths: 2, isStale: false }),
        holding({ id: "old", value: 500_000, valuationAgeMonths: 21, isStale: true }),
        holding({ id: "older", value: 250_000, valuationAgeMonths: 19, isStale: true }),
      ],
      goldValue: 0,
      liabilities: [],
      reminders: [],
      today: TODAY,
    });
    expect(totals.staleCount).toBe(2);
    expect(totals.staleValue).toBe(750_000);
    expect(totals.staleOldestMonths).toBe(21);
  });

  it("leaves debt-to-asset undefined rather than dividing by zero", () => {
    const totals = computeTotals({
      holdings: [],
      goldValue: 0,
      liabilities: [liability({ outstanding: 100_000 })],
      reminders: [],
      today: TODAY,
    });
    expect(totals.debtToAssetPct).toBeNull();
    expect(totals.netWorth).toBe(-100_000);
  });
});

describe("computeAllocation", () => {
  it("shares out by class, largest first, with gold as its own slice", () => {
    const slices = computeAllocation(
      [
        { assetClass: "equity", value: 600_000 },
        { assetClass: "cash", value: 100_000 },
        { assetClass: "equity", value: 200_000 },
      ],
      100_000,
    );
    expect(slices.map((s) => s.key)).toEqual(["equity", "cash", "gold"]);
    expect(slices[0].value).toBe(800_000);
    expect(slices[0].share).toBeCloseTo(0.8, 6);
    expect(slices.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 6);
  });

  it("keeps cover-only policies out of the allocation", () => {
    const slices = computeAllocation(
      [
        { assetClass: "equity", value: 100_000 },
        { assetClass: "protection", value: 0 },
      ],
      0,
    );
    expect(slices).toHaveLength(1);
    expect(slices[0].key).toBe("equity");
  });

  it("drops empty classes and survives an empty desk", () => {
    expect(computeAllocation([{ assetClass: "cash", value: 0 }], 0)).toEqual([]);
    expect(computeAllocation([], 0)).toEqual([]);
  });

  it("gives each class a fixed colour that does not depend on rank", () => {
    const a = computeAllocation([{ assetClass: "equity", value: 10 }], 0);
    const b = computeAllocation(
      [
        { assetClass: "cash", value: 1000 },
        { assetClass: "equity", value: 10 },
      ],
      0,
    );
    const equityIn = (slices: ReturnType<typeof computeAllocation>) =>
      slices.find((s) => s.key === "equity")!.color;
    expect(equityIn(a)).toBe(equityIn(b));
  });
});

describe("missingLiabilityFields", () => {
  it("names every field payoff maths still needs", () => {
    expect(
      missingLiabilityFields({ lender: null, interestRate: null, emiAmount: null, tenureMonths: null }),
    ).toEqual(["lender", "interest rate", "EMI", "tenure"]);
  });

  it("is empty once the loan is fully described", () => {
    expect(
      missingLiabilityFields({ lender: "A bank", interestRate: 8.5, emiAmount: 50_000, tenureMonths: 240 }),
    ).toEqual([]);
  });

  it("treats a zero rate as captured, not missing", () => {
    expect(
      missingLiabilityFields({ lender: "A bank", interestRate: 0, emiAmount: 0, tenureMonths: 0 }),
    ).toEqual([]);
  });
});

describe("outflowByMonth", () => {
  const today = "2026-09-13";

  it("starts at the current month and runs for the requested span", () => {
    const months = outflowByMonth([], today, 4);
    expect(months.map((m) => m.key)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12"]);
  });

  it("sums open reminders into their month and counts them", () => {
    const months = outflowByMonth(
      [
        reminder({ id: "a", dueOn: "2026-10-02", amount: 100_000 }),
        reminder({ id: "b", dueOn: "2026-10-20", amount: 25_000 }),
        reminder({ id: "c", dueOn: "2026-11-02", amount: 100_000 }),
      ],
      today,
      3,
    );
    expect(months[1].total).toBe(125_000);
    expect(months[1].count).toBe(2);
    expect(months[2].total).toBe(100_000);
  });

  it("leaves settled reminders out — a paid instalment is no longer promised", () => {
    const months = outflowByMonth(
      [
        reminder({ id: "paid", dueOn: "2026-10-02", amount: 100_000, status: "paid" }),
        reminder({ id: "skip", dueOn: "2026-10-03", amount: 50_000, status: "skipped" }),
        reminder({ id: "open", dueOn: "2026-10-04", amount: 10_000 }),
      ],
      today,
      2,
    );
    expect(months[1].total).toBe(10_000);
    expect(months[1].count).toBe(1);
  });

  it("flags a month carrying a renewal-sized item", () => {
    const months = outflowByMonth(
      [
        reminder({ id: "sip", dueOn: "2026-09-20", amount: 28_500 }),
        reminder({ id: "renewal", dueOn: "2026-10-10", amount: 450_000 }),
      ],
      today,
      2,
    );
    expect(months[0].heavy).toBe(false);
    expect(months[1].heavy).toBe(true);
  });

  it("counts an item whose amount was never captured without inflating the total", () => {
    const months = outflowByMonth([reminder({ id: "x", dueOn: "2026-09-20", amount: null })], today, 1);
    expect(months[0].count).toBe(1);
    expect(months[0].total).toBe(0);
  });

  it("ignores reminders outside the window", () => {
    const months = outflowByMonth([reminder({ id: "far", dueOn: "2028-01-01", amount: 10_000 })], today, 3);
    expect(months.every((m) => m.total === 0)).toBe(true);
  });
});

describe("bridgeSteps", () => {
  const totals = (over: Partial<ReturnType<typeof computeTotals>> = {}) =>
    ({
      corpus: 1_000_000,
      goldValue: 300_000,
      assets: 1_300_000,
      liabilities: 400_000,
      netWorth: 900_000,
      debtToAssetPct: 30.77,
      protectionCover: 0,
      protectionGap: 0,
      annualCommitment: 0,
      commitmentUnknownCount: 0,
      dueNext90Days: 0,
      dueNext90Count: 0,
      overdueCount: 0,
      overdueAmount: 0,
      staleCount: 0,
      staleValue: 0,
      staleOldestMonths: null,
      ...over,
    }) as ReturnType<typeof computeTotals>;

  it("adds assets, subtracts borrowings, then lands on net worth", () => {
    const steps = bridgeSteps(totals(), [liability({ outstanding: 400_000, kind: "housing" })]);
    expect(steps.map((s) => s.kind)).toEqual(["add", "add", "sub", "total"]);
    expect(steps[2].value).toBe(-400_000);
    expect(steps[3].value).toBe(900_000);
  });

  it("groups loans of the same kind into one bar", () => {
    const steps = bridgeSteps(totals({ liabilities: 640_000, netWorth: 660_000 }), [
      liability({ id: "car1", kind: "car", outstanding: 560_000 }),
      liability({ id: "car2", kind: "car", outstanding: 80_000 }),
    ]);
    const subs = steps.filter((s) => s.kind === "sub");
    expect(subs).toHaveLength(1);
    expect(subs[0].value).toBe(-640_000);
  });

  it("leaves out closed and zero borrowings", () => {
    const steps = bridgeSteps(totals({ liabilities: 0, netWorth: 1_300_000 }), [
      liability({ id: "closed", outstanding: 0, isClosed: true }),
      liability({ id: "zero", kind: "gold", outstanding: 0 }),
    ]);
    expect(steps.filter((s) => s.kind === "sub")).toHaveLength(0);
  });

  it("returns nothing at all for an empty desk, rather than a lone zero bar", () => {
    expect(bridgeSteps(totals({ corpus: 0, goldValue: 0, assets: 0, netWorth: 0 }), [])).toEqual([]);
  });
});
