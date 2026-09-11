import { describe, it, expect } from "vitest";
import {
  COMMIT_RATE,
  LEDGER_FROM,
  deriveSalesObjective,
  fiscalQuarter,
  fyLabel,
  monthLabelFromKey,
  type Archive,
  type LedgerMonth,
} from "../src/lib/sales-objective";

// The figures here are synthetic, and deliberately so: the real ones live in
// SalesObjectiveArchive (see prisma/seed-sales-objective-archive.ts) because
// this repo is public. What is under test is the chain rule and the provenance
// split, and round numbers exercise both far more legibly. The model was
// separately reconciled against the workbook's own ratio columns before this
// shipped, and agreed to six decimals on every quarter.
//
// The shape below is chosen so every derived figure is exact:
//
//   FY 25-26  Q1  100k x3 =  300k   no target (nothing before it to double)
//             Q2  200k x3 =  600k   stretch  600k -> committed  420k
//             Q3  300k x3 =  900k   stretch 1.2m -> committed  840k
//             Q4  400k x3 = 1.20m   stretch 1.8m -> committed 1.26m
//   FY 26-27  Q1  500k x3 = 1.50m   stretch 2.4m -> committed 1.68m   (ledger)
//             Q2  600k, 600k, open  stretch 3.0m -> committed 2.10m   (ledger)
const ARCHIVE_MONTHS: Record<string, number> = {
  "2025-04": 100_000, "2025-05": 100_000, "2025-06": 100_000,
  "2025-07": 200_000, "2025-08": 200_000, "2025-09": 200_000,
  "2025-10": 300_000, "2025-11": 300_000, "2025-12": 300_000,
  "2026-01": 400_000, "2026-02": 400_000, "2026-03": 400_000,
  // From LEDGER_FROM on these are the OPTIONAL reconciliation reference — the
  // default seed stops before them, which `preLedgerArchive()` reproduces.
  "2026-04": 500_000, "2026-05": 500_000, "2026-06": 500_000,
  "2026-07": 600_000, "2026-08": 600_000,
};

const LIVE_KEYS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];

/** 10 Sep 2026 — mid-quarter, with Jul and Aug closed and Sep still open. */
const AS_OF = new Date(Date.UTC(2026, 8, 10));

/** Everything, including the overlap — what `--with-reference` loads. */
const archive = (): Archive => new Map(Object.entries(ARCHIVE_MONTHS));

/** What the DEFAULT seed loads: pre-ledger months only. */
const preLedgerArchive = (): Archive =>
  new Map(Object.entries(ARCHIVE_MONTHS).filter(([k]) => k < LEDGER_FROM));

/** A ledger that agrees with the archive on every live month. */
function agreeingLedger(keys: string[] = LIVE_KEYS): Map<string, LedgerMonth> {
  return new Map(keys.map((k) => [k, { total: ARCHIVE_MONTHS[k], count: 3 }]));
}

const build = (
  a: Archive = archive(),
  l: Map<string, LedgerMonth> = agreeingLedger(),
) => deriveSalesObjective(a, l, AS_OF);

describe("fiscal helpers", () => {
  it("puts Jan-Mar in Q4 of the fiscal year that started the previous April", () => {
    expect(fiscalQuarter(4)).toBe(1);
    expect(fiscalQuarter(9)).toBe(2);
    expect(fiscalQuarter(12)).toBe(3);
    expect(fiscalQuarter(1)).toBe(4);
    expect(fyLabel(2026)).toBe("FY 26-27");
  });

  it("labels months the way the rest of the app does", () => {
    expect(monthLabelFromKey("2026-04")).toBe("Apr-26");
    expect(monthLabelFromKey("2025-12")).toBe("Dec-25");
  });
});

