import { describe, it, expect } from "vitest";
import { orderPool, type OrderablePoolRow } from "@/lib/hiring/talent-pool";

const at = (iso: string) => new Date(iso);

function row(p: Partial<OrderablePoolRow> & { fullName: string }): OrderablePoolRow {
  return {
    nextTouchAt: null,
    updatedAt: at("2026-01-01T00:00:00Z"),
    createdAt: at("2026-01-01T00:00:00Z"),
    forJob: null,
    best: 0,
    ...p,
  };
}

describe("orderPool", () => {
  it("puts the best fit for the chosen job first", () => {
    const rows = [
      row({ fullName: "Low", forJob: 10, best: 90 }),
      row({ fullName: "High", forJob: 80, best: 80 }),
    ];
    expect(orderPool(rows, "fit", true).map((r) => r.fullName)).toEqual(["High", "Low"]);
  });

  it("falls back to the best fit across all roles when no job is chosen", () => {
    const rows = [
      row({ fullName: "Weak", forJob: 99, best: 5 }),
      row({ fullName: "Strong", forJob: 0, best: 70 }),
    ];
    expect(orderPool(rows, "fit", false).map((r) => r.fullName)).toEqual(["Strong", "Weak"]);
  });

  /**
   * A pool sorted by fit is mostly ties at 0% — a must-have worded so nothing
   * can evidence it scores everybody zero. Without a tie-break the order is
   * whatever the engine felt like, and the page appears to reshuffle itself.
   */
  it("breaks ties by name so a page of zeroes holds still", () => {
    const rows = [
      row({ fullName: "Zoe", forJob: 0 }),
      row({ fullName: "Adam", forJob: 0 }),
      row({ fullName: "Mia", forJob: 0 }),
    ];
    expect(orderPool(rows, "fit", true).map((r) => r.fullName)).toEqual(["Adam", "Mia", "Zoe"]);
  });

  it("sorts unscheduled follow-ups LAST, not first", () => {
    const rows = [
      row({ fullName: "Never", nextTouchAt: null }),
      row({ fullName: "Soon", nextTouchAt: at("2026-02-01T00:00:00Z") }),
    ];
    // A null date means "no follow-up planned" — treating it as 1970 would park
    // everyone never scheduled at the top as though they were overdue.
    expect(orderPool(rows, "due", false).map((r) => r.fullName)).toEqual(["Soon", "Never"]);
  });

  it("orders by newest first for 'recent'", () => {
    const rows = [
      row({ fullName: "Older", createdAt: at("2026-01-01T00:00:00Z") }),
      row({ fullName: "Newer", createdAt: at("2026-06-01T00:00:00Z") }),
    ];
    expect(orderPool(rows, "recent", false).map((r) => r.fullName)).toEqual(["Newer", "Older"]);
  });

  it("does not mutate the array it was given", () => {
    const rows = [row({ fullName: "B" }), row({ fullName: "A" })];
    const before = rows.map((r) => r.fullName);
    orderPool(rows, "name", false);
    expect(rows.map((r) => r.fullName)).toEqual(before);
  });
});
