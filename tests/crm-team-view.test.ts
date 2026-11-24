import { describe, it, expect, vi } from "vitest";

// crm-team-view imports the prisma-backed loaders; the helpers under test are pure.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { periodKey, activityPeriodOptions } from "@/lib/crm-team-view";
import { parsePeriod } from "@/lib/period";

describe("periodKey", () => {
  it("round-trips every preset through parsePeriod", () => {
    for (const v of ["all", "fy", "q1", "q4", "h2", "Nov-26", "Mar-27"]) {
      expect(periodKey(parsePeriod({ period: v }))).toBe(v);
    }
  });

  it("reports a custom range as custom", () => {
    expect(periodKey(parsePeriod({ period: "custom", from: "2026-11-01", to: "2026-11-10" }))).toBe("custom");
  });
});

describe("activityPeriodOptions", () => {
  it("lists months so far newest first, then the wider presets", () => {
    const values = activityPeriodOptions("2026-11-11").map((o) => o.value);
    expect(values).toEqual([
      "Nov-26",
      "Oct-26",
      "Sep-26",
      "Aug-26",
      "Jul-26",
      "Jun-26",
      "May-26",
      "Apr-26",
      "q1",
      "q2",
      "q3",
      "q4",
      "h1",
      "h2",
      "fy",
      "all",
    ]);
  });

  it("labels the wider presets as the web filter does", () => {
    const byValue = Object.fromEntries(activityPeriodOptions("2026-11-11").map((o) => [o.value, o.label]));
    expect(byValue.q3).toBe("Q3 (Oct-Dec)");
    expect(byValue.h1).toBe("H1 (Apr-Sep)");
    expect(byValue.fy).toBe("FY 2026-27");
    expect(byValue.all).toBe("All time");
  });

  it("offers every FY month once today is past the FY", () => {
    const months = activityPeriodOptions("2027-05-02").filter((o) => /-\d\d$/.test(o.value));
    expect(months).toHaveLength(12);
    expect(months[0].value).toBe("Mar-27");
  });
});
