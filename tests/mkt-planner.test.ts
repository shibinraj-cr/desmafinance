/**
 * The Marketing Planner's rules — fiscal calendar maths, which campaign a
 * ledger payment belongs to, how commitments net off against payments, and
 * pace — are pure functions in mkt-planner-shared, tested here without a
 * database. The Prisma loaders around them only fetch and group.
 */
import { describe, it, expect } from "vitest";

import {
  attributeLedgerRow,
  campaignMoney,
  commitmentMonth,
  compactRupees,
  displayStatus,
  formatInr,
  formatLakh,
  fyMonthFirstDay,
  fyMonthLastDay,
  fyMonthOfDay,
  fyOfDay,
  fyProgress,
  niceScale,
  overlapDays,
  paceOf,
  parseRupees,
  planToDate,
  prorateBudget,
  quarterOfMonth,
  quarterRange,
  subItemChannelMap,
  timelineBar,
  type CampaignWindow,
  type LedgerRowIn,
} from "@/lib/mkt-planner-shared";

describe("fiscal calendar", () => {
  it("indexes months from April and years from their opening April", () => {
    expect(fyMonthOfDay("2026-04-01")).toBe(0);
    expect(fyMonthOfDay("2026-10-08")).toBe(6);
    expect(fyMonthOfDay("2027-01-15")).toBe(9);
    expect(fyMonthOfDay("2027-03-31")).toBe(11);
    expect(fyOfDay("2027-02-15")).toBe(2026);
    expect(fyOfDay("2026-04-01")).toBe(2026);
    expect(fyOfDay("2026-03-31")).toBe(2025);
  });

  it("knows each fiscal month's first and last day, across the year boundary and leap Februaries", () => {
    expect(fyMonthFirstDay(2026, 0)).toBe("2026-04-01");
    expect(fyMonthFirstDay(2026, 9)).toBe("2027-01-01");
    expect(fyMonthLastDay(2026, 8)).toBe("2026-12-31");
    expect(fyMonthLastDay(2026, 11)).toBe("2027-03-31");
    expect(fyMonthLastDay(2027, 10)).toBe("2028-02-29");
  });

  it("reports progress through the year: whole months behind, share of the running month", () => {
    const p = fyProgress(2026, "2026-10-08");
    expect(p.monthIdx).toBe(6);
    expect(p.monthFraction).toBeCloseTo(8 / 31);
    expect(p.yearFraction).toBeCloseTo(191 / 365);
    expect(fyProgress(2025, "2026-10-08")).toMatchObject({ monthIdx: 12, yearFraction: 1, ended: true });
    expect(fyProgress(2027, "2026-10-08")).toMatchObject({ monthIdx: 0, yearFraction: 0, started: false });
  });

  it("splits the year into fiscal quarters", () => {
    expect(quarterOfMonth(6)).toBe(2);
    expect(quarterRange(2026, 2)).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
      months: [6, 7, 8],
      label: "Q3 · Oct – Dec 2026",
    });
    expect(quarterRange(2026, 3).label).toBe("Q4 · Jan – Mar 2027");
  });
});

describe("timeline geometry", () => {
  it("counts overlapping days inclusively", () => {
    expect(overlapDays("2026-10-14", "2026-11-02", "2026-10-01", "2026-12-31")).toBe(20);
    expect(overlapDays("2026-09-01", "2026-09-30", "2026-10-01", "2026-12-31")).toBe(0);
  });

  it("places a bar as a share of the quarter", () => {
    expect(timelineBar("2026-10-14", "2026-11-02", "2026-10-01", "2026-12-31")).toEqual({
      left: 14.1,
      width: 21.7,
      clippedStart: false,
      clippedEnd: false,
    });
    expect(timelineBar("2026-09-15", "2026-10-10", "2026-10-01", "2026-12-31")).toMatchObject({
      left: 0,
      clippedStart: true,
    });
    expect(timelineBar("2026-09-01", "2026-09-30", "2026-10-01", "2026-12-31")).toBeNull();
    // A one-day event with no end date is a one-day bar.
    expect(timelineBar("2026-12-14", null, "2026-10-01", "2026-12-31")?.width).toBe(1.1);
  });

  it("prorates a campaign's budget into a range by days", () => {
    // 30-day campaign, 14 of its days fall in Q3.
    expect(prorateBudget(30000, "2026-09-15", "2026-10-14", "2026-10-01", "2026-12-31")).toBe(14000);
    expect(prorateBudget(50000, "2026-10-01", "2026-12-31", "2026-10-01", "2026-12-31")).toBe(50000);
    expect(prorateBudget(50000, null, null, "2026-10-01", "2026-12-31")).toBe(0);
  });
});

