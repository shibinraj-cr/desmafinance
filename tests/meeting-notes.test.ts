import { describe, expect, it } from "vitest";
import {
  MeetingInputSchema,
  OwnerActionUpdateSchema,
  actionState,
  isReminderDue,
  ownerLabel,
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
    sharedWith: [],
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
            { id: "1", text: "undated", owner: null, ownerUserId: null, ownerName: null, dueOn: null, done: false },
            { id: "2", text: "later", owner: null, ownerUserId: null, ownerName: null, dueOn: "2026-10-20", done: false },
            { id: "3", text: "finished", owner: null, ownerUserId: null, ownerName: null, dueOn: "2026-09-01", done: true },
          ],
        }),
        meeting({
          id: "b",
          title: "Board",
          actions: [{ id: "4", text: "overdue", owner: "CFO", ownerUserId: null, ownerName: null, dueOn: "2026-10-01", done: false }],
        }),
      ],
      "2026-10-05",
    );
    expect(rows.map((r) => r.id)).toEqual(["4", "2", "1"]);
    expect(rows[0]).toMatchObject({ meetingId: "b", meetingTitle: "Board", state: "overdue" });
  });
});

describe("meetingMatches", () => {
  const m = meeting({ actions: [{ id: "1", text: "Send report", owner: "Ops lead", ownerUserId: null, ownerName: null, dueOn: null, done: false }] });
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

describe("isReminderDue", () => {
  const today = "2026-10-05";
  const item = (over: Partial<{ done: boolean; dueOn: string | null; snoozedUntil: string | null }>) => ({
    done: false,
    dueOn: today,
    snoozedUntil: null,
    ...over,
  });
  it("pops up from the due date until updated", () => {
    expect(isReminderDue(item({}), today)).toBe(true);
    expect(isReminderDue(item({ dueOn: "2026-10-01" }), today)).toBe(true); // overdue keeps asking
    expect(isReminderDue(item({ dueOn: "2026-10-06" }), today)).toBe(false); // not yet
    expect(isReminderDue(item({ dueOn: null }), today)).toBe(false); // undated never pops
    expect(isReminderDue(item({ done: true }), today)).toBe(false);
  });
  it("respects remind-me-tomorrow", () => {
    expect(isReminderDue(item({ snoozedUntil: "2026-10-06" }), today)).toBe(false);
    expect(isReminderDue(item({ snoozedUntil: "2026-10-06" }), "2026-10-06")).toBe(true);
  });
});

describe("OwnerActionUpdateSchema", () => {
  it("accepts the four owner actions and needs a date to reschedule", () => {
    for (const action of ["done", "reopen", "snooze"]) {
      expect(OwnerActionUpdateSchema.parse({ action })).toEqual({ action });
    }
    expect(OwnerActionUpdateSchema.parse({ action: "reschedule", dueOn: "2026-10-09" })).toMatchObject({
      dueOn: "2026-10-09",
    });
    expect(() => OwnerActionUpdateSchema.parse({ action: "reschedule" })).toThrow();
    expect(() => OwnerActionUpdateSchema.parse({ action: "delete" })).toThrow();
  });
});

describe("ownerLabel", () => {
  it("prefers the linked login over free text", () => {
    expect(ownerLabel({ owner: "Typed", ownerName: "login1" })).toBe("login1");
    expect(ownerLabel({ owner: "Typed", ownerName: null })).toBe("Typed");
    expect(ownerLabel({ owner: null, ownerName: null })).toBeNull();
  });
});

describe("sharing with edit access", () => {
  it("defaults editors to none", () => {
    expect(MeetingInputSchema.parse({ title: "x", meetingOn: "2026-10-05" }).editors).toEqual([]);
  });
});
