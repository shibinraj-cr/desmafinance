import { describe, it, expect } from "vitest";
import {
  NO_CAMPAIGN,
  buildMetaRoi,
  campaignLabel,
  channelOf,
  isRepeat,
  monthRange,
  paymentKind,
  type MetaRoiInput,
  type RoiLead,
} from "@/lib/meta-roi";

const lead = (over: Partial<RoiLead> & { id: string }): RoiLead => ({
  partyId: null,
  day: "2026-06-05",
  sourceCode: "meta",
  originalSourceCode: null,
  adEvidence: false,
  campaign: "Form A",
  won: false,
  ...over,
});

const input = (over: Partial<MetaRoiInput>): MetaRoiInput => ({
  today: "2026-11-20",
  months: monthRange("2026-06", "2026-11"),
  spend: [],
  manualSpend: {},
  payments: [],
  refunds: [],
  leads: [],
  partySourceCode: {},
  enrollments: [],
  ...over,
});

describe("which candidates are Meta", () => {
  it("lead forms, Insta / FB and WA API are Meta; Instagram DMs are only possible Meta", () => {
    const f = (sourceCode: string | null, extra: Partial<RoiLead> = {}) =>
      channelOf({ sourceCode, originalSourceCode: null, adEvidence: false, ...extra });
    expect(f("meta")).toBe("meta");
    expect(f("insta_fb")).toBe("meta");
    expect(f("wabis")).toBe("meta");
    expect(f("insta")).toBe("possible");
    expect(f("insta", { adEvidence: true })).toBe("meta");
    expect(f("website")).toBe("other");
    expect(f("website", { adEvidence: true })).toBe("meta");
    expect(f(null)).toBe("other");
  });

  it("a re-enrollment lead keeps the channel the candidate first came from, and is a repeat", () => {
    const re = { sourceCode: "existing_candidate", originalSourceCode: "meta", adEvidence: false };
    expect(channelOf(re)).toBe("meta");
    expect(isRepeat(re)).toBe(true);
    expect(isRepeat({ sourceCode: "meta", originalSourceCode: null, adEvidence: false })).toBe(false);
  });

  it("partner commissions are not candidate payments", () => {
    expect(paymentKind("Sales - Nursing Registrations")).toBe("sale");
    expect(paymentKind("Collection - Study Abroad")).toBe("collection");
    expect(paymentKind("Commissions")).toBeNull();
  });

  it("a lead's campaign is its form tab, else the WhatsApp ad it came from", () => {
    expect(campaignLabel({ campaign: " Form B ", adHeadline: "x", adId: null, adEvidence: true })).toBe("Form B");
    expect(campaignLabel({ campaign: null, adHeadline: "Study in Australia", adId: "1", adEvidence: true })).toBe("WhatsApp ad: Study in Australia");
    expect(campaignLabel({ campaign: null, adHeadline: null, adId: "123", adEvidence: true })).toBe("WhatsApp ad: id 123");
    expect(campaignLabel({ campaign: null, adHeadline: null, adId: null, adEvidence: false })).toBe(NO_CAMPAIGN);
  });
});

