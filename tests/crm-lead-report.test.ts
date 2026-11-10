import { describe, it, expect } from "vitest";
import {
  buildLeadReport,
  leadReportShareText,
  reportSource,
  shortDay,
  sumReports,
  type ReportAssignment,
} from "@/lib/crm-lead-report";
import { nextCutoff } from "@/lib/crm-cutoff";

// 2026-11-14 is a Saturday, 11-16 a Monday.
const ist = (dateTime: string) => new Date(`${dateTime.replace(" ", "T")}:00+05:30`);
const META = { sourceKey: "src-meta", sourceLabel: "Meta" };
const YT = { sourceKey: "src-yt", sourceLabel: "YouTube" };

function a(at: string, contactStatus: string, src = META): ReportAssignment {
  const assignedAt = ist(at);
  return { assignedAt, contactDueAt: nextCutoff(assignedAt, new Set()), contactStatus, ...src };
}

describe("buildLeadReport", () => {
  it("counts received, contacted, missed (late separately) and pending per source", () => {
    const r = buildLeadReport(
      "2026-11-16",
      [
        a("2026-11-16 09:00", "contacted"),
        a("2026-11-16 10:00", "missed"),
        a("2026-11-16 11:00", "contacted_late"),
        a("2026-11-16 12:00", "pending", YT),
      ],
      [],
    );
    expect(r.totals).toEqual({ received: 4, carriedIn: 0, dueLater: 0, contacted: 1, missed: 2, late: 1, pending: 1 });
    expect(r.sources.map((s) => [s.label, s.received, s.contacted, s.missed])).toEqual([
      ["Meta", 3, 1, 2],
      ["YouTube", 1, 0, 0],
    ]);
  });

  it("a lead assigned after Saturday's cutoff is received Saturday and judged Monday (carried in)", () => {
    const late = a("2026-11-14 16:00", "missed");
    expect(late.contactDueAt).toEqual(ist("2026-11-16 17:00"));
    const sat = buildLeadReport("2026-11-14", [late], []);
    expect(sat.totals).toMatchObject({ received: 1, dueLater: 1, contacted: 0, missed: 0, pending: 0 });
    const mon = buildLeadReport("2026-11-16", [late], []);
    expect(mon.totals).toMatchObject({ received: 0, carriedIn: 1, missed: 1 });
  });

  it("every lead lands in exactly one bucket: received + carriedIn = contacted + missed + pending + dueLater", () => {
    const rows = [
      a("2026-11-13 18:00", "contacted"), // Fri evening → carried into Saturday
      a("2026-11-14 09:00", "pending"),
      a("2026-11-14 10:00", "contacted_late"),
      a("2026-11-14 16:00", "pending"), // after Saturday's cutoff → Monday
    ];
    const { totals: t } = buildLeadReport("2026-11-14", rows, []);
    expect(t.received + t.carriedIn).toBe(t.contacted + t.missed + t.pending + t.dueLater);
    expect(t).toMatchObject({ received: 3, carriedIn: 1, dueLater: 1 });
  });

  it("reassignment moves the lead to the new BDE's Received (R6)", () => {
    const oldRow = a("2026-11-16 09:00", "reassigned");
    const newRow = a("2026-11-16 11:00", "pending");
    expect(buildLeadReport("2026-11-16", [oldRow], []).totals.received).toBe(0);
    expect(buildLeadReport("2026-11-16", [newRow], []).totals).toMatchObject({ received: 1, pending: 1 });
  });

  it("ignores assignments neither received nor due on the day", () => {
    expect(buildLeadReport("2026-11-16", [a("2026-11-10 09:00", "missed")], []).sources).toEqual([]);
  });

  it("counts the handovers given that day", () => {
    const r = buildLeadReport("2026-11-16", [], [
      { status: "created", isLate: false },
      { status: "created", isLate: true },
      { status: "duplicate", isLate: false },
      { status: "rejected", isLate: false },
      { status: "overdue", isLate: true },
      { status: "pending", isLate: false },
    ]);
    expect(r.handovers).toEqual({ given: 6, created: 2, duplicate: 1, rejected: 1, overdue: 1, pending: 1, late: 2 });
  });
});

describe("reportSource", () => {
  it("groups a lead created from a handover under its channel", () => {
    expect(reportSource({ sourceId: "src-walk", sourceLabel: "Walk-in" }, "walk_in")).toEqual({
      sourceKey: "handover:walk_in",
      sourceLabel: "Handover – Walk-in",
    });
    expect(reportSource({ sourceId: "src-meta", sourceLabel: "Meta" }, null)).toEqual({
      sourceKey: "src-meta",
      sourceLabel: "Meta",
    });
    expect(reportSource({ sourceId: null, sourceLabel: null }, null)).toEqual({ sourceKey: "none", sourceLabel: "No source" });
  });
});

describe("sumReports", () => {
  it("team totals equal the sum of the BDE rows", () => {
    const r1 = buildLeadReport("2026-11-16", [a("2026-11-16 09:00", "contacted"), a("2026-11-16 10:00", "missed")], [
      { status: "created", isLate: false },
    ]);
    const r2 = buildLeadReport("2026-11-16", [a("2026-11-16 11:00", "contacted_late", YT)], [
      { status: "overdue", isLate: true },
    ]);
    const sum = sumReports([r1, r2]);
    expect(sum.totals).toEqual({ received: 3, carriedIn: 0, dueLater: 0, contacted: 1, missed: 2, late: 1, pending: 0 });
    expect(sum.handovers).toMatchObject({ given: 2, created: 1, overdue: 1, late: 1 });
  });
});

describe("leadReportShareText", () => {
  it("matches the team's WhatsApp format, listing only sources with leads", () => {
    const r = buildLeadReport(
      "2026-11-16",
      [
        a("2026-11-16 09:00", "contacted"),
        a("2026-11-16 10:00", "contacted"),
        a("2026-11-16 11:00", "missed"),
        a("2026-11-16 12:00", "contacted", { sourceKey: "handover:walk_in", sourceLabel: "Handover – Walk-in" }),
      ],
      [{ status: "created", isLate: false }, { status: "overdue", isLate: true }],
    );
    expect(leadReportShareText(r, "Test BDE")).toBe(
      [
        "Today Assigned Leads – Test BDE (16 Nov)",
        "",
        "Meta",
        "Received: 3 | Contacted: 2 | Missed: 1",
        "",
        "Handover – Walk-in",
        "Received: 1 | Contacted: 1 | Missed: 0",
        "",
        "Handovers",
        "Given: 2 | Created: 1 | Overdue: 1",
      ].join("\n"),
    );
  });

  it("adds carried-in, pending and next-day counts only when there are some", () => {
    const r = buildLeadReport("2026-11-14", [a("2026-11-13 18:00", "pending"), a("2026-11-14 16:00", "pending")], []);
    expect(leadReportShareText(r, "Test BDE").split("\n")[3]).toBe(
      "Received: 1 | Contacted: 0 | Missed: 0 | Carried in: 1 | Pending: 1 | Due next working day: 1",
    );
  });

  it("formats the day as DD Mon", () => {
    expect(shortDay("2026-11-05")).toBe("05 Nov");
  });
});
