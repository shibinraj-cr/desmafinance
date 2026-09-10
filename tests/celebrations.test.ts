import { describe, it, expect } from "vitest";
import { istToday, isLeapYear } from "@/lib/dates";
import {
  fallsOnDay,
  renderGreeting,
  CELEBRATION_DEFAULTS,
  type Celebration,
} from "@/lib/celebrations";

/** A stored `@db.Date` — Prisma hands these back at UTC midnight. */
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const day = (year: number, month: number, dayOfMonth: number) => ({ year, month, day: dayOfMonth });

describe("istToday", () => {
  it("is the same calendar day as UTC once the office is awake", () => {
    expect(istToday(new Date("2026-09-08T09:00:00Z"))).toEqual(day(2026, 9, 8));
  });

  it("has already rolled over while UTC is still on the previous day", () => {
    // 18:45 UTC is 00:15 the next morning in India. A UTC-based 'today' would
    // still be showing yesterday's birthdays to people looking at the screen.
    expect(istToday(new Date("2026-09-08T18:45:00Z"))).toEqual(day(2026, 9, 9));
  });

  it("does not roll over early in the UTC morning", () => {
    // 00:30 UTC is 06:00 IST — same date, and the boundary a naive
    // getUTCDate() would get right by accident for most of the working day.
    expect(istToday(new Date("2026-09-08T00:30:00Z"))).toEqual(day(2026, 9, 8));
  });

  it("crosses month and year boundaries", () => {
    expect(istToday(new Date("2026-12-31T19:00:00Z"))).toEqual(day(2027, 1, 1));
  });
});

describe("isLeapYear", () => {
  it("follows the Gregorian rule, including the century exceptions", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });
});

describe("fallsOnDay", () => {
  it("matches on month and day, ignoring the year", () => {
    expect(fallsOnDay(d("1991-09-08"), day(2026, 9, 8))).toBe(true);
  });

  it("does not match a different day", () => {
    expect(fallsOnDay(d("1991-09-08"), day(2026, 9, 7))).toBe(false);
    expect(fallsOnDay(d("1991-08-08"), day(2026, 9, 8))).toBe(false);
  });

  it("celebrates a 29 February birthday on the 28th in a non-leap year", () => {
    expect(fallsOnDay(d("1992-02-29"), day(2026, 2, 28))).toBe(true);
  });

  it("leaves 29 February alone in a leap year, so it is not celebrated twice", () => {
    expect(fallsOnDay(d("1992-02-29"), day(2024, 2, 28))).toBe(false);
    expect(fallsOnDay(d("1992-02-29"), day(2024, 2, 29))).toBe(true);
  });

  it("does not push a 29 February birthday into March", () => {
    expect(fallsOnDay(d("1992-02-29"), day(2026, 3, 1))).toBe(false);
  });

  it("does not sweep an ordinary 28 February birthday into the leap-day rule", () => {
    // The rule is one-directional: 29 Feb falls back to the 28th, but a real
    // 28 Feb birthday must never also fire on the 29th.
    expect(fallsOnDay(d("1991-02-28"), day(2024, 2, 29))).toBe(false);
    expect(fallsOnDay(d("1991-02-28"), day(2026, 2, 28))).toBe(true);
  });
});

describe("a work anniversary lands on the joining date itself", () => {
  // The stated requirement, pinned: joined 9 September, wished on 9 September.
  // Worth its own block because the two halves are independently correct and
  // still wrong together if the timezone anchor ever slips — fallsOnDay only
  // compares month and day, so everything rests on which day istToday reports.
  const joined = d("2021-09-09");

  it("stays quiet on the 8th", () => {
    expect(fallsOnDay(joined, istToday(new Date("2026-09-08T09:00:00Z")))).toBe(false);
  });

  it("fires for the whole of the 9th in India", () => {
    const throughTheDay = [
      "2026-09-08T18:35:00Z", // 00:05 IST — the 9th in India, still the 8th in UTC
      "2026-09-09T03:30:00Z", // 09:00 IST — people arriving
      "2026-09-09T13:00:00Z", // 18:30 IST — end of day
      "2026-09-09T18:25:00Z", // 23:55 IST — last minute of the 9th
    ];
    for (const at of throughTheDay) {
      expect(fallsOnDay(joined, istToday(new Date(at)))).toBe(true);
    }
  });

  it("stops once it is the 10th in India", () => {
    expect(fallsOnDay(joined, istToday(new Date("2026-09-09T18:35:00Z")))).toBe(false);
  });
});

describe("renderGreeting", () => {
  const base: Celebration = {
    employeeId: "e1",
    kind: "birthday",
    name: "Asha Nair",
    firstName: "Asha",
    department: "Marketing",
    photoUrl: null,
    userId: "u1",
    age: 30,
    years: null,
    year: 2026,
  };

  it("addresses a birthday by first name and signs off as the company", () => {
    const out = renderGreeting(base, CELEBRATION_DEFAULTS);
    expect(out).toContain("Asha");
    expect(out).toContain("Team DESMA");
    // DesGro is the ERP, not the sender.
    expect(out).not.toContain("DESGRO");
  });

  it("uses the anniversary wording, and can fill the year count into it", () => {
    const anniversary = { ...base, kind: "anniversary" as const, age: null, years: 5 };
    // The shipped default leaves the count to the heading, so it must not
    // silently leak an unsubstituted placeholder into the card.
    const shipped = renderGreeting(anniversary, CELEBRATION_DEFAULTS);
    expect(shipped).toContain("Asha");
    expect(shipped).not.toContain("{{");
    // HR can still put the count in the sentence if they want it there.
    const custom = renderGreeting(anniversary, {
      ...CELEBRATION_DEFAULTS,
      anniversaryTemplate: "{{years}} years, {{name}}!",
    });
    expect(custom).toBe("5 years, Asha!");
  });

  it("uses the matching template for each kind", () => {
    const settings = {
      ...CELEBRATION_DEFAULTS,
      template: "B:{{name}}",
      anniversaryTemplate: "A:{{name}}:{{years}}",
    };
    expect(renderGreeting(base, settings)).toBe("B:Asha");
    expect(renderGreeting({ ...base, kind: "anniversary", years: 3 }, settings)).toBe("A:Asha:3");
  });

  it("substitutes department and full name, and blanks a department it does not have", () => {
    const settings = { ...CELEBRATION_DEFAULTS, template: "{{fullName}}|{{dept}}" };
    expect(renderGreeting(base, settings)).toBe("Asha Nair|Marketing");
    expect(renderGreeting({ ...base, department: null }, settings)).toBe("Asha Nair|");
  });

  it("leaves an unknown placeholder alone rather than blanking it", () => {
    const settings = { ...CELEBRATION_DEFAULTS, template: "{{name}} {{nickname}}" };
    expect(renderGreeting(base, settings)).toBe("Asha {{nickname}}");
  });
});