describe("by month", () => {
  const leads = [
    lead({ id: "l1", partyId: "p1", day: "2026-06-02" }),
    lead({ id: "l2", partyId: "p2", day: "2026-06-03", sourceCode: "wabis", campaign: NO_CAMPAIGN }),
    lead({ id: "l3", partyId: "p3", day: "2026-06-04", sourceCode: "website" }),
    lead({ id: "l4", partyId: "p4", day: "2026-06-04", sourceCode: "insta" }),
  ];
  const r = buildMetaRoi(
    input({
      leads,
      spend: [
        { day: "2026-06-01", amount: 40_000 },
        { day: "2026-06-20", amount: 10_000 },
        { day: "2026-07-03", amount: 20_000 },
      ],
      payments: [
        { id: "a", partyId: "p1", day: "2026-06-10", kind: "sale", net: 30_000 },
        { id: "b", partyId: "p1", day: "2026-07-10", kind: "collection", net: 20_000 },
        { id: "c", partyId: "p1", day: "2026-07-15", kind: "sale", net: 15_000 }, // a second service
        { id: "d", partyId: "p2", day: "2026-06-12", kind: "sale", net: 25_000 },
        { id: "e", partyId: "p3", day: "2026-06-12", kind: "sale", net: 99_000 }, // website: not Meta
        { id: "f", partyId: "p4", day: "2026-06-12", kind: "sale", net: 7_000 }, // Instagram DM: possible
      ],
      refunds: [{ partyId: "p2", day: "2026-07-20", amount: 5_000 }],
      enrollments: [
        { day: "2026-06-10", sourceCode: "meta", originalSourceCode: null, adEvidence: false, verification: "verified" },
        { day: "2026-06-12", sourceCode: "wabis", originalSourceCode: null, adEvidence: false, verification: "pending" },
        { day: "2026-06-12", sourceCode: "website", originalSourceCode: null, adEvidence: false, verification: "none" },
        { day: "2026-07-15", sourceCode: "existing_candidate", originalSourceCode: "meta", adEvidence: false, verification: "none" },
        { day: "2026-06-12", sourceCode: "insta", originalSourceCode: null, adEvidence: false, verification: "none" },
      ],
      manualSpend: { "2026-06": 45_000 },
    }),
  );
  const jun = r.months.find((m) => m.month === "2026-06")!;
  const jul = r.months.find((m) => m.month === "2026-07")!;

  it("spend is the month's ledger Meta entries", () => {
    expect(jun.spend).toBe(50_000);
    expect(jul.spend).toBe(20_000);
    expect(jun.manualSpend).toBe(45_000);
    expect(jul.manualSpend).toBeNull();
  });

  it("first payment is a new sale, later ones collections, a second Sales payment a repeat; non-Meta money is left out", () => {
    expect(jun.newSales).toBe(55_000);
    expect(jun.collections).toBe(0);
    expect(jul.collections).toBe(20_000);
    expect(jul.repeatSales).toBe(15_000);
    expect(jul.refunds).toBe(5_000);
    expect(jul.cash).toBe(30_000);
  });

  it("ROAS, cost per lead and cost per enrollment", () => {
    expect(jun.cashRoas).toBe(1.1); // 55,000 ÷ 50,000
    expect(jun.newSaleRoas).toBe(1.1);
    expect(jun.leads).toBe(2); // the Meta and WA API leads
    expect(jun.costPerLead).toBe(25_000);
    expect(jun.newEnrollments).toBe(2);
    expect(jun.verifiedEnrollments).toBe(1);
    expect(jun.costPerEnrollment).toBe(25_000);
    expect(jul.newEnrollments).toBe(0);
    expect(jul.repeatEnrollments).toBe(1);
    expect(jul.costPerEnrollment).toBeNull();
  });

  it("possible Meta is kept apart", () => {
    expect(jun.possibleCash).toBe(7_000);
    expect(jun.possibleEnrollments).toBe(1);
    expect(r.total.possibleCash).toBe(7_000);
  });

  it("totals add up across the months", () => {
    expect(r.total.spend).toBe(70_000);
    expect(r.total.cash).toBe(85_000);
    expect(r.total.cashRoas).toBe(1.21);
    expect(r.total.newEnrollments).toBe(2);
  });

  it("counts WA API leads with no ad recorded", () => {
    expect(r.waApiWithoutAd).toBe(1);
  });
});

describe("a candidate's channel is their first lead's", () => {
  it("a Meta candidate who later asked from the website stays Meta, and the reverse stays not-Meta", () => {
    const r = buildMetaRoi(
      input({
        leads: [
          lead({ id: "a1", partyId: "pa", day: "2026-06-01", sourceCode: "meta" }),
          lead({ id: "a2", partyId: "pa", day: "2026-08-01", sourceCode: "website" }),
          lead({ id: "b1", partyId: "pb", day: "2026-06-01", sourceCode: "website" }),
          lead({ id: "b2", partyId: "pb", day: "2026-08-01", sourceCode: "meta" }),
        ],
        payments: [
          { id: "1", partyId: "pa", day: "2026-08-10", kind: "sale", net: 10_000 },
          { id: "2", partyId: "pb", day: "2026-08-10", kind: "sale", net: 90_000 },
        ],
      }),
    );
    expect(r.months.find((m) => m.month === "2026-08")!.newSales).toBe(10_000);
  });

  it("a paying candidate with no lead falls back to the source on their record", () => {
    const r = buildMetaRoi(
      input({
        partySourceCode: { px: "meta", py: "youtube" },
        payments: [
          { id: "1", partyId: "px", day: "2026-09-01", kind: "sale", net: 8_000 },
          { id: "2", partyId: "py", day: "2026-09-01", kind: "sale", net: 9_000 },
        ],
      }),
    );
    expect(r.months.find((m) => m.month === "2026-09")!.newSales).toBe(8_000);
  });
});

