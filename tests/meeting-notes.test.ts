import { describe, expect, it } from "vitest";
import {
  MeetingInputSchema,
  actionState,
  blankToNull,
  meetingMatches,
  openActions,
  type MeetingRow,
} from "@/lib/meeting-notes-model";

function meeting(over: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: "m1",
    title: "Leadership review",
    meetingOn: "2026-10-01",
    kind: "leadership",
    attendees: "CEO, Finance lead",
    agenda: null,
    notes: "Discussed the Q3 collection gap.",
    decisions: "- Freeze discretionary spend",
    createdBy: null,
    updatedBy: null,
    updatedAt: "2026-10-01T10:00:00.000Z",
    actions: [],
    ...over,
  };
}

describe("actionState", () => {
  const today = "2026-10-05";
  it("classifies against the IST day", () => {
    expect(actionState({ done: true, dueOn: "2026-09-01" }, today)).toBe("done");
    expect(actionState({ done: false, dueOn: "2026-10-04" }, today)).toBe("overdue");
    expect(actionState({ done: false, dueOn: today }, today)).toBe("due_today");
    expect(actionState({ done: false, dueOn: "2026-10-06" }, today)).toBe("open");
    expect(actionState({ done: false, dueOn: null }, today)).toBe("open");
  });
});

describe("openActions", () => {
  it("drops done items and orders dated first, earliest first", () => {
    const rows = openActions(
      [
        meeting({
          id: "a",
          actions: [
            { id: "1", text: "undated", owner: null, dueOn: null, done: false },
            { id: "2", text: "later", owner: null, dueOn: "2026-10-20", done: false },
            { id: "3", text: "finished", owner: null, dueOn: "2026-09-01", done: true },
          ],
        }),
        meeting({
          id: "b",
          title: "Board",
          actions: [{ id: "4", text: "overdue", owner: "CFO", dueOn: "2026-10-01", done: false }],
        }),
      ],
      "2026-10-05",
    );
    expect(rows.map((r) => r.id)).toEqual(["4", "2", "1"]);
    expect(rows[0]).toMatchObject({ meetingId: "b", meetingTitle: "Board", state: "overdue" });
  });
});

describe("meetingMatches", () => {
  const m = meeting({ actions: [{ id: "1", text: "Send report", owner: "Ops lead", dueOn: null, done: false }] });
  it("matches every word across fields, case-insensitively", () => {
    expect(meetingMatches(m, "")).toBe(true);
    expect(meetingMatches(m, "collection")).toBe(true);
    expect(meetingMatches(m, "FREEZE spend")).toBe(true);
    expect(meetingMatches(m, "ops report")).toBe(true);
    expect(meetingMatches(m, "freeze hiring")).toBe(false);
  });
});

describe("MeetingInputSchema", () => {
  it("requires a title and a YYYY-MM-DD date and defaults the rest", () => {
    const ok = MeetingInputSchema.parse({ title: " Weekly ", meetingOn: "2026-10-05" });
    expect(ok).toMatchObject({ title: "Weekly", kind: "leadership", actions: [] });
    expect(() => MeetingInputSchema.parse({ title: "", meetingOn: "2026-10-05" })).toThrow();
    expect(() => MeetingInputSchema.parse({ title: "x", meetingOn: "05/10/2026" })).toThrow();
    expect(() =>
      MeetingInputSchema.parse({ title: "x", meetingOn: "2026-10-05", actions: [{ text: "  " }] }),
    ).toThrow();
  });
});

describe("blankToNull", () => {
  it("turns whitespace into null", () => {
    expect(blankToNull("  ")).toBeNull();
    expect(blankToNull(undefined)).toBeNull();
    expect(blankToNull(" a ")).toBe("a");
  });
});
