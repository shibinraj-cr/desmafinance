import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_ROWS,
  NO_CAMPAIGN,
  OVERDUE_LIST_LIMIT,
  buildCrmLeadQualityReport,
  trendWeekStarts,
  type LqFilters,
  type LqRow,
} from "@/lib/crm-lead-quality-report";
import { badShare, ratedCount, ratingShare } from "@/lib/lead-quality-report";
import { ymdFromDay } from "@/lib/sales-analysis";

// Saturday 24 Oct 2026, 15:30 IST.
const NOW = new Date("2026-10-24T10:00:00Z");
const DAY = 86_400_000;
const at = (ymd: string) => new Date(`${ymd}T06:30:00Z`); // noon IST
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

const RANGE = {
  from: new Date("2026-09-30T18:30:00Z"), // 1 Oct IST
  to: new Date("2026-10-24T18:30:00Z"), // end of 24 Oct IST
  prevFrom: new Date("2026-09-06T18:30:00Z"),
  prevTo: new Date("2026-09-30T18:30:00Z"),
};
const NO_FILTERS: LqFilters = { source: [], campaign: [], service: [], bde: [] };

let seq = 0;
function lead(p: Partial<LqRow> = {}): LqRow {
  seq += 1;
  return {
    id: `l${seq}`,
    candidateName: `Lead ${seq}`,
    createdAt: at("2026-10-05"),
    sourceId: "src_meta",
    source: "Meta",
    campaign: "Meta – NCLEX Oct",
    serviceId: "svc_1",
    service: "AHPRA",
    assigneeId: "bde_a",
    assigneeName: "BDE A",
    qualityRating: null,
    qualityDueAt: ago(10),
    reason: null,
    statusCode: "follow_up",
    statusKind: "active",
    ...p,
  };
}
const many = (count: number, p: Partial<LqRow>) => Array.from({ length: count }, () => lead(p));
const build = (rows: LqRow[], filters: LqFilters = NO_FILTERS) =>
  buildCrmLeadQualityReport(rows, { ...RANGE, now: NOW, filters });

describe("campaign quality", () => {
  it("flags a campaign for spend review at 35% Junk once 30 leads are rated", () => {
    const rows = [
      ...many(20, { campaign: "Lookalike", qualityRating: "good" }),
      ...many(11, { campaign: "Lookalike", qualityRating: "junk", reason: "Wrong / invalid number" }),
    ];
    const c = build(rows).campaigns.find((x) => x.label === "Lookalike")!;
    expect(ratedCount(c.counts)).toBe(31);
    expect(ratingShare(c.counts, "junk")).toBeCloseTo((11 / 31) * 100);
    expect(c.flag).toBe(true);
    expect(c.topReason).toBe("Wrong / invalid number");
  });

  it("does not flag a junky campaign with too few ratings to be sure, and marks it thin below 5", () => {
    const flagless = build(many(20, { campaign: "Small", qualityRating: "junk", reason: "Fake" })).campaigns[0];
    expect(flagless.flag).toBe(false);
    const thin = build(many(3, { campaign: "Tiny", qualityRating: "junk", reason: "Fake" })).campaigns[0];
    expect(thin.thin).toBe(true);
  });

  it("names a campaign's main source and groups leads with no campaign together", () => {
    const rows = [
      ...many(3, { campaign: "Mixed", source: "Meta", sourceId: "src_meta" }),
      lead({ campaign: "Mixed", source: "Website", sourceId: "src_web" }),
      ...many(2, { campaign: null }),
    ];
    const r = build(rows);
    expect(r.campaigns.find((c) => c.label === "Mixed")!.source).toBe("Meta");
    const none = r.campaigns.find((c) => c.label === NO_CAMPAIGN)!;
    expect(none.campaign).toBeNull();
    expect(none.counts.leads).toBe(2);
  });

  it("folds the long tail into one row so the table stays readable", () => {
    const rows = Array.from({ length: CAMPAIGN_ROWS + 3 }, (_, i) => lead({ campaign: `C${String(i).padStart(2, "0")}` }));
    const r = build(rows);
    expect(r.campaigns).toHaveLength(CAMPAIGN_ROWS);
    expect(r.otherCampaigns).toMatchObject({ count: 3 });
    expect(r.otherCampaigns!.counts.leads).toBe(3);
  });
});

describe("headline numbers", () => {
  it("counts only the period, and compares shares with the period before", () => {
    const rows = [
      ...many(6, { qualityRating: "good" }),
      ...many(4, { qualityRating: "junk", reason: "Fake" }),
      ...many(2, { createdAt: at("2026-09-20"), qualityRating: "good" }),
      ...many(2, { createdAt: at("2026-09-20"), qualityRating: "junk", reason: "Fake" }),
      lead({ createdAt: at("2026-08-01"), qualityRating: "junk" }), // in neither window
    ];
    const r = build(rows);
    expect(r.current.leads).toBe(10);
    expect(ratingShare(r.current, "good")).toBeCloseTo(60);
    expect(r.previous.leads).toBe(4);
    expect(ratingShare(r.previous, "good")).toBeCloseTo(50);
  });

  it("applies every filter, by id for source / service / BDE and by text for campaign", () => {
    const rows = [lead({ sourceId: "src_web", source: "Website" }), lead({ serviceId: "svc_2" }), lead({ assigneeId: "bde_b" }), lead({ campaign: "Other" })];
    expect(build(rows, { ...NO_FILTERS, source: ["src_web"] }).current.leads).toBe(1);
    expect(build(rows, { ...NO_FILTERS, service: ["svc_2"] }).current.leads).toBe(1);
    expect(build(rows, { ...NO_FILTERS, bde: ["bde_b"] }).current.leads).toBe(1);
    expect(build(rows, { ...NO_FILTERS, campaign: ["Other"] }).current.leads).toBe(1);
  });

  it("lists filter options from the whole period, even while a filter is on", () => {
    const rows = [lead({ sourceId: "src_web", source: "Website" }), lead()];
    const r = build(rows, { ...NO_FILTERS, source: ["src_web"] });
    expect(r.options.source.map((o) => o.label)).toEqual(["Meta", "Website"]);
  });
});

