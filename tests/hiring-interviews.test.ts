import { describe, it, expect } from "vitest";
import {
  averageVerdict,
  nudgesDue,
  istDayBounds,
  buildIcs,
  escapeIcs,
  icsStamp,
} from "@/lib/hiring/interviews";
import { weightedTotal } from "@/lib/hiring/ai/score";

describe("panel verdicts as one number", () => {
  it("maps the four verdicts evenly across 0-100", () => {
    expect(averageVerdict(["strong_no"])).toBe(0);
    expect(averageVerdict(["strong_yes"])).toBe(100);
    expect(averageVerdict(["no", "yes"])).toBe(50);
  });

  it("is null when nobody has scored", () => {
    expect(averageVerdict([])).toBeNull();
  });

  it("ignores a verdict it does not recognise rather than scoring it zero", () => {
    expect(averageVerdict(["strong_yes", "maybe"])).toBe(100);
  });
});

describe("weighted rubric total", () => {
  it("turns 1-4 per criterion into a score out of 100", () => {
    const breakdown = [
      { criterion: "Skills", weight: 40, score: 4, evidence: "x" },
      { criterion: "Experience", weight: 25, score: 3, evidence: "x" },
      { criterion: "Communication", weight: 20, score: 2, evidence: "x" },
      { criterion: "Culture", weight: 15, score: 1, evidence: "x" },
    ];
    // 40 + 18.75 + 10 + 3.75 = 72.5 → 73
    expect(weightedTotal(breakdown)).toBe(73);
  });

  it("floors at 25, not 0 — 'no evidence' is the bottom of the scale, not a certainty", () => {
    const all1 = [
      { criterion: "A", weight: 50, score: 1, evidence: "x" },
      { criterion: "B", weight: 50, score: 1, evidence: "x" },
    ];
    expect(weightedTotal(all1)).toBe(25);
  });

  it("tops out at 100", () => {
    expect(
      weightedTotal([{ criterion: "A", weight: 100, score: 4, evidence: "x" }]),
    ).toBe(100);
  });

  it("changes when the weights change — the same scores, re-ranked", () => {
    const scores = [
      { criterion: "A", score: 4, evidence: "x" },
      { criterion: "B", score: 1, evidence: "x" },
    ];
    const skillsHeavy = weightedTotal([
      { ...scores[0]!, weight: 80 },
      { ...scores[1]!, weight: 20 },
    ]);
    const cultureHeavy = weightedTotal([
      { ...scores[0]!, weight: 20 },
      { ...scores[1]!, weight: 80 },
    ]);
    expect(skillsHeavy).toBeGreaterThan(cultureHeavy);
  });
});

describe("scorecard nudges", () => {
  const now = new Date("2026-09-10T12:00:00Z");
  const base = {
    id: "i1",
    durationMin: 30,
    status: "completed",
    nudged2hAt: null,
    nudged24hAt: null,
    panel: ["u1", "u2"],
    scorecards: [] as { reviewerId: string }[],
  };
  const endedHoursAgo = (h: number) =>
    new Date(now.getTime() - h * 3_600_000 - 30 * 60_000);

  it("sends the 2h nudge once the window opens", () => {
    const due = nudgesDue([{ ...base, scheduledAt: endedHoursAgo(3) }], now);
    expect(due).toEqual([{ interviewId: "i1", window: "2h", reviewerIds: ["u1", "u2"] }]);
  });

  it("does not nudge before two hours have passed", () => {
    expect(nudgesDue([{ ...base, scheduledAt: endedHoursAgo(1) }], now)).toEqual([]);
  });

  it("sends the 24h nudge after a day, not a second 2h one", () => {
    const due = nudgesDue([{ ...base, scheduledAt: endedHoursAgo(25), nudged2hAt: now }], now);
    expect(due[0]!.window).toBe("24h");
  });

  it("never sends the same nudge twice", () => {
    expect(nudgesDue([{ ...base, scheduledAt: endedHoursAgo(3), nudged2hAt: now }], now)).toEqual([]);
    expect(
      nudgesDue([{ ...base, scheduledAt: endedHoursAgo(30), nudged24hAt: now }], now),
    ).toEqual([]);
  });

  it("skips a stale 2h nudge once a day has passed", () => {
    // Past 24h with no 2h nudge sent, the 24h one is the right message.
    const due = nudgesDue([{ ...base, scheduledAt: endedHoursAgo(40) }], now);
    expect(due[0]!.window).toBe("24h");
  });

  it("only chases the panel members who have not filed", () => {
    const due = nudgesDue(
      [{ ...base, scheduledAt: endedHoursAgo(3), scorecards: [{ reviewerId: "u1" }] }],
      now,
    );
    expect(due[0]!.reviewerIds).toEqual(["u2"]);
  });

  it("stops once everyone has filed", () => {
    const due = nudgesDue(
      [
        {
          ...base,
          scheduledAt: endedHoursAgo(3),
          scorecards: [{ reviewerId: "u1" }, { reviewerId: "u2" }],
        },
      ],
      now,
    );
    expect(due).toEqual([]);
  });

  it("never chases a cancelled or still-scheduled interview", () => {
    for (const status of ["cancelled", "scheduled", "no_show"]) {
      expect(nudgesDue([{ ...base, status, scheduledAt: endedHoursAgo(5) }], now)).toEqual([]);
    }
  });
});

describe("IST day bounds", () => {
  it("starts the day at 18:30 UTC the evening before", () => {
    const { start, end } = istDayBounds(new Date("2026-09-10T12:00:00Z"));
    expect(start.toISOString()).toBe("2026-09-09T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-09-10T18:30:00.000Z");
  });

  it("puts 20:00 UTC into the NEXT IST day", () => {
    // 20:00 UTC on the 9th is 01:30 IST on the 10th.
    const { start } = istDayBounds(new Date("2026-09-09T20:00:00Z"));
    expect(start.toISOString()).toBe("2026-09-09T18:30:00.000Z");
  });
});

describe("calendar feed", () => {
  const event = {
    uid: "hiring-1@desgro.in",
    start: new Date("2026-09-10T09:00:00Z"),
    end: new Date("2026-09-10T09:30:00Z"),
    summary: "Phone screen: Anu",
    description: "BDE\nMode: phone",
    location: null,
    status: "scheduled",
  };

  it("emits a valid-looking VCALENDAR", () => {
    const ics = buildIcs([event], "Test");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("DTSTART:20260910T090000Z");
    expect(ics).toContain("DTEND:20260910T093000Z");
    expect(ics).toContain("SUMMARY:Phone screen: Anu");
  });

  it("publishes a cancelled interview as CANCELLED rather than dropping it", () => {
    const ics = buildIcs([{ ...event, status: "cancelled" }], "Test");
    expect(ics).toContain("STATUS:CANCELLED");
  });

  it("marks everything else CONFIRMED", () => {
    expect(buildIcs([event], "Test")).toContain("STATUS:CONFIRMED");
  });

  it("escapes the characters iCalendar treats as structure", () => {
    expect(escapeIcs("a,b;c\nd")).toBe("a\\,b\\;c\\nd");
    expect(escapeIcs("back\\slash")).toBe("back\\\\slash");
  });

  it("uses CRLF line endings, which calendar clients require", () => {
    expect(buildIcs([event], "Test")).toContain("\r\n");
  });

  it("stamps times as UTC basic format", () => {
    expect(icsStamp(new Date("2026-09-10T09:00:00.000Z"))).toBe("20260910T090000Z");
  });

  it("renders an empty feed rather than failing", () => {
    const ics = buildIcs([], "Empty");
    expect(ics).toContain("X-WR-CALNAME:Empty");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