describe("the chain rule", () => {
  const o = build();
  const q = (id: string) => o.quarters.find((x) => x.id === id)!;

  it("runs from the oldest archived month to the end of the current quarter", () => {
    expect(o.months[0].key).toBe("2025-04");
    expect(o.months[o.months.length - 1].key).toBe("2026-09");
    expect(o.quarters[o.quarters.length - 1].id).toBe("2026-Q2");
    expect(o.archiveEmpty).toBe(false);
  });

  it("sets no target for the first quarter — there is nothing to double", () => {
    expect(q("2025-Q1").collected).toBe(300_000);
    expect(q("2025-Q1").stretch).toBeNull();
    expect(q("2025-Q1").committed).toBeNull();
    expect(q("2025-Q1").achievement).toBeNull();
    expect(q("2025-Q1").months.every((m) => m.target === null)).toBe(true);
  });

  it("targets each quarter at 2x the previous close, committed at 70%", () => {
    expect(q("2025-Q2").stretch).toBe(600_000);
    expect(q("2025-Q2").committed).toBeCloseTo(420_000, 6);
    expect(q("2025-Q2").monthlyTarget).toBeCloseTo(140_000, 6);
    expect(q("2025-Q3").stretch).toBe(1_200_000);
    expect(q("2025-Q4").stretch).toBe(1_800_000);
    expect(q("2026-Q1").stretch).toBe(2_400_000);
  });

  it("re-targets everything downstream when an actual changes", () => {
    const bumped = archive();
    bumped.set("2025-06", 400_000); // Q1 closes at 600k instead of 300k
    const b = deriveSalesObjective(bumped, agreeingLedger(), AS_OF);
    const bq = (id: string) => b.quarters.find((x) => x.id === id)!;
    expect(bq("2025-Q2").stretch).toBe(1_200_000); // was 600k
    // Q3 is targeted off Q2's close, which did not move, so it does not either.
    expect(bq("2025-Q3").stretch).toBe(1_200_000);
  });

  it("scores a quarter against committed, and reports the stretch ratio too", () => {
    // 600k collected against a 420k committed target = 142.857…%, and against
    // the 600k stretch = 100%. The workbook calls the second one "% of Growth".
    expect(q("2025-Q2").achievement).toBeCloseTo(600_000 / 420_000, 10);
    expect(q("2025-Q2").vsStretch).toBeCloseTo(1, 10);
    expect(q("2025-Q2").surplus).toBeCloseTo(180_000, 6);
  });

  it("splits the committed target evenly across the quarter's months", () => {
    const m = (k: string) => o.months.find((x) => x.key === k)!;
    expect(m("2025-10").target).toBeCloseTo(280_000, 6);
    expect(m("2025-10").achievement).toBeCloseTo(300_000 / 280_000, 10);
    expect(m("2025-10").gap).toBeCloseTo(-20_000, 6); // negative = over target
    expect(m("2026-01").target).toBeCloseTo(420_000, 6);
    expect(m("2026-01").gap).toBeCloseTo(20_000, 6); // positive = short
  });

  it("does not let an open quarter set the next quarter's target", () => {
    const open = q("2026-Q2");
    expect(open.complete).toBe(false);
    // Q2 is targeted off Q1's close, which did happen.
    expect(open.stretch).toBe(3_000_000);
    // …but nothing after it exists yet, and its own bar is only provisional.
    expect(o.quarters.find((x) => x.id === "2026-Q3")).toBeUndefined();
    expect(o.nextStretchProvisional).toBe(open.collected * 2);
  });

  it("scores the last CLOSED quarter, not the running one", () => {
    expect(o.current?.id).toBe("2026-Q2");
    expect(o.lastClosed?.id).toBe("2026-Q1");
    expect(o.lastClosed?.achievement).toBeCloseTo(1_500_000 / 1_680_000, 10);
  });

  it("computes what the running quarter still owes, over real days", () => {
    // Jul + Aug landed, Sep is open and empty. 21 days left on 10 Sep.
    expect(o.current?.collected).toBe(1_200_000);
    expect(o.daysLeftInQuarter).toBe(21);
    expect(o.currentShortfall).toBeCloseTo(2_100_000 - 1_200_000, 6);
  });

  it("counts the days left across the rest of a quarter, not just this month", () => {
    // 10 Jul 2026: 22 left in Jul + 31 in Aug + 30 in Sep.
    const july = deriveSalesObjective(archive(), agreeingLedger(), new Date(Date.UTC(2026, 6, 10)));
    expect(july.daysLeftInQuarter).toBe(22 + 31 + 30);
  });

  it("compares rolling twelves that both end on a closed month", () => {
    // Sep-25 → Aug-26 against Sep-24 → Aug-25 (only partly covered by the
    // fixture, which is the point: months with no record contribute nothing).
    expect(o.rolling12).toBe(5_000_000);
    expect(o.prior12).toBe(700_000);
  });

  it("compares this FY to date against the same months last year", () => {
    expect(o.fyToDate).toBe(2_700_000);
    expect(o.fyPriorSamePeriod).toBe(700_000);
    expect(o.fyGrowthPct).toBeCloseTo((2_700_000 / 700_000 - 1) * 100, 6);
  });
});

