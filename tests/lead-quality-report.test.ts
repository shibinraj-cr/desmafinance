import { describe, expect, it } from "vitest";
import {
  FACT_ENROLLMENT,
  FACT_LEAD,
  STORED_DIMS,
  dayFromYmd,
  pivot,
  type Dicts,
  type Fact,
  type StoredDim,
} from "@/lib/sales-analysis";
import { QUALITY_BUCKET_ORDER, qualityBucketLabel, type QualityBucket } from "@/lib/crm-lead-quality";
import {
  badShare,
  enrolRate,
  qualityByGroup,
  qualityTotals,
  ratedCount,
  ratedOnTimeShare,
  ratingBias,
  ratingShare,
  reasonBreakdown,
} from "@/lib/lead-quality-report";

const dicts = Object.fromEntries(STORED_DIMS.map((d) => [d, [] as string[]])) as Dicts;
dicts.source = ["Meta", "Website"];
dicts.bde = ["A", "B"];
dicts.quality = QUALITY_BUCKET_ORDER.map(qualityBucketLabel);
dicts.qualityReason = ["Wrong / invalid number", "Not eligible"];
dicts.leadOutcome = ["Open", "Enrolled", "Lost"];

const q = (b: QualityBucket) => dicts.quality.indexOf(qualityBucketLabel(b));
const OPEN = 0;
const ENROLLED = 1;

function leadFact(ymd: string, set: Partial<Record<StoredDim, number>>): Fact {
  const dims = STORED_DIMS.map((d) => set[d] ?? -1);
  return { kind: FACT_LEAD, day: dayFromYmd(ymd), dims, weight: 0, booked: 0, amount: 0 };
}

const range = { from: dayFromYmd("2026-10-01"), to: dayFromYmd("2026-10-31") };
const repeat = (count: number, f: () => Fact) => Array.from({ length: count }, f);

// Meta: 4 Good (2 enrolled), 1 Average, 5 Junk (wrong number), 2 overdue.
// Website: 2 Good (1 enrolled), 1 Poor (not eligible), 1 pending, 3 exempt.
const facts: Fact[] = [
  ...repeat(2, () => leadFact("2026-10-05", { source: 0, bde: 0, quality: q("good"), leadOutcome: ENROLLED })),
  ...repeat(2, () => leadFact("2026-10-05", { source: 0, bde: 0, quality: q("good"), leadOutcome: OPEN })),
  leadFact("2026-10-06", { source: 0, bde: 0, quality: q("average"), leadOutcome: OPEN }),
  ...repeat(5, () => leadFact("2026-10-07", { source: 0, bde: 1, quality: q("junk"), qualityReason: 0, leadOutcome: OPEN })),
  ...repeat(2, () => leadFact("2026-10-08", { source: 0, bde: 1, quality: q("overdue"), leadOutcome: OPEN })),
  leadFact("2026-10-09", { source: 1, bde: 0, quality: q("good"), leadOutcome: ENROLLED }),
  leadFact("2026-10-09", { source: 1, bde: 0, quality: q("good"), leadOutcome: OPEN }),
  leadFact("2026-10-10", { source: 1, bde: 1, quality: q("poor"), qualityReason: 1, leadOutcome: OPEN }),
  leadFact("2026-10-20", { source: 1, bde: 1, quality: q("pending"), leadOutcome: OPEN }),
  ...repeat(3, () => leadFact("2026-10-11", { source: 1, quality: q("exempt"), leadOutcome: OPEN })),
  // Outside the range, and not a lead: both ignored.
  leadFact("2026-09-30", { source: 0, quality: q("junk"), qualityReason: 0, leadOutcome: OPEN }),
  { kind: FACT_ENROLLMENT, day: dayFromYmd("2026-10-05"), dims: STORED_DIMS.map(() => -1), weight: 1, booked: 1, amount: 0 },
];

