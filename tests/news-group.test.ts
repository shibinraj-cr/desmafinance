import { describe, it, expect } from "vitest";
import { dayKey, dayHeading, groupByDay } from "../src/lib/news/group";

/** Local-midnight ISO for a given offset in days from `base`. */
function daysAgo(base: Date, n: number, hour = 9): string {
  const d = new Date(base);
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

const NOW = new Date("2026-09-07T14:00:00");

describe("dayHeading", () => {
  it("names today and yesterday rather than dating them", () => {
    expect(dayHeading(daysAgo(NOW, 0), NOW)).toBe("Today");
    expect(dayHeading(daysAgo(NOW, 1), NOW)).toBe("Yesterday");
  });

  it("dates anything older", () => {
    const h = dayHeading(daysAgo(NOW, 3), NOW);
    expect(h).not.toBe("Today");
    expect(h).not.toBe("Yesterday");
    expect(h).toContain("2026");
  });

  it("groups an update from earlier the same day under Today", () => {
    // A briefing posted at 02:44 and read at 14:00 is still today's.
    expect(dayHeading(daysAgo(NOW, 0, 2), NOW)).toBe("Today");
  });

  it("does not crash on an unparseable date", () => {
    expect(dayHeading("not a date", NOW)).toBe("Undated");
    expect(dayKey("not a date")).toBe("unknown");
  });
});

describe("groupByDay", () => {
  const item = (iso: string, isPinned = false) => ({ publishedAt: iso, isPinned });

  it("puts each day in its own section, in the order given", () => {
    const items = [item(daysAgo(NOW, 0)), item(daysAgo(NOW, 1)), item(daysAgo(NOW, 1, 11))];
    const out = groupByDay(items, NOW);
    expect(out.map((s) => s.heading)).toEqual(["Today", "Yesterday"]);
    expect(out[1].items).toHaveLength(2);
  });

  it("holds pinned updates out in their own section above", () => {
    // The point of pinning is defeated if the item is filed under its own date.
    const items = [item(daysAgo(NOW, 0)), item(daysAgo(NOW, 30), true)];
    const out = groupByDay(items, NOW);
    expect(out[0].heading).toBe("Pinned");
    expect(out[0].items).toHaveLength(1);
    expect(out[1].heading).toBe("Today");
  });

  it("adds no Pinned section when nothing is pinned", () => {
    expect(groupByDay([item(daysAgo(NOW, 0))], NOW).map((s) => s.heading)).toEqual(["Today"]);
  });

  it("returns nothing for an empty feed", () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });

  it("keeps two updates from the same day together even at different hours", () => {
    const out = groupByDay([item(daysAgo(NOW, 2, 2)), item(daysAgo(NOW, 2, 23))], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].items).toHaveLength(2);
  });
});
