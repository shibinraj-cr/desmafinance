import { describe, expect, it } from "vitest";
import {
  FACT_COLLECTION,
  FACT_ENROLLMENT,
  FACT_LEAD,
  NOT_APPLICABLE,
  OTHER_KEY,
  STORED_DIMS,
  dayFromYmd,
  decodeFact,
  encodeFact,
  measureValue,
  pivot,
  resolvePeriod,
  timeBucket,
  type Dicts,
  type Fact,
  type StoredDim,
} from "@/lib/sales-analysis";

const dicts = Object.fromEntries(STORED_DIMS.map((d) => [d, [] as string[]])) as Dicts;
dicts.source = ["Meta", "Website", "Referral"];
dicts.bde = ["A", "B"];
dicts.paymentMode = ["UPI", "Bank"];

function fact(kind: Fact["kind"], ymd: string, set: Partial<Record<StoredDim, number>>, n: { weight?: number; booked?: number; amount?: number } = {}): Fact {
  const dims = STORED_DIMS.map((d) => set[d] ?? -1);
  return { kind, day: dayFromYmd(ymd), dims, weight: n.weight ?? 0, booked: n.booked ?? 0, amount: n.amount ?? 0 };
}

const range = { from: dayFromYmd("2026-09-01"), to: dayFromYmd("2026-09-30") };
const prevRange = { from: dayFromYmd("2026-08-02"), to: dayFromYmd("2026-08-31") };

const facts: Fact[] = [
  fact(FACT_ENROLLMENT, "2026-09-03", { source: 0, bde: 0 }, { weight: 1, booked: 100_000 }),
  fact(FACT_ENROLLMENT, "2026-09-10", { source: 0, bde: 1 }, { weight: 2, booked: 300_000 }),
  fact(FACT_ENROLLMENT, "2026-09-12", { source: 1, bde: 1 }, { weight: 1, booked: 50_000 }),
  fact(FACT_ENROLLMENT, "2026-08-20", { source: 0, bde: 0 }, { weight: 1, booked: 80_000 }), // previous period
  fact(FACT_COLLECTION, "2026-09-05", { source: 0, bde: 0, paymentMode: 0 }, { amount: 40_000 }),
  fact(FACT_COLLECTION, "2026-09-06", { source: 1, bde: 1, paymentMode: 1 }, { amount: 10_000 }),
  ...Array.from({ length: 10 }, () => fact(FACT_LEAD, "2026-09-02", { source: 0, bde: 0 })),
  ...Array.from({ length: 5 }, () => fact(FACT_LEAD, "2026-09-02", { source: 1, bde: 1 })),
  fact(FACT_ENROLLMENT, "2026-10-01", { source: 0, bde: 0 }, { weight: 1, booked: 999 }), // outside both windows
];

describe("encode/decode", () => {
  it("round-trips a fact", () => {
    const f = facts[1];
    expect(decodeFact(encodeFact(f))).toEqual(f);
  });
});