describe("reasons", () => {
  it("counts Poor and Junk per reason and names the campaign behind most of it", () => {
    const rows = [
      ...many(3, { campaign: "Lookalike", qualityRating: "junk", reason: "Wrong / invalid number" }),
      lead({ campaign: "NCLEX", qualityRating: "poor", reason: "Wrong / invalid number" }),
      lead({ campaign: "NCLEX", qualityRating: "poor", reason: "Not eligible" }),
      lead({ qualityRating: "good" }),
    ];
    expect(build(rows).reasons).toEqual([
      { label: "Wrong / invalid number", poor: 1, junk: 3, total: 4, topCampaign: "Lookalike" },
      { label: "Not eligible", poor: 1, junk: 0, total: 1, topCampaign: "NCLEX" },
    ]);
  });
});

describe("rating discipline", () => {
  it("counts each BDE's due, rated and overdue leads, and how long the oldest has waited", () => {
    const rows = [
      ...many(3, { assigneeId: "bde_a", qualityRating: "good" }),
      lead({ assigneeId: "bde_a", qualityDueAt: ago(9) }),
      lead({ assigneeId: "bde_a", qualityDueAt: ago(2) }),
      lead({ assigneeId: "bde_a", qualityDueAt: new Date(NOW.getTime() + 2 * DAY) }), // not due yet
    ];
    const a = build(rows).bdes.find((b) => b.id === "bde_a")!;
    expect(a).toMatchObject({ due: 5, rated: 3, overdue: 2, oldestDays: 9 });
  });

  it("flags a BDE whose bad-lead rate is 20+ points off the team's", () => {
    const rows = [
      ...many(12, { assigneeId: "bde_a", assigneeName: "A", qualityRating: "junk", reason: "Fake" }),
      ...many(30, { assigneeId: "bde_b", assigneeName: "B", qualityRating: "good" }),
    ];
    const r = build(rows);
    expect(badShare(r.current)).toBeCloseTo((12 / 42) * 100);
    expect(r.bdes.find((b) => b.id === "bde_a")!.biasGap).toBeGreaterThan(20);
    expect(r.bdes.find((b) => b.id === "bde_b")!.biasGap).toBeLessThan(-20);
  });

  it("leaves out BDEs with nothing due yet", () => {
    const r = build([lead({ assigneeId: "bde_new", qualityDueAt: new Date(NOW.getTime() + DAY) })]);
    expect(r.bdes).toEqual([]);
  });
});

describe("overdue chase list", () => {
  it("lists the longest-overdue leads first, capped", () => {
    const rows = Array.from({ length: OVERDUE_LIST_LIMIT + 2 }, (_, i) => lead({ qualityDueAt: ago(i + 1), candidateName: `D${i + 1}` }));
    const r = build(rows);
    expect(r.overdue).toBe(OVERDUE_LIST_LIMIT + 2);
    expect(r.overdueList).toHaveLength(OVERDUE_LIST_LIMIT);
    expect(r.overdueList[0]).toMatchObject({ candidateName: `D${OVERDUE_LIST_LIMIT + 2}`, overdueDays: OVERDUE_LIST_LIMIT + 2 });
  });

  it("never lists unassigned, duplicate or pre-rule leads", () => {
    const r = build([lead({ assigneeId: null }), lead({ statusCode: "duplicate" }), lead({ qualityDueAt: null })]);
    expect(r.overdueList).toEqual([]);
  });
});

describe("junk trend", () => {
  it("uses the last 8 complete Sat–Fri weeks, oldest first", () => {
    const starts = trendWeekStarts(NOW);
    expect(starts).toHaveLength(8);
    expect(ymdFromDay(starts[7])).toBe("2026-10-17");
    expect(ymdFromDay(starts[0])).toBe("2026-08-29");
  });

  it("plots junk share per source per week, with gaps where too few were rated", () => {
    const rows = [
      ...many(4, { createdAt: at("2026-10-19"), qualityRating: "good" }),
      ...many(1, { createdAt: at("2026-10-19"), qualityRating: "junk", reason: "Fake" }),
      ...many(2, { createdAt: at("2026-10-12"), qualityRating: "junk", reason: "Fake" }),
    ];
    const meta = build(rows).trend.series.find((s) => s.source === "Meta")!;
    expect(meta.values[7]).toBeCloseTo(20);
    expect(meta.values[6]).toBeNull();
  });

  it("keeps each source's colour slot when a filter hides the others", () => {
    const rows = [
      ...many(10, { createdAt: at("2026-10-19"), qualityRating: "good", source: "Meta", sourceId: "src_meta" }),
      ...many(6, { createdAt: at("2026-10-19"), qualityRating: "good", source: "Website", sourceId: "src_web" }),
    ];
    const all = build(rows).trend.series;
    const filtered = build(rows, { ...NO_FILTERS, source: ["src_web"] }).trend.series;
    expect(filtered).toHaveLength(1);
    expect(filtered[0].colorIndex).toBe(all.find((s) => s.source === "Website")!.colorIndex);
  });
});
