import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { teamReportSheets } from "@/lib/crm-lead-report-export";
import type { TeamLeadReport } from "@/lib/crm-lead-report-data";

const counts = (o: Partial<Record<string, number>> = {}) => ({
  received: 0, carriedIn: 0, dueLater: 0, contacted: 0, missed: 0, late: 0, pending: 0, ...o,
});
const hcounts = (o: Partial<Record<string, number>> = {}) => ({
  given: 0, created: 0, duplicate: 0, rejected: 0, overdue: 0, pending: 0, late: 0, ...o,
});

const report: TeamLeadReport = {
  day: "2026-11-16",
  cutoff: "2026-11-16T11:30:00.000Z",
  rows: [
    {
      userId: "u1",
      name: "BDE A",
      role: "l2",
      totals: counts({ received: 3, contacted: 2, missed: 1, late: 1 }),
      sources: [{ key: "s1", label: "Meta", ...counts({ received: 3, contacted: 2, missed: 1, late: 1 }) }],
      handovers: hcounts({ given: 1, created: 1 }),
      live: false,
      submission: { reportId: "r1", status: "submitted", locked: true, submittedAt: "2026-11-16T12:00:00.000Z" },
    },
    {
      userId: "u2",
      name: "BDE B",
      role: "l1",
      totals: counts({ received: 1, pending: 1 }),
      sources: [{ key: "none", label: "No source", ...counts({ received: 1, pending: 1 }) }],
      handovers: hcounts(),
      live: true,
      submission: null,
    },
  ],
  totals: counts({ received: 4, contacted: 2, missed: 1, late: 1, pending: 1 }),
  handoverTotals: hcounts({ given: 1, created: 1 }),
  missed: [
    {
      assignmentId: "a1",
      leadId: "l1",
      candidateName: "Lead One",
      bdeId: "u1",
      bdeName: "BDE A",
      sourceLabel: "Meta",
      assignedAt: "2026-11-16T05:00:00.000Z",
      dueAt: "2026-11-16T11:30:00.000Z",
      contactedLateAt: "2026-11-16T12:10:00.000Z",
    },
  ],
  handovers: [],
};

describe("teamReportSheets", () => {
  const sheets = teamReportSheets(report);

  it("has the four sheets", () => {
    expect(sheets.map((s) => s.name)).toEqual(["By BDE", "By source", "Missed leads", "Handovers"]);
  });

  it("By BDE ends with the team row, which matches the sum", () => {
    const rows = sheets[0].rows;
    expect(rows.map((r) => r.BDE)).toEqual(["BDE A", "BDE B", "Team"]);
    expect(rows[2]).toMatchObject({ Received: 4, Contacted: 2, Missed: 1, Pending: 1, Report: "1 / 2 generated" });
    expect(rows[0].Report).toBe("Generated");
    expect(rows[1].Report).toBe("Not generated yet");
  });

  it("By source has one line per BDE per source", () => {
    expect(sheets[1].rows).toEqual([
      expect.objectContaining({ BDE: "BDE A", Source: "Meta", Received: 3 }),
      expect.objectContaining({ BDE: "BDE B", Source: "No source", Pending: 1 }),
    ]);
  });

  it("missed leads show IST times", () => {
    expect(sheets[2].rows[0]).toMatchObject({ Lead: "Lead One", BDE: "BDE A" });
    expect(String(sheets[2].rows[0].Due)).toMatch(/5:00\s?pm/i);
    expect(String(sheets[2].rows[0]["Contacted late at"])).toMatch(/5:40\s?pm/i);
  });
});
