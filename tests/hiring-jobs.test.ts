import { describe, it, expect } from "vitest";
import { buildJobWhere, jobsToCsv, agingCutoff, JOB_TABS } from "@/lib/hiring/jobs";
import { JOB_AGING_DAYS } from "@/lib/hiring/constants";
import { dedupeChips } from "@/lib/hiring/ai/job-description";

describe("job list filters", () => {
  it("always hides soft-deleted reqs, on every tab", () => {
    for (const tab of JOB_TABS) {
      expect(buildJobWhere({ tab }).deletedAt).toBeNull();
    }
  });

  it("counts a req awaiting approval as a draft — it still needs its author", () => {
    expect(buildJobWhere({ tab: "drafts" }).status).toEqual({
      in: ["draft", "pending_approval"],
    });
  });

  it("scopes aging to live reqs published before the cutoff", () => {
    const where = buildJobWhere({ tab: "aging" });
    expect(where.status).toBe("live");
    const cutoff = (where.publishedAt as { lt: Date }).lt;
    const days = (Date.now() - cutoff.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(JOB_AGING_DAYS);
  });

  it("ignores an unknown tab rather than returning nothing", () => {
    const where = buildJobWhere({ tab: "nonsense" });
    expect(where.status).toBeUndefined();
  });

  it("searches title and department case-insensitively", () => {
    const where = buildJobWhere({ q: " bde " });
    expect(where.OR).toEqual([
      { title: { contains: "bde", mode: "insensitive" } },
      { department: { contains: "bde", mode: "insensitive" } },
    ]);
  });

  it("ignores a blank search", () => {
    expect(buildJobWhere({ q: "   " }).OR).toBeUndefined();
  });

  it("puts the aging cutoff 21 days back", () => {
    const now = new Date("2026-09-04T00:00:00Z");
    expect(agingCutoff(now).toISOString()).toBe("2026-08-14T00:00:00.000Z");
  });
});

describe("jobs CSV export", () => {
  const row = {
    title: "BDE",
    department: "Sales",
    locationName: "Kochi",
    workType: "onsite",
    seniority: "junior",
    openings: 3,
    status: "live",
    ownerName: "asha",
    applicantCount: 12,
    daysOpen: 26,
    isAging: true,
    compLabel: "₹3–4.5 LPA",
    publishedAt: "2026-08-09T00:00:00.000Z",
  } as Parameters<typeof jobsToCsv>[0][number];

  it("writes a header and a row", () => {
    const csv = jobsToCsv([row]);
    const [head, body] = csv.split("\r\n");
    expect(head).toContain("Title,Department");
    expect(body).toContain("BDE,Sales,Kochi");
  });

  it("quotes a value containing a comma", () => {
    const csv = jobsToCsv([{ ...row, title: "BDE, Senior" }]);
    expect(csv).toContain('"BDE, Senior"');
  });

  it("escapes embedded quotes by doubling them", () => {
    const csv = jobsToCsv([{ ...row, title: 'The "good" one' }]);
    expect(csv).toContain('"The ""good"" one"');
  });

  it("defuses a leading = so Excel does not run it as a formula", () => {
    const csv = jobsToCsv([{ ...row, title: "=1+1" }]);
    expect(csv).toContain("'=1+1");
    expect(csv).not.toMatch(/(^|,)=1\+1/);
  });

  it("defuses the other formula-trigger characters too", () => {
    for (const prefix of ["+", "-", "@"]) {
      expect(jobsToCsv([{ ...row, ownerName: `${prefix}cmd` }])).toContain(`'${prefix}cmd`);
    }
  });

  it("renders an empty export as just the header", () => {
    expect(jobsToCsv([]).split("\r\n")).toHaveLength(1);
  });
});

describe("AI chip lists", () => {
  it("trims, drops blanks and folds case-insensitive duplicates", () => {
    expect(dedupeChips([" Malayalam ", "malayalam", "", "  ", "Hindi"])).toEqual([
      "Malayalam",
      "Hindi",
    ]);
  });

  it("collapses runs of whitespace inside a chip", () => {
    expect(dedupeChips(["2   years   sales"])).toEqual(["2 years sales"]);
  });

  it("caps the list so a runaway model cannot flood the form", () => {
    expect(dedupeChips(Array.from({ length: 40 }, (_, i) => `chip ${i}`))).toHaveLength(12);
  });
});