describe("provenance", () => {
  it("serves months before the ledger from the archive", () => {
    const o = build();
    const mar = o.months.find((m) => m.key === "2026-03")!;
    expect(mar.key < LEDGER_FROM).toBe(true);
    expect(mar.source).toBe("archive");
    expect(mar.collected).toBe(400_000);
    expect(mar.deviation).toBeNull();
  });

  it("takes the ledger over the archive from LEDGER_FROM, and says by how much", () => {
    const l = agreeingLedger();
    l.set("2026-07", { total: 603_000, count: 12 }); // archive says 600k
    const o = deriveSalesObjective(archive(), l, AS_OF);
    const jul = o.months.find((m) => m.key === "2026-07")!;
    expect(jul.source).toBe("ledger");
    expect(jul.collected).toBe(603_000);
    expect(jul.deviation).toBe(3_000);
    expect(jul.deviationPct).toBeCloseTo(0.005, 10);
    expect(jul.needsReview).toBe(false); // 0.5% — inside tolerance
    expect(o.reviewCount).toBe(0);
  });

  it("flags a month that has drifted past tolerance, and still uses it", () => {
    const l = agreeingLedger();
    l.set("2026-07", { total: 540_000, count: 12 }); // −10% on the archive
    const o = deriveSalesObjective(archive(), l, AS_OF);
    const jul = o.months.find((m) => m.key === "2026-07")!;
    expect(jul.needsReview).toBe(true);
    expect(o.reviewCount).toBe(1);
    expect(jul.collected).toBe(540_000);
    // The quarter total moves with it — the ledger is the record.
    expect(o.current?.collected).toBe(540_000 + 600_000);
  });

  it("falls back to the archive when a past live month has no rows at all", () => {
    const o = deriveSalesObjective(
      archive(),
      agreeingLedger(["2026-04", "2026-05", "2026-06", "2026-08"]),
      AS_OF,
    );
    const jul = o.months.find((m) => m.key === "2026-07")!;
    expect(jul.source).toBe("archive");
    expect(jul.archiveFallback).toBe(true);
    expect(jul.collected).toBe(600_000);
    // A stand-in is not a disagreement, so it doesn't raise the banner.
    expect(jul.needsReview).toBe(false);
    expect(o.reviewCount).toBe(0);
  });

  it("shows a real zero for the running month rather than the archive's figure", () => {
    const a = archive();
    a.set("2026-09", 700_000); // a forecast someone typed into the sheet
    const o = deriveSalesObjective(a, agreeingLedger(), AS_OF);
    const sep = o.months.find((m) => m.key === "2026-09")!;
    expect(sep.running).toBe(true);
    expect(sep.source).toBe("ledger");
    expect(sep.collected).toBe(0);
    expect(sep.deviation).toBeNull(); // an open month is never reconciled
  });

  it("counts a month with posted rows summing to zero as a real zero", () => {
    const l = agreeingLedger();
    l.set("2026-07", { total: 0, count: 4 });
    const o = deriveSalesObjective(archive(), l, AS_OF);
    const jul = o.months.find((m) => m.key === "2026-07")!;
    expect(jul.source).toBe("ledger");
    expect(jul.collected).toBe(0);
    expect(jul.archiveFallback).toBe(false);
    expect(jul.needsReview).toBe(true);
  });

  it("renders the live band alone when the archive has never been seeded", () => {
    const o = deriveSalesObjective(new Map(), agreeingLedger(), AS_OF);
    expect(o.archiveEmpty).toBe(true);
    expect(o.months[0].key).toBe(LEDGER_FROM);
    // The first quarter has nothing before it to double, so it carries no
    // target — but once it closes off the ledger it targets the one after it,
    // and the page starts working on its own without the archive.
    expect(o.quarters[0].committed).toBeNull();
    expect(o.quarters[1].committed).toBeCloseTo(1_500_000 * 2 * COMMIT_RATE, 6);
    expect(o.reviewCount).toBe(0);
  });

  it("survives the ledger being empty — the archive half still renders", () => {
    const o = deriveSalesObjective(archive(), new Map(), AS_OF);
    expect(o.months.find((m) => m.key === "2025-12")!.collected).toBe(300_000);
    expect(o.quarters.find((q) => q.id === "2025-Q4")!.achievement).toBeCloseTo(
      1_200_000 / 1_260_000,
      10,
    );
    // Every past live month falls back, and none of them is a "disagreement".
    expect(o.months.filter((m) => m.archiveFallback).length).toBe(5);
    expect(o.reviewCount).toBe(0);
  });
});