describe("displayStatus", () => {
  it("shows an approved campaign as live inside its dates and done after them", () => {
    expect(displayStatus("approved", "2026-10-01", "2026-12-31", "2026-09-30")).toBe("approved");
    expect(displayStatus("approved", "2026-10-01", "2026-12-31", "2026-10-01")).toBe("live");
    expect(displayStatus("approved", "2026-10-01", "2026-12-31", "2027-01-01")).toBe("done");
    expect(displayStatus("approved", "2026-12-14", null, "2026-12-14")).toBe("live");
  });

  it("leaves every other status as stored", () => {
    expect(displayStatus("awaiting", "2026-10-01", "2026-12-31", "2026-11-01")).toBe("awaiting");
    expect(displayStatus("draft", null, null, "2026-11-01")).toBe("draft");
    expect(displayStatus("bogus", null, null, "2026-11-01")).toBe("draft");
  });
});

describe("ledger attribution", () => {
  const channels = [
    { id: "meta", sortOrder: 0, ledgerSubItems: ["Digital Advertisement - Meta"] },
    { id: "events", sortOrder: 1, ledgerSubItems: ["Events & Seminars"] },
    { id: "late", sortOrder: 9, ledgerSubItems: ["Events & Seminars"] },
  ];
  const map = subItemChannelMap(channels);
  const row = (over: Partial<LedgerRowIn> = {}): LedgerRowIn => ({
    id: "t1",
    date: "2026-10-06",
    subItem: "Digital Advertisement - Meta",
    amount: 18000,
    tag: null,
    ...over,
  });
  const camp = (over: Partial<CampaignWindow>): CampaignWindow => ({
    id: "c",
    channelId: "meta",
    status: "approved",
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    ...over,
  });

  it("gives a sub-item claimed twice to the first channel in sort order", () => {
    expect(map.get("Events & Seminars")).toBe("events");
  });

  it("attributes to the one approved campaign running on the payment date", () => {
    expect(attributeLedgerRow(row(), map, [camp({ id: "always-on" })])).toEqual({
      mode: "auto",
      channelId: "meta",
      campaignId: "always-on",
      lineId: null,
    });
  });

  it("counts finished campaigns but never drafts, ideas or other channels", () => {
    const res = attributeLedgerRow(
      row(),
      map,
      [
        camp({ id: "done", status: "done" }),
        camp({ id: "draft", status: "draft" }),
        camp({ id: "other", channelId: "events" }),
        camp({ id: "before", startDate: "2026-09-01", endDate: "2026-09-30" }),
      ],
    );
    expect(res).toMatchObject({ mode: "auto", campaignId: "done" });
  });

  it("sends a payment to review when two campaigns on its channel were running", () => {
    const res = attributeLedgerRow(row(), map, [camp({ id: "a" }), camp({ id: "b", startDate: "2026-10-05" })]);
    expect(res).toMatchObject({ mode: "review", reason: "ambiguous", candidates: ["a", "b"] });
  });

  it("sends a sub-item no channel claims to review", () => {
    expect(attributeLedgerRow(row({ subItem: "Designs & Editing" }), map, [])).toMatchObject({
      mode: "review",
      reason: "unmapped",
      channelId: null,
    });
  });

  it("keeps channel-level spend when no campaign was running", () => {
    expect(attributeLedgerRow(row(), map, [])).toEqual({
      mode: "channel",
      channelId: "meta",
      campaignId: null,
      lineId: null,
    });
  });

  it("lets an explicit tag win — including a deliberate 'not a campaign'", () => {
    const tagged = row({ tag: { campaignId: "seminar", lineId: "brochures" } });
    expect(attributeLedgerRow(tagged, map, [camp({ id: "a" }), camp({ id: "b" })])).toEqual({
      mode: "tagged",
      channelId: "meta",
      campaignId: "seminar",
      lineId: "brochures",
    });
    expect(attributeLedgerRow(row({ tag: { campaignId: null, lineId: null } }), map, [camp({})])).toMatchObject({
      mode: "tagged",
      campaignId: null,
    });
  });
});

