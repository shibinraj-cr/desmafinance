import { describe, expect, it } from "vitest";
import {
  classifyFormat,
  describe as describeCorr,
  lagScan,
  leadValue,
  parseIsoDuration,
  pearson,
  uploadLift,
  weekly,
  weeklyCorrelation,
  type InsightsDay,
  type InsightsVideo,
} from "@/lib/youtube/insights-shared";

function series(n: number, f: (i: number) => Partial<InsightsDay>, start = "2026-06-01"): InsightsDay[] {
  const out: InsightsDay[] = [];
  const d0 = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    const d = new Date(d0);
    d.setUTCDate(d.getUTCDate() + i);
    out.push({
      day: d.toISOString().slice(0, 10),
      views: 0,
      shortsViews: 0,
      videoViews: 0,
      subscribersNet: 0,
      shortsPublished: 0,
      videosPublished: 0,
      ytLeads: 0,
      voxbayLeads: 0,
      voxbayCallers: null,
      ...f(i),
    });
  }
  return out;
}

describe("parseIsoDuration / classifyFormat", () => {
  it("parses YouTube durations", () => {
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("PT1M5S")).toBe(65);
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("P1DT1M")).toBe(86460);
    expect(parseIsoDuration("garbage")).toBe(0);
  });
  it("treats ≤ 3 min as a Short and live streams as live", () => {
    expect(classifyFormat(59, false)).toBe("short");
    expect(classifyFormat(180, false)).toBe("short");
    expect(classifyFormat(181, false)).toBe("video");
    expect(classifyFormat(30, true)).toBe("live");
    expect(classifyFormat(0, false)).toBe("video");
  });
});

describe("pearson / describe", () => {
  it("is 1 for a perfect linear link and -1 for an inverse one", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
  });
  it("is null for constant input or too few points", () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pearson([1, 2], [1, 2])).toBeNull();
  });
  it("refuses to grade tiny samples", () => {
    expect(describeCorr(0.9, 5).strength).toBe("insufficient");
    expect(describeCorr(0.9, 30)).toMatchObject({ strength: "strong", significant: true });
    expect(describeCorr(0.2, 30)).toMatchObject({ strength: "weak", significant: false });
  });
});

describe("lagScan", () => {
  it("finds the delay at which leads echo views", () => {
    // Views are a pseudo-random pattern; leads repeat it exactly 2 days later.
    const views = Array.from({ length: 60 }, (_, i) => ((i * 37) % 11) * 100);
    const days = series(60, (i) => ({ views: views[i], ytLeads: i >= 2 ? views[i - 2] / 100 : 0 }));
    const { best, points } = lagScan(days, (d) => d.views, (d) => d.ytLeads);
    expect(points).toHaveLength(8);
    expect(best?.lag).toBe(2);
    expect(best?.r).toBeCloseTo(1);
  });
  it("skips days with no channel data", () => {
    const days = series(30, (i) => ({ views: i < 25 ? null : 5, ytLeads: 1 }));
    const { points } = lagScan(days, (d) => d.views, (d) => d.ytLeads);
    expect(points[0].n).toBe(5);
    expect(points[0].strength).toBe("insufficient");
  });
});

describe("weekly", () => {
  it("keeps only complete Monday-start weeks and nulls weeks with missing views", () => {
    // 2026-06-01 is a Monday; 16 days = 2 full weeks + 2 stray days.
    const days = series(16, (i) => ({ views: i === 9 ? null : 10, ytLeads: 1, voxbayLeads: 2 }));
    const w = weekly(days, "both");
    expect(w.map((x) => x.weekStart)).toEqual(["2026-06-01", "2026-06-08"]);
    expect(w[0]).toMatchObject({ views: 70, leads: 21 });
    expect(w[1].views).toBeNull();
  });
  it("change-correlation strips a shared trend", () => {
    // Both series trend up, but the wiggles are unrelated.
    const days = series(7 * 30, (i) => {
      const wk = Math.floor(i / 7);
      return { views: 1000 + wk * 100 + (wk % 2) * 50, ytLeads: wk + (wk % 3 === 0 ? 1 : 0) };
    });
    const weeks = weekly(days, "youtube");
    const { level, change } = weeklyCorrelation(weeks, (w) => w.views);
    expect(level.r!).toBeGreaterThan(0.9);
    expect(Math.abs(change.r!)).toBeLessThan(level.r!);
  });
});

describe("uploadLift", () => {
  it("compares the 3-day window with the 14-day baseline", () => {
    const days = series(30, (i) => ({ ytLeads: i >= 20 && i < 23 ? 5 : 1 }));
    const video: InsightsVideo = { id: "v1", title: "A", publishDay: days[20].day, format: "short", viewCount: 10, thumbnailUrl: null };
    const [l] = uploadLift(days, [video], "youtube");
    expect(l).toMatchObject({ actual: 15, expected: 3, lift: 12, overlapping: 0 });
  });
  it("skips uploads without a full baseline or window, and flags neighbours", () => {
    const days = series(30, () => ({ ytLeads: 1 }));
    const mk = (id: string, i: number): InsightsVideo => ({ id, title: id, publishDay: days[i].day, format: "video", viewCount: 0, thumbnailUrl: null });
    const lifts = uploadLift(days, [mk("early", 5), mk("late", 28), mk("a", 20), mk("b", 21)], "youtube");
    expect(lifts.map((l) => l.video.id)).toEqual(["a", "b"]);
    expect(lifts[0].overlapping).toBe(1);
  });
  it("uses Voxbay callers only where covered", () => {
    const d = series(1, () => ({ voxbayCallers: null }))[0];
    expect(leadValue(d, "callers")).toBeNull();
  });
});
