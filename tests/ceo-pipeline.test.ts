import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { bucketPipeline } from "@/lib/ceo-dashboard";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const monthStart = d("2026-10-01");
const nextMonthStart = d("2026-11-01");

describe("bucketPipeline", () => {
  it("splits CRM pipeline leads into this month, later months and overdue", () => {
    const b = bucketPipeline(
      [
        { expectedValue: 50_000, expectedCloseDate: d("2026-10-01") }, // first day → this month
        { expectedValue: { toString: () => "25000.50" }, expectedCloseDate: d("2026-10-31") }, // last day → this month
        { expectedValue: 100_000, expectedCloseDate: d("2026-11-01") }, // next month → beyond
        { expectedValue: 70_000, expectedCloseDate: d("2027-02-15") }, // beyond
        { expectedValue: 40_000, expectedCloseDate: d("2026-09-30") }, // passed → overdue
        { expectedValue: null, expectedCloseDate: null }, // no deal date → overdue
      ],
      monthStart,
      nextMonthStart,
    );
    expect(b.current).toEqual({ value: 75_000.5, count: 2 });
    expect(b.beyond).toEqual({ value: 170_000, count: 2 });
    expect(b.overdue).toEqual({ value: 40_000, count: 2 });
  });

  it("is empty when no lead is in Pipeline", () => {
    const b = bucketPipeline([], monthStart, nextMonthStart);
    expect(b.current.count + b.beyond.count + b.overdue.count).toBe(0);
  });
});
