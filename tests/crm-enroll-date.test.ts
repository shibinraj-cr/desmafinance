import { describe, it, expect } from "vitest";
import {
  earliestEnrollDate,
  enrollDateMessage,
  enrollDateProblem,
  formatEnrollDate,
} from "@/lib/crm-enroll-date";

const bde = { canBackdate: false };
const supervisor = { canBackdate: true };

describe("earliestEnrollDate", () => {
  it("is the 1st of the current month after the first week", () => {
    expect(earliestEnrollDate("2026-11-17")).toBe("2026-11-01");
    expect(earliestEnrollDate("2026-11-08")).toBe("2026-11-01");
  });

  it("keeps the previous month open until the 7th", () => {
    expect(earliestEnrollDate("2026-11-01")).toBe("2026-10-01");
    expect(earliestEnrollDate("2026-11-07")).toBe("2026-10-01");
  });

  it("crosses the year boundary in January", () => {
    expect(earliestEnrollDate("2027-01-03")).toBe("2026-12-01");
  });
});

describe("enrollDateProblem", () => {
  it("refuses a future date for everyone, supervisors included", () => {
    expect(enrollDateProblem("2026-11-18", "2026-11-17", bde)).toBe("enroll_date_in_future");
    expect(enrollDateProblem("2026-11-18", "2026-11-17", supervisor)).toBe("enroll_date_in_future");
    // The July-dated-November case: 3 Nov typed on 13 Jul.
    expect(enrollDateProblem("2026-11-03", "2026-07-13", supervisor)).toBe("enroll_date_in_future");
  });

  it("accepts today and earlier days of this month", () => {
    expect(enrollDateProblem("2026-11-17", "2026-11-17", bde)).toBeNull();
    expect(enrollDateProblem("2026-11-01", "2026-11-17", bde)).toBeNull();
  });

  it("accepts last month's dates only during the first week", () => {
    expect(enrollDateProblem("2026-10-31", "2026-11-05", bde)).toBeNull();
    expect(enrollDateProblem("2026-10-31", "2026-11-17", bde)).toBe("enroll_date_too_old");
  });

  it("lets a supervisor date further back", () => {
    expect(enrollDateProblem("2026-03-11", "2026-11-17", bde)).toBe("enroll_date_too_old");
    expect(enrollDateProblem("2026-03-11", "2026-11-17", supervisor)).toBeNull();
  });
});

describe("messages", () => {
  it("formats dates the way the team reads them", () => {
    expect(formatEnrollDate("2026-11-01")).toBe("1 Nov 2026");
  });

  it("tells the BDE the earliest date and who can go further back", () => {
    expect(enrollDateMessage("enroll_date_too_old", "2026-11-17")).toContain("1 Nov 2026");
    expect(enrollDateMessage("enroll_date_too_old", "2026-11-17")).toContain("sales head");
    expect(enrollDateMessage("enroll_date_in_future", "2026-11-17")).toContain("future");
  });
});