describe("campaignMoney", () => {
  const lines = [
    { id: "venue", planned: 45000 },
    { id: "travel", planned: 30000 },
    { id: "standees", planned: 18000 },
    { id: "brochures", planned: 22000 },
    { id: "food", planned: 25000 },
    { id: "gifts", planned: 20000 },
  ];

  it("nets each line's commitments against what the ledger shows paid on it", () => {
    const m = campaignMoney({
      budget: 160000,
      lines,
      commitments: [
        { lineId: "venue", amount: 45000, status: "open" },
        { lineId: "standees", amount: 18000, status: "open" },
        { lineId: "brochures", amount: 22000, status: "open" },
        { lineId: "gifts", amount: 15000, status: "open" },
        { lineId: "food", amount: 9000, status: "cancelled" },
      ],
      payments: [
        { lineId: "standees", amount: 18000 },
        { lineId: "brochures", amount: 12000 },
      ],
    });
    expect(m.paid).toBe(30000);
    expect(m.committedUnpaid).toBe(70000);
    expect(m.uncommitted).toBe(60000);
    expect(m.over).toBe(0);
    expect(m.linesPlanned).toBe(160000);
    expect(m.byLine.get("brochures")).toEqual({ committed: 22000, paid: 12000, unpaid: 10000 });
  });

  it("never lets an overpaid line count as negative commitment, and reports overspend", () => {
    const m = campaignMoney({
      budget: 20000,
      lines: [{ id: "a", planned: 20000 }],
      commitments: [
        { lineId: "a", amount: 10000, status: "open" },
        { lineId: null, amount: 15000, status: "open" },
      ],
      payments: [{ lineId: "a", amount: 14000 }],
    });
    expect(m.committedUnpaid).toBe(15000);
    expect(m.paid).toBe(14000);
    expect(m.uncommitted).toBe(0);
    expect(m.over).toBe(9000);
  });
});

describe("pace", () => {
  const monthly = [140, 150, 150, 150, 150, 160, 160, 150, 130, 160, 150, 150].map((k) => k * 1000);

  it("counts plan-to-date as whole months behind plus the share of the running month", () => {
    expect(planToDate(monthly, { monthIdx: 6, monthFraction: 0.5 })).toBe(900000 + 80000);
    expect(planToDate(monthly, { monthIdx: 12, monthFraction: 0 })).toBe(1800000);
  });

  it("calls hot, on pace and under-used against plan-to-date", () => {
    const base = { budget: 1800000, committed: 0, planToDate: 1000000 };
    expect(paceOf({ ...base, spent: 1150000 })).toBe("hot");
    expect(paceOf({ ...base, spent: 1000000 })).toBe("on_pace");
    expect(paceOf({ ...base, spent: 700000 })).toBe("under");
  });

  it("flags over budget first, and a channel with no plan", () => {
    expect(paceOf({ budget: 100000, spent: 80000, committed: 30000, planToDate: 90000 })).toBe("over_budget");
    expect(paceOf({ budget: 0, spent: 0, committed: 0, planToDate: 0 })).toBe("no_plan");
    expect(paceOf({ budget: 0, spent: 5000, committed: 0, planToDate: 0 })).toBe("over_budget");
  });
});

describe("commitmentMonth", () => {
  it("puts a commitment on the month it falls due, never before the running month", () => {
    expect(commitmentMonth("2026-11-20", 2026, "2026-10-08")).toBe(7);
    expect(commitmentMonth("2026-09-01", 2026, "2026-10-08")).toBe(6);
    expect(commitmentMonth(null, 2026, "2026-10-08")).toBe(6);
  });

  it("drops one due in a later fiscal year and parks a finished year's on March", () => {
    expect(commitmentMonth("2027-04-10", 2026, "2026-10-08")).toBeNull();
    expect(commitmentMonth(null, 2025, "2026-10-08")).toBe(11);
  });
});

describe("formatting", () => {
  it("formats rupees in Indian grouping and lakh", () => {
    expect(formatInr(160000)).toBe("₹1,60,000");
    expect(formatLakh(2160000)).toBe("₹21.6L");
    expect(formatLakh(90000)).toBe("₹0.90L");
    expect(formatLakh(0)).toBe("₹0");
    expect(formatLakh(-230000)).toBe("−₹2.30L");
  });

  it("parses typed rupee amounts and rejects anything else", () => {
    expect(parseRupees("1,60,000")).toBe(160000);
    expect(parseRupees("₹ 24,500")).toBe(24500);
    expect(parseRupees("12.5")).toBeNull();
    expect(parseRupees("-5")).toBeNull();
    expect(parseRupees("")).toBeNull();
  });
});

describe("chart axis", () => {
  it("rounds the axis up to five friendly steps", () => {
    expect(niceScale(440000)).toEqual({ top: 500000, step: 100000 });
    expect(niceScale(610000)).toEqual({ top: 1000000, step: 200000 });
    expect(niceScale(0)).toEqual({ top: 100000, step: 20000 });
  });

  it("labels axis ticks compactly", () => {
    expect(compactRupees(250000)).toBe("₹2.5L");
    expect(compactRupees(50000)).toBe("₹50k");
    expect(compactRupees(0)).toBe("₹0");
    expect(compactRupees(12000000)).toBe("₹1.2Cr");
  });
});
