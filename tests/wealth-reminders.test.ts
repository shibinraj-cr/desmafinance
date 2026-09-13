import { describe, it, expect } from "vitest";
import {
  addMonthsClamped,
  annualisedContribution,
  bucketFor,
  daysInMonth,
  daysUntil,
  groupByBucket,
  nextDueOn,
  occurrencesBetween,
  remindersToRaise,
  type ReminderLike,
} from "../src/lib/wealth-reminders";

// Dates are the whole point of this module, so every case pins an explicit
// "today" rather than leaning on the clock. Amounts are round and synthetic —
// the real ones live in the database, and this repo is public.

describe("addMonthsClamped", () => {
  it("keeps the day of month when the target month is long enough", () => {
    expect(addMonthsClamped("2026-01-10", 1)).toBe("2026-02-10");
    expect(addMonthsClamped("2026-01-10", 12)).toBe("2027-01-10");
  });

  it("clamps into a short month instead of spilling into the next one", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-03-31", 1)).toBe("2026-04-30");
  });

  it("uses 29 February in a leap year", () => {
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it("steps backwards across a year boundary", () => {
    expect(addMonthsClamped("2026-01-15", -2)).toBe("2025-11-15");
  });
});

describe("nextDueOn — monthly", () => {
  const sip = { frequency: "monthly" as const, dueDayOfMonth: 20 };

  it("returns this month's date when it is still ahead", () => {
    expect(nextDueOn(sip, "2026-09-13")).toBe("2026-09-20");
  });

  it("returns today when the due day is today", () => {
    expect(nextDueOn(sip, "2026-09-20")).toBe("2026-09-20");
  });

  it("rolls to next month once the date has passed", () => {
    expect(nextDueOn(sip, "2026-09-21")).toBe("2026-10-20");
  });

  it("clamps a 31st schedule into February and recovers in March", () => {
    const monthEnd = { frequency: "monthly" as const, dueDayOfMonth: 31 };
    expect(nextDueOn(monthEnd, "2026-02-01")).toBe("2026-02-28");
    // The key regression: the March occurrence must come back to the 31st, not
    // stay stuck on the 28th, which is what iterative stepping would do.
    expect(nextDueOn(monthEnd, "2026-03-01")).toBe("2026-03-31");
  });

  it("returns null without a day of month or an anchor", () => {
    expect(nextDueOn({ frequency: "monthly" }, "2026-09-13")).toBeNull();
    expect(nextDueOn({ frequency: "monthly", dueDayOfMonth: 0 }, "2026-09-13")).toBeNull();
    expect(nextDueOn({ frequency: "monthly", dueDayOfMonth: 32 }, "2026-09-13")).toBeNull();
  });
});

describe("nextDueOn — anchored cycles", () => {
  const yearly = { frequency: "yearly" as const, renewalOn: "2026-10-10" };

  it("finds this year's renewal when it is still ahead", () => {
    expect(nextDueOn(yearly, "2026-09-13")).toBe("2026-10-10");
  });

  it("rolls to the next year once it has passed", () => {
    expect(nextDueOn(yearly, "2026-10-11")).toBe("2027-10-10");
  });

  it("catches up from an anchor years in the past", () => {
    const old = { frequency: "yearly" as const, renewalOn: "2019-07-01" };
    expect(nextDueOn(old, "2026-09-13")).toBe("2027-07-01");
  });

  it("steps a three-yearly policy by three years", () => {
    const health = { frequency: "three_yearly" as const, renewalOn: "2026-08-30" };
    expect(nextDueOn(health, "2026-08-01")).toBe("2026-08-30");
    expect(nextDueOn(health, "2026-09-13")).toBe("2029-08-30");
  });

  it("steps a quarterly cycle by three months", () => {
    const q = { frequency: "quarterly" as const, renewalOn: "2026-01-15" };
    expect(nextDueOn(q, "2026-09-13")).toBe("2026-10-15");
  });

  it("returns a one-time date only while it is still ahead", () => {
    const once = { frequency: "one_time" as const, renewalOn: "2026-11-01" };
    expect(nextDueOn(once, "2026-09-13")).toBe("2026-11-01");
    expect(nextDueOn(once, "2026-11-02")).toBeNull();
  });

  it("returns null for an unscheduled holding", () => {
    expect(nextDueOn({ frequency: "none" }, "2026-09-13")).toBeNull();
    expect(nextDueOn({ frequency: "yearly" }, "2026-09-13")).toBeNull();
  });
});

describe("occurrencesBetween", () => {
  it("lists every monthly occurrence in the window", () => {
    const sip = { frequency: "monthly" as const, dueDayOfMonth: 2 };
    expect(occurrencesBetween(sip, "2026-09-13", "2026-12-31")).toEqual([
      "2026-10-02",
      "2026-11-02",
      "2026-12-02",
    ]);
  });

  it("emits an annual renewal once per year", () => {
    const yearly = { frequency: "yearly" as const, renewalOn: "2026-10-10" };
    expect(occurrencesBetween(yearly, "2026-09-13", "2028-01-01")).toEqual([
      "2026-10-10",
      "2027-10-10",
    ]);
  });

  it("emits a one-time date exactly once", () => {
    const once = { frequency: "one_time" as const, renewalOn: "2026-10-01" };
    expect(occurrencesBetween(once, "2026-09-13", "2027-12-31")).toEqual(["2026-10-01"]);
  });

  it("returns nothing when the window closes before the first occurrence", () => {
    const sip = { frequency: "monthly" as const, dueDayOfMonth: 20 };
    expect(occurrencesBetween(sip, "2026-09-01", "2026-09-19")).toEqual([]);
  });

  it("respects the cap so a schedule can never run away", () => {
    const sip = { frequency: "monthly" as const, dueDayOfMonth: 1 };
    expect(occurrencesBetween(sip, "2026-01-01", "2099-01-01", 5)).toHaveLength(5);
  });
});

describe("bucketFor / daysUntil", () => {
  it("calls a past date overdue regardless of lead time", () => {
    expect(bucketFor("2026-08-30", 3, "2026-09-13")).toBe("overdue");
    expect(bucketFor("2026-08-30", 60, "2026-09-13")).toBe("overdue");
  });

  it("opens the window exactly leadDays before the date", () => {
    expect(bucketFor("2026-09-20", 7, "2026-09-12")).toBe("upcoming");
    expect(bucketFor("2026-09-20", 7, "2026-09-13")).toBe("due_soon");
    expect(bucketFor("2026-09-20", 7, "2026-09-20")).toBe("due_soon");
  });

  it("gives a big renewal a long runway", () => {
    // Six weeks out, a ₹4.5L renewal should already be showing.
    expect(bucketFor("2026-10-10", 42, "2026-08-28")).toBe("upcoming");
    expect(bucketFor("2026-10-10", 42, "2026-08-29")).toBe("due_soon");
  });

  it("counts whole days in both directions", () => {
    expect(daysUntil("2026-09-20", "2026-09-13")).toBe(7);
    expect(daysUntil("2026-08-30", "2026-09-13")).toBe(-14);
    expect(daysUntil("2026-09-13", "2026-09-13")).toBe(0);
  });
});

describe("remindersToRaise", () => {
  const base = (over: Partial<ReminderLike>): ReminderLike => ({
    id: "r",
    dueOn: "2026-09-20",
    status: "open",
    amount: 1000,
    leadDays: 7,
    notifiedAt: null,
    ...over,
  });

  it("raises an overdue item and one inside its window", () => {
    const rows = [
      base({ id: "late", dueOn: "2026-08-30" }),
      base({ id: "soon", dueOn: "2026-09-18" }),
      base({ id: "later", dueOn: "2026-11-01" }),
    ];
    expect(remindersToRaise(rows, "2026-09-13").map((r) => r.id)).toEqual(["late", "soon"]);
  });

  it("never raises one twice", () => {
    const rows = [base({ id: "done", dueOn: "2026-08-30", notifiedAt: new Date() })];
    expect(remindersToRaise(rows, "2026-09-13")).toEqual([]);
  });

  it("ignores anything already settled", () => {
    const rows = [
      base({ id: "paid", dueOn: "2026-08-30", status: "paid" }),
      base({ id: "skipped", dueOn: "2026-08-30", status: "skipped" }),
    ];
    expect(remindersToRaise(rows, "2026-09-13")).toEqual([]);
  });
});

describe("groupByBucket", () => {
  it("sorts each band oldest first and drops settled rows", () => {
    const rows: ReminderLike[] = [
      { id: "c", dueOn: "2026-11-01", status: "open", amount: null, leadDays: 7 },
      { id: "a", dueOn: "2026-06-23", status: "open", amount: null, leadDays: 7 },
      { id: "b", dueOn: "2026-07-30", status: "open", amount: null, leadDays: 7 },
      { id: "x", dueOn: "2026-07-30", status: "paid", amount: null, leadDays: 7 },
      { id: "d", dueOn: "2026-09-18", status: "open", amount: null, leadDays: 7 },
    ];
    const g = groupByBucket(rows, "2026-09-13");
    expect(g.overdue.map((r) => r.id)).toEqual(["a", "b"]);
    expect(g.due_soon.map((r) => r.id)).toEqual(["d"]);
    expect(g.upcoming.map((r) => r.id)).toEqual(["c"]);
  });
});

describe("annualisedContribution", () => {
  it("normalises every frequency onto one year", () => {
    expect(annualisedContribution(1000, "monthly")).toBe(12000);
    expect(annualisedContribution(1000, "quarterly")).toBe(4000);
    expect(annualisedContribution(1000, "yearly")).toBe(1000);
    expect(annualisedContribution(3000, "three_yearly")).toBe(1000);
  });

  it("counts one-time and unscheduled money as no commitment", () => {
    expect(annualisedContribution(50000, "one_time")).toBe(0);
    expect(annualisedContribution(50000, "none")).toBe(0);
  });

  it("treats missing or non-positive amounts as zero", () => {
    expect(annualisedContribution(null, "monthly")).toBe(0);
    expect(annualisedContribution(0, "monthly")).toBe(0);
    expect(annualisedContribution(-100, "monthly")).toBe(0);
  });
});