describe("by the month the lead came in", () => {
  const r = buildMetaRoi(
    input({
      today: "2026-11-20",
      leads: [
        lead({ id: "j1", partyId: "p1", day: "2026-06-05", won: true }),
        lead({ id: "j2", partyId: "p2", day: "2026-06-25", won: true }),
        lead({ id: "j3", day: "2026-06-26" }), // never paid
        lead({ id: "j4", partyId: "p1", day: "2026-06-28" }), // the same candidate asking again
        lead({ id: "o1", partyId: "p9", day: "2026-10-02", won: true }),
      ],
      spend: [
        { day: "2026-06-15", amount: 60_000 },
        { day: "2026-10-15", amount: 50_000 },
      ],
      payments: [
        { id: "a", partyId: "p1", day: "2026-06-20", kind: "sale", net: 20_000 }, // day 15
        { id: "b", partyId: "p1", day: "2026-08-20", kind: "collection", net: 20_000 }, // day 76
        { id: "c", partyId: "p2", day: "2026-09-10", kind: "sale", net: 30_000 }, // day 77 for p2
        { id: "d", partyId: "p9", day: "2026-10-20", kind: "sale", net: 10_000 },
      ],
    }),
  );
  const jun = r.cohorts.find((c) => c.month === "2026-06")!;
  const oct = r.cohorts.find((c) => c.month === "2026-10")!;

  it("counts the month's Meta leads and how many enrolled", () => {
    expect(jun.leads).toBe(4);
    expect(jun.enrolled).toBe(2);
    expect(jun.spend).toBe(60_000);
  });

  it("cash within 30 / 90 / 180 days of each lead, the same candidate counted once", () => {
    expect(jun.cashAt[30]).toBe(20_000);
    expect(jun.cashAt[90]).toBe(70_000);
    expect(jun.roasAt[30]).toBe(0.33);
    expect(jun.roasAt[90]).toBe(1.17);
    expect(jun.cashAt[180]).toBeNull(); // 30 Jun + 180 days is after today
    expect(jun.cashToDate).toBe(70_000);
  });

  it("a month too young for a horizon shows nothing for it", () => {
    expect(oct.cashAt[30]).toBeNull(); // 31 Oct + 30 days is 30 Nov, after today
    expect(oct.cashToDate).toBe(10_000);
  });

  it("the month spend is paid back, or how much is recovered so far", () => {
    expect(jun.payback).toEqual({ kind: "paid_back", month: "2026-09", months: 3 });
    expect(oct.payback).toEqual({ kind: "not_yet", recoveredPct: 20 });
    expect(r.cohorts.find((c) => c.month === "2026-07")!.payback).toBeNull(); // no spend
  });

  it("the headline 90-day ROAS is the newest month old enough", () => {
    expect(r.latest90?.month).toBe("2026-06");
  });
});

describe("by campaign", () => {
  it("cash per enrollment only from 3 enrollments; fewer is too few", () => {
    const leads = [
      ...[1, 2, 3].map((i) => lead({ id: `a${i}`, partyId: `pa${i}`, campaign: "Form A", won: true })),
      lead({ id: "b1", partyId: "pb1", campaign: "Form B", won: true }),
      lead({ id: "b2", campaign: "Form B" }),
    ];
    const r = buildMetaRoi(
      input({
        leads,
        payments: [
          ...[1, 2, 3].map((i) => ({ id: `x${i}`, partyId: `pa${i}`, day: "2026-07-01", kind: "sale" as const, net: 10_000 })),
          { id: "y", partyId: "pb1", day: "2026-07-01", kind: "sale" as const, net: 50_000 },
        ],
      }),
    );
    expect(r.campaigns).toEqual([
      { campaign: "Form B", leads: 2, enrolled: 1, cash: 50_000, cashPerEnrollment: null },
      { campaign: "Form A", leads: 3, enrolled: 3, cash: 30_000, cashPerEnrollment: 10_000 },
    ]);
  });
});

