import { describe, it, expect } from "vitest";
import { istToday, isLeapYear } from "@/lib/dates";
import {
  fallsOnDay,
  renderGreeting,
  celebrationsInMonth,
  upcomingCelebrations,
  celebrationsToCsv,
  CELEBRATION_DEFAULTS,
  type Celebration,
  type Celebrant,
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

// ── Calendar ─────────────────────────────────────────────────────────

/** A celebrant with whichever dates the case needs. */
function person(name: string, dates: { dob?: string; joined?: string }): Celebrant {
  return {
    employeeId: `e-${name}`,
    empCode: `E${name.length}`,
    name,
    designation: "Executive",
    department: "Ops",
    photoUrl: null,
    dob: dates.dob ? d(dates.dob) : null,
    joinDate: dates.joined ? d(dates.joined) : null,
  };
}

const SEP_10 = new Date("2026-09-10T06:00:00Z"); // 11:30 IST

describe("celebrationsInMonth", () => {
  const roster = [
    person("Asha", { dob: "1996-09-13" }),
    person("Bina", { joined: "2025-09-09" }),
    person("Chandra", { dob: "1990-09-13", joined: "2019-09-25" }),
    person("Divya", { dob: "1994-11-02" }),
  ];

  it("carries birthdays and anniversaries together, in date order", () => {
    const out = celebrationsInMonth(roster, 9, 2026, SEP_10);
    expect(out.map((e) => [e.name, e.kind, e.monthDay])).toEqual([
      ["Bina", "anniversary", "09-09"],
      ["Asha", "birthday", "09-13"],
      ["Chandra", "birthday", "09-13"],
      ["Chandra", "anniversary", "09-25"],
    ]);
  });

  it("gives one person a row per occasion, not one row overall", () => {
    const out = celebrationsInMonth(roster, 9, 2026, SEP_10);
    expect(out.filter((e) => e.name === "Chandra")).toHaveLength(2);
  });

  it("counts the year against the month being viewed", () => {
    const out = celebrationsInMonth(roster, 9, 2026, SEP_10);
    expect(out.find((e) => e.name === "Bina")?.years).toBe(1);
    expect(out.find((e) => e.name === "Chandra" && e.kind === "anniversary")?.years).toBe(7);
    expect(out.find((e) => e.name === "Asha")?.age).toBe(30);
  });

  it("keeps a date that has already passed this month", () => {
    // The 9th is behind us on the 10th; a month view still has to show it.
    const bina = celebrationsInMonth(roster, 9, 2026, SEP_10).find((e) => e.name === "Bina");
    expect(bina?.delta).toBe(-1);
  });

  it("excludes other months", () => {
    expect(celebrationsInMonth(roster, 9, 2026, SEP_10).some((e) => e.name === "Divya")).toBe(false);
    expect(celebrationsInMonth(roster, 11, 2026, SEP_10).map((e) => e.name)).toEqual(["Divya"]);
  });

  it("leaves out the year somebody joined — a start date is not an anniversary", () => {
    const fresh = [person("Eshan", { joined: "2026-09-20" })];
    expect(celebrationsInMonth(fresh, 9, 2026, SEP_10)).toEqual([]);
    expect(celebrationsInMonth(fresh, 9, 2027, SEP_10)[0]?.years).toBe(1);
  });

  it("lists a 29 February date on the 28th in a non-leap year", () => {
    const leapling = [person("Farah", { dob: "1996-02-29" })];
    expect(celebrationsInMonth(leapling, 2, 2026, SEP_10)[0]?.monthDay).toBe("02-28");
    expect(celebrationsInMonth(leapling, 2, 2028, SEP_10)[0]?.monthDay).toBe("02-29");
  });
});

describe("upcomingCelebrations", () => {
  const roster = [
    person("Asha", { dob: "1996-09-13" }),
    person("Bina", { joined: "2025-09-09" }),
    person("Chandra", { joined: "2019-09-25" }),
  ];

  it("is ordered by how soon, and excludes what has already passed", () => {
    // On the 10th: Bina's 9 Sep is behind us, Asha's 13th is 3 days out, and
    // Chandra's 25th is 15 — just outside a fortnight.
    expect(upcomingCelebrations(roster, 20, SEP_10).map((e) => [e.name, e.delta])).toEqual([
      ["Asha", 3],
      ["Chandra", 15],
    ]);
  });

  it("respects the window", () => {
    expect(upcomingCelebrations(roster, 14, SEP_10).map((e) => e.name)).toEqual(["Asha"]);
    expect(upcomingCelebrations(roster, 30, SEP_10).map((e) => e.name)).toEqual([
      "Asha",
      "Chandra",
    ]);
  });

  it("includes today", () => {
    const out = upcomingCelebrations([person("Gita", { dob: "1990-09-10" })], 14, SEP_10);
    expect(out[0]?.delta).toBe(0);
  });

  it("wraps into next year, counting the year it will actually fall in", () => {
    const newYear = new Date("2026-12-28T06:00:00Z");
    const out = upcomingCelebrations([person("Hari", { joined: "2020-01-02" })], 14, newYear);
    expect(out[0]?.delta).toBe(5);
    // Five days away, in 2027 — so it is their seventh year, not their sixth.
    expect(out[0]?.years).toBe(7);
  });
});

describe("celebrationsToCsv", () => {
  it("names the occasion and quotes a name containing a comma", () => {
    const rows = celebrationsInMonth(
      [person("Iyer, Meena", { dob: "1996-09-13" }), person("Jaya", { joined: "2024-09-09" })],
      9,
      2026,
      SEP_10,
    );
    const csv = celebrationsToCsv(rows);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("Occasion");
    expect(csv).toContain("Work anniversary");
    expect(csv).toContain("Birthday");
    expect(csv).toContain('"Iyer, Meena"');
  });
});
