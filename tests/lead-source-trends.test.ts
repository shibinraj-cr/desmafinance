import { describe, it, expect } from "vitest";

// lead-source-trends is pure — no prisma import, so no module mock is needed.
import { buildSourceTrends, pickSeries, MAX_SERIES, OTHER_KEY, type SourceDayFact } from "@/lib/lead-source-trends";

const TODAY = "2026-11-07";
const sources = [
  { id: "meta", label: "Meta", displayOrder: 1 },
  { id: "web", label: "Website", displayOrder: 2 },
  { id: "yt", label: "YouTube", displayOrder: 3 },
];

function build(received: SourceDayFact[], assigned: SourceDayFact[] = [], srcs = sources) {
  return buildSourceTrends({ today: TODAY, received, assigned, sources: srcs, days: 30, months: 12 });
}

describe("buildSourceTrends — windows", () => {
  it("gives 30 days ending today and 12 months ending this month, oldest first", () => {
    const t = build([]);
    expect(t.daily).toHaveLength(30);
    expect(t.daily[0].key).toBe("2026-10-09");
    expect(t.daily[29].key).toBe(TODAY);
    expect(t.monthly).toHaveLength(12);
    expect(t.monthly[0].key).toBe("2025-12");
    expect(t.monthly[11].key).toBe("2026-11");
  });

  it("marks only today and this month as partial", () => {
    const t = build([]);
    expect(t.daily.filter((p) => p.partial).map((p) => p.key)).toEqual([TODAY]);
    expect(t.monthly.filter((p) => p.partial).map((p) => p.key)).toEqual(["2026-11"]);
  });

  it("labels days with weekday and month", () => {
    const t = build([]);
    expect(t.daily[29].label).toBe("Sat, 7 Nov");
    expect(t.daily[29].short).toBe("7 Nov");
  });
});

describe("buildSourceTrends — bucketing", () => {
  it("puts each fact on its day and its month, per measure", () => {
    const t = build(
      [
        { day: "2026-11-07", sourceId: "meta", count: 4 },
        { day: "2026-11-01", sourceId: "web", count: 2 },
        { day: "2026-10-15", sourceId: "meta", count: 3 },
      ],
      [{ day: "2026-11-07", sourceId: "meta", count: 1 }],
    );
    const idx = (k: string) => t.series.findIndex((s) => s.key === k);
    const today = t.daily.find((p) => p.key === TODAY)!;
    expect(today.received[idx("meta")]).toBe(4);
    expect(today.assigned[idx("meta")]).toBe(1);
    const nov = t.monthly.find((p) => p.key === "2026-11")!;
    expect(nov.received[idx("meta")]).toBe(4);
    expect(nov.received[idx("web")]).toBe(2);
    const oct = t.monthly.find((p) => p.key === "2026-10")!;
    expect(oct.received[idx("meta")]).toBe(3);
  });

  it("a month always equals the sum of its days (inside the daily window)", () => {
    const facts: SourceDayFact[] = [];
    for (let d = 1; d <= 7; d++) facts.push({ day: `2026-11-0${d}`, sourceId: "meta", count: d });
    const t = build(facts);
    const dailySum = t.daily.filter((p) => p.key.startsWith("2026-11")).reduce((a, p) => a + p.received[0], 0);
    expect(dailySum).toBe(28);
    expect(t.monthly[11].received[0]).toBe(28);
  });

  it("keeps facts older than the daily window in the monthly view only", () => {
    const t = build([{ day: "2026-03-10", sourceId: "yt", count: 9 }]);
    const yt = t.series.findIndex((s) => s.key === "yt");
    expect(t.daily.every((p) => p.received[yt] === 0)).toBe(true);
    expect(t.monthly.find((p) => p.key === "2026-03")!.received[yt]).toBe(9);
  });

  it("ignores facts outside the window and after today", () => {
    const t = build([
      { day: "2025-11-30", sourceId: "meta", count: 50 },
      { day: "2026-11-08", sourceId: "meta", count: 50 },
    ]);
    expect(t.series).toEqual([]);
    expect(t.monthly.every((p) => p.received.length === 0)).toBe(true);
  });

  it("folds leads with no source, or an unknown source, into 'No source'", () => {
    const t = build([
      { day: TODAY, sourceId: null, count: 2 },
      { day: TODAY, sourceId: "ghost", count: 1 },
      { day: TODAY, sourceId: "meta", count: 5 },
    ]);
    expect(t.series.map((s) => s.label)).toEqual(["Meta", "No source"]);
    const other = t.series.findIndex((s) => s.key === OTHER_KEY);
    expect(t.daily[29].received[other]).toBe(3);
    expect(t.series[other].slot).toBeNull();
  });
});

describe("pickSeries", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, label: `S${i}`, displayOrder: i }));

  it("names every source with data when they fit, in display order with slots in that order", () => {
    const totals = new Map<string | null, { received: number; assigned: number }>([
      ["yt", { received: 1, assigned: 0 }],
      ["meta", { received: 9, assigned: 0 }],
      ["web", { received: 0, assigned: 0 }],
    ]);
    const s = pickSeries(totals, sources);
    expect(s.map((x) => [x.key, x.slot])).toEqual([
      ["meta", 0],
      ["yt", 1],
    ]);
  });

  it("past the colour budget keeps the biggest seven and folds the rest into Other", () => {
    const totals = new Map<string | null, { received: number; assigned: number }>(
      many.map((m, i) => [m.id, { received: i + 1, assigned: 0 }]),
    );
    const s = pickSeries(totals, many);
    expect(s).toHaveLength(MAX_SERIES);
    expect(s.slice(0, 7).map((x) => x.key)).toEqual(["s3", "s4", "s5", "s6", "s7", "s8", "s9"]);
    expect(s[7]).toEqual({ key: OTHER_KEY, label: "Other", slot: null });
  });

  it("ranks by received, then assigned, so an assigned-only source can still make the cut", () => {
    const totals = new Map<string | null, { received: number; assigned: number }>(
      many.map((m) => [m.id, { received: 0, assigned: m.id === "s0" ? 100 : 1 }]),
    );
    const s = pickSeries(totals, many);
    expect(s.map((x) => x.key)).toContain("s0");
  });

  it("counts a 'No source' bucket against the budget", () => {
    const eight = many.slice(0, 8);
    const totals = new Map<string | null, { received: number; assigned: number }>([
      ...eight.map((m) => [m.id, { received: 5, assigned: 0 }] as const),
      [null, { received: 1, assigned: 0 }],
    ]);
    const s = pickSeries(totals, eight);
    expect(s).toHaveLength(MAX_SERIES);
    expect(s[7].label).toBe("Other");
  });
});