describe("pivot", () => {
  it("totals every measure over the current window only", () => {
    const p = pivot({ facts, dicts, rowDim: "source", filters: {}, range, prevRange, sortBy: "enrollments" });
    expect(p.total.enrollments).toBe(3);
    expect(p.total.weighted).toBe(4);
    expect(p.total.booked).toBe(450_000);
    expect(p.total.collected).toBe(50_000);
    expect(p.total.leads).toBe(15);
    expect(measureValue(p.total, "conversion")).toBeCloseTo(20);
    expect(measureValue(p.total, "avgTicket")).toBe(150_000);
    expect(p.prevTotal.enrollments).toBe(1);
  });

  it("groups by source, sorted by the measure, with previous-period values", () => {
    const p = pivot({ facts, dicts, rowDim: "source", filters: {}, range, prevRange, sortBy: "booked" });
    expect(p.rows.map((r) => r.label)).toEqual(["Meta", "Website"]);
    expect(p.rows[0].acc.enrollments).toBe(2);
    expect(measureValue(p.rows[0].acc, "conversion")).toBeCloseTo(20); // 2 of 10
    expect(p.rows[0].prev.booked).toBe(80_000);
  });

  it("puts facts that cannot know a dimension under Not applicable", () => {
    const p = pivot({ facts, dicts, rowDim: "paymentMode", filters: {}, range, prevRange, sortBy: "collected" });
    const na = p.rows.find((r) => r.key === NOT_APPLICABLE)!;
    expect(na.acc.enrollments).toBe(3);
    expect(na.acc.collected).toBe(0);
    expect(p.rows.find((r) => r.label === "UPI")!.acc.collected).toBe(40_000);
  });

  it("applies filters to every fact type", () => {
    const p = pivot({ facts, dicts, rowDim: "bde", filters: { source: ["1"] }, range, prevRange, sortBy: "enrollments" });
    expect(p.total.enrollments).toBe(1);
    expect(p.total.leads).toBe(5);
    expect(p.total.collected).toBe(10_000);
  });

  it("splits into a cross-tab whose cells add up to the row", () => {
    const p = pivot({ facts, dicts, rowDim: "bde", colDim: "source", filters: {}, range, prevRange, sortBy: "enrollments" });
    const b = p.rows.find((r) => r.label === "B")!;
    expect(b.cells["0"].enrollments + b.cells["1"].enrollments).toBe(b.acc.enrollments);
    expect(p.columns.map((c) => c.label)).toEqual(["Meta", "Website"]);
  });

  it("folds rows past topN into Other", () => {
    const p = pivot({ facts, dicts, rowDim: "source", filters: {}, range, prevRange, sortBy: "leads", topN: 1 });
    expect(p.rows).toHaveLength(1);
    expect(p.other?.key).toBe(OTHER_KEY);
    expect(p.other?.acc.leads).toBe(5);
  });

  it("orders time dimensions chronologically", () => {
    const p = pivot({ facts, dicts, rowDim: "week", filters: {}, range, prevRange, sortBy: "booked" });
    const keys = p.rows.map((r) => r.key);
    expect(keys).toEqual([...keys].sort());
  });
});

describe("timeBucket", () => {
  it("uses Sat–Fri weeks and Indian FY quarters", () => {
    expect(timeBucket("week", dayFromYmd("2026-10-09")).key).toBe("2026-10-03");
    expect(timeBucket("quarter", dayFromYmd("2027-02-10")).label).toBe("Q4 FY26-27");
    expect(timeBucket("quarter", dayFromYmd("2026-04-01")).label).toBe("Q1 FY26-27");
  });
});

describe("resolvePeriod", () => {
  const today = "2026-10-06";
  it("this month + equal-length previous window", () => {
    expect(resolvePeriod("mtd", today)).toEqual({ period: "mtd", from: "2026-10-01", to: "2026-10-06", prevFrom: "2026-09-25", prevTo: "2026-09-30" });
  });
  it("quarters follow the Indian FY", () => {
    expect(resolvePeriod("qtd", today).from).toBe("2026-10-01");
    const lq = resolvePeriod("last-quarter", today);
    expect([lq.from, lq.to]).toEqual(["2026-07-01", "2026-09-30"]);
    const jan = resolvePeriod("last-quarter", "2027-01-15");
    expect([jan.from, jan.to]).toEqual(["2026-10-01", "2026-12-31"]);
  });
  it("FY presets", () => {
    expect(resolvePeriod("fytd", today).from).toBe("2026-04-01");
    const lfy = resolvePeriod("last-fy", today);
    expect([lfy.from, lfy.to]).toEqual(["2025-04-01", "2026-03-31"]);
  });
  it("custom falls back to FY to date when invalid", () => {
    expect(resolvePeriod("custom", today, { from: "2026-09-10", to: "2026-09-01" }).period).toBe("fytd");
    expect(resolvePeriod("custom", today, { from: "2026-09-01", to: "2026-09-10" }).to).toBe("2026-09-10");
  });
});