describe("review fixes", () => {
  const nov = (r: ReturnType<typeof buildMetaRoi>) => r.months.find((m) => m.month === "2026-11")!;

  it("an uploaded lead with no date of its own isn't a lead that month, but still decides the candidate's channel", () => {
    const r = buildMetaRoi(
      input({
        leads: [lead({ id: "u1", partyId: "pu", day: "2026-11-15", counted: false })],
        payments: [{ id: "1", partyId: "pu", day: "2026-11-16", kind: "sale", net: 12_000 }],
        spend: [{ day: "2026-11-01", amount: 6_000 }],
      }),
    );
    expect(nov(r).leads).toBe(0);
    expect(nov(r).costPerLead).toBeNull();
    expect(nov(r).newSales).toBe(12_000);
    expect(r.cohorts.find((c) => c.month === "2026-11")!.leads).toBe(0);
  });

  it("a cohort counts only money paid on or after the lead", () => {
    const r = buildMetaRoi(
      input({
        leads: [lead({ id: "c1", partyId: "pc", day: "2026-06-20" })],
        payments: [
          { id: "1", partyId: "pc", day: "2026-06-10", kind: "sale", net: 40_000 }, // before the lead
          { id: "2", partyId: "pc", day: "2026-06-25", kind: "collection", net: 5_000 },
        ],
      }),
    );
    const jun = r.cohorts.find((c) => c.month === "2026-06")!;
    expect(jun.cashAt[30]).toBe(5_000);
    expect(jun.cashToDate).toBe(5_000);
    expect(r.months.find((m) => m.month === "2026-06")!.newSales).toBe(40_000); // the month still has it
  });

  it("a candidate who bought before DesGro makes a repeat sale and a repeat enrollment, without counting the old money", () => {
    const r = buildMetaRoi(
      input({
        priorSaleParties: ["pp"],
        leads: [lead({ id: "p1", partyId: "pp", day: "2026-09-01" })],
        payments: [{ id: "1", partyId: "pp", day: "2026-09-05", kind: "sale", net: 50_000 }],
        enrollments: [{ day: "2026-09-05", sourceCode: "meta", originalSourceCode: null, adEvidence: false, verification: "verified", partyId: "pp" }],
      }),
    );
    const sep = r.months.find((m) => m.month === "2026-09")!;
    expect(sep.newSales).toBe(0);
    expect(sep.repeatSales).toBe(50_000);
    expect(sep.newEnrollments).toBe(0);
    expect(sep.repeatEnrollments).toBe(1);
  });

  it("a refund is taken off net of GST at the candidate's own rate", () => {
    const r = buildMetaRoi(
      input({
        leads: [lead({ id: "g1", partyId: "pg", day: "2026-11-02" })],
        payments: [{ id: "1", partyId: "pg", day: "2026-11-03", kind: "sale", net: 100_000, gross: 118_000 }],
        refunds: [{ partyId: "pg", day: "2026-11-10", amount: 118_000 }],
      }),
    );
    expect(nov(r).refunds).toBe(100_000);
    expect(nov(r).cash).toBe(0);
    expect(r.cohorts.find((c) => c.month === "2026-11")!.cashToDate).toBe(0);
  });

  it("an enrollment follows the candidate's first lead, and an earlier won deal makes it a repeat", () => {
    const r = buildMetaRoi(
      input({
        leads: [
          lead({ id: "w1", partyId: "pw", day: "2026-06-01", sourceCode: "website" }),
          lead({ id: "w2", partyId: "pw", day: "2026-08-01", sourceCode: "meta" }),
          lead({ id: "m1", partyId: "pm", day: "2026-06-01", sourceCode: "meta" }),
        ],
        enrollments: [
          // A fresh Meta lead, but the candidate first came from the website.
          { day: "2026-08-05", sourceCode: "meta", originalSourceCode: null, adEvidence: false, verification: "none", partyId: "pw" },
          // A Meta candidate's second service through a lead that wasn't flagged as a re-enrollment.
          { day: "2026-08-06", sourceCode: "meta", originalSourceCode: null, adEvidence: false, verification: "none", partyId: "pm", earlierWin: true },
        ],
      }),
    );
    const aug = r.months.find((m) => m.month === "2026-08")!;
    expect(aug.newEnrollments).toBe(0);
    expect(aug.repeatEnrollments).toBe(1);
  });
});