describe("the default seed — archive stops where the ledger starts", () => {
  const o = deriveSalesObjective(preLedgerArchive(), agreeingLedger(), AS_OF);

  it("still covers the full series: archive history, then the ledger", () => {
    expect(o.months[0].key).toBe("2025-04");
    expect(o.months[o.months.length - 1].key).toBe("2026-09");
    expect(o.months.find((m) => m.key === "2026-03")!.source).toBe("archive");
    expect(o.months.find((m) => m.key === "2026-04")!.source).toBe("ledger");
    expect(o.archiveEmpty).toBe(false);
  });

  it("targets every quarter exactly as the overlapping archive does", () => {
    const withOverlap = build();
    expect(o.quarters.map((q) => q.committed)).toEqual(
      withOverlap.quarters.map((q) => q.committed),
    );
    expect(o.quarters.map((q) => q.collected)).toEqual(
      withOverlap.quarters.map((q) => q.collected),
    );
  });

  it("has nothing to reconcile, so the vs-sheet column is switched off", () => {
    expect(o.hasReference).toBe(false);
    expect(o.reviewCount).toBe(0);
    expect(o.months.filter((m) => m.deviation !== null)).toEqual([]);
    expect(o.months.every((m) => m.key < LEDGER_FROM || m.sheet === null)).toBe(true);
  });

  it("leaves a past live month with no rows blank instead of inventing one", () => {
    // With no workbook figure to stand in, there is nothing honest to show —
    // and quietly borrowing the sheet's number is exactly what we don't want.
    const gapped = deriveSalesObjective(
      preLedgerArchive(),
      agreeingLedger(["2026-04", "2026-05", "2026-06", "2026-08"]),
      AS_OF,
    );
    const jul = gapped.months.find((m) => m.key === "2026-07")!;
    expect(jul.source).toBe("pending");
    expect(jul.collected).toBeNull();
    expect(jul.archiveFallback).toBe(false);
    expect(jul.achievement).toBeNull();
  });
});

describe("--with-reference — the overlap is loaded", () => {
  it("turns the reconciliation on", () => {
    expect(build().hasReference).toBe(true);
  });
});

describe("the committed rate", () => {
  it("is the 70% the workbook holds the business to", () => {
    expect(COMMIT_RATE).toBe(0.7);
  });
});