describe("qualityTotals", () => {
  const t = qualityTotals(facts, dicts, { range, filters: {} });

  it("counts every lead created in range, and only leads", () => {
    expect(t.leads).toBe(19);
    expect(t.byBucket).toMatchObject({ good: 6, average: 1, poor: 1, junk: 5, overdue: 2, pending: 1, exempt: 3 });
  });

  it("takes rating shares out of RATED leads, not all leads", () => {
    expect(ratedCount(t)).toBe(13);
    expect(ratingShare(t, "good")).toBeCloseTo((6 / 13) * 100);
    expect(badShare(t)).toBeCloseTo((6 / 13) * 100);
  });

  it("measures on-time rating against leads that were due: rated ÷ (rated + overdue)", () => {
    expect(ratedOnTimeShare(t)).toBeCloseTo((13 / 15) * 100);
  });

  it("tracks enrolment per rating — the check that the ratings mean something", () => {
    expect(t.enrolled).toBe(3);
    expect(enrolRate(t, "good")).toBeCloseTo(50);
    expect(enrolRate(t, "junk")).toBe(0);
    expect(enrolRate(t, "overdue")).toBe(0);
  });

  it("honours the page filters", () => {
    const website = qualityTotals(facts, dicts, { range, filters: { source: ["1"] } });
    expect(website.leads).toBe(7);
    expect(website.byBucket.good).toBe(2);
  });
});

describe("qualityByGroup", () => {
  it("cuts the mix by any dimension, busiest group first", () => {
    const rows = qualityByGroup(facts, dicts, { range, filters: {}, dim: "source" });
    expect(rows.map((r) => r.label)).toEqual(["Meta", "Website"]);
    expect(rows[0].counts.byBucket.junk).toBe(5);
    expect(badShare(rows[0].counts)).toBeCloseTo((5 / 10) * 100);
  });

  it("keeps calendar order on a time dimension", () => {
    const rows = qualityByGroup(facts, dicts, { range, filters: {}, dim: "week" });
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual([...keys].sort());
  });
});

describe("reasonBreakdown", () => {
  it("lists why Poor and Junk leads were bad, most common first", () => {
    expect(reasonBreakdown(facts, dicts, { range, filters: {} })).toEqual([
      { label: "Wrong / invalid number", poor: 0, junk: 5, total: 5 },
      { label: "Not eligible", poor: 1, junk: 0, total: 1 },
    ]);
  });
});

describe("ratingBias", () => {
  const team = qualityTotals(facts, dicts, { range, filters: {} });
  const counts = (good: number, junk: number) => {
    const c = qualityTotals([], dicts, { range, filters: {} });
    c.byBucket.good = good;
    c.byBucket.junk = junk;
    c.leads = good + junk;
    return c;
  };

  it("flags a BDE whose bad-lead rate is far off the team's", () => {
    // Team bad share ≈ 46%; this BDE marks everything Junk.
    expect(ratingBias(counts(0, 12), team)).toBeGreaterThan(0);
    expect(ratingBias(counts(12, 0), team)).toBeLessThan(0);
  });

  it("stays quiet when the gap is small or there are too few ratings to judge", () => {
    expect(ratingBias(counts(6, 5), team)).toBeNull();
    expect(ratingBias(counts(0, 9), team)).toBeNull();
  });
});

describe("Sales Analysis pivot", () => {
  it("orders the quality dimension Good → Junk → unrated, not by size", () => {
    const p = pivot({
      facts,
      dicts,
      rowDim: "quality",
      filters: {},
      range,
      prevRange: { from: dayFromYmd("2026-09-01"), to: dayFromYmd("2026-09-30") },
      sortBy: "leads",
    });
    expect(p.rows.map((r) => r.label)).toEqual([
      "Good",
      "Average",
      "Poor",
      "Junk",
      "Not rated (overdue)",
      "Not rated (not yet due)",
      "Not rated (not required)",
      "Not applicable",
    ]);
  });
});
