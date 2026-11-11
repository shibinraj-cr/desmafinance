import { describe, it, expect } from "vitest";
import {
  activityToContactEvent,
  contactHint,
  evaluateContact,
  planAssignmentSync,
  type AssignmentWindow,
  type ContactEvent,
  type LeadOwnerState,
} from "@/lib/crm-contact";
import { nextCutoff } from "@/lib/crm-cutoff";

// 2026-11-09 is a Monday.
const ist = (dateTime: string) => new Date(`${dateTime.replace(" ", "T")}:00+05:30`);
const BDE = "bde-1";
const OTHER = "bde-2";

function assignment(at: string, over: Partial<AssignmentWindow> = {}): AssignmentWindow {
  const assignedAt = ist(at);
  return { userId: BDE, assignedAt, contactDueAt: nextCutoff(assignedAt, new Set()), endedAt: null, ...over };
}
const ev = (kind: ContactEvent["kind"], at: string, over: Partial<ContactEvent> = {}): ContactEvent => ({
  kind,
  actorId: BDE,
  at: ist(at),
  ...over,
});
const beforeCutoff = ist("2026-11-09 16:00");
const afterCutoff = ist("2026-11-09 18:00");

describe("evaluateContact — the brief's acceptance cases", () => {
  const a = assignment("2026-11-09 10:00");

  it("call only → pending", () => {
    expect(evaluateContact(a, [ev("call", "2026-11-09 11:00")], beforeCutoff).status).toBe("pending");
  });

  it("call + note → contacted", () => {
    const v = evaluateContact(a, [ev("call", "2026-11-09 11:00"), ev("note", "2026-11-09 11:05")], beforeCutoff);
    expect(v.status).toBe("contacted");
    expect(v.firstContactedAt).toEqual(ist("2026-11-09 11:05"));
  });

  it("WhatsApp only → pending", () => {
    expect(evaluateContact(a, [ev("whatsapp", "2026-11-09 11:00")], beforeCutoff).status).toBe("pending");
  });

  it("WhatsApp + stage change → contacted", () => {
    const v = evaluateContact(a, [ev("stage", "2026-11-09 11:00"), ev("whatsapp", "2026-11-09 12:00")], beforeCutoff);
    expect(v.status).toBe("contacted");
    expect(v.firstContactedAt).toEqual(ist("2026-11-09 12:00"));
  });

  it("a note by a different user doesn't count", () => {
    const v = evaluateContact(
      a,
      [ev("call", "2026-11-09 11:00"), ev("note", "2026-11-09 11:05", { actorId: OTHER })],
      beforeCutoff,
    );
    expect(v.status).toBe("pending");
  });

  it("assigned 16:59, contacted 17:05 → contacted_late", () => {
    const late = assignment("2026-11-09 16:59");
    expect(late.contactDueAt).toEqual(ist("2026-11-09 17:00"));
    const v = evaluateContact(late, [ev("call", "2026-11-09 17:01"), ev("note", "2026-11-09 17:05")], afterCutoff);
    expect(v.status).toBe("contacted_late");
    expect(v.firstContactedAt).toEqual(ist("2026-11-09 17:05"));
  });
});

describe("evaluateContact — details", () => {
  const a = assignment("2026-11-09 10:00");

  it("the note typed in the call sheet completes the pair on its own", () => {
    const v = evaluateContact(a, [ev("call", "2026-11-09 11:00", { withNote: true })], beforeCutoff);
    expect(v.status).toBe("contacted");
    expect(v.firstContactedAt).toEqual(ist("2026-11-09 11:00"));
  });

  it("a note alone, or a stage change alone, is not contact", () => {
    expect(evaluateContact(a, [ev("note", "2026-11-09 11:00")], beforeCutoff).status).toBe("pending");
    expect(evaluateContact(a, [ev("stage", "2026-11-09 11:00")], beforeCutoff).status).toBe("pending");
  });

  it("mixed halves (call + stage, WhatsApp + note) are not a pair", () => {
    const v = evaluateContact(a, [ev("call", "2026-11-09 11:00"), ev("stage", "2026-11-09 11:01")], beforeCutoff);
    expect(v.status).toBe("pending");
    const w = evaluateContact(a, [ev("whatsapp", "2026-11-09 11:00"), ev("note", "2026-11-09 11:01")], beforeCutoff);
    expect(w.status).toBe("pending");
  });

  it("first contact is the earliest completed pair", () => {
    const v = evaluateContact(
      a,
      [
        ev("call", "2026-11-09 10:30"),
        ev("whatsapp", "2026-11-09 11:00"),
        ev("stage", "2026-11-09 11:10"),
        ev("note", "2026-11-09 14:00"),
      ],
      beforeCutoff,
    );
    expect(v.firstContactedAt).toEqual(ist("2026-11-09 11:10"));
  });

  it("actions before the assignment don't count", () => {
    const v = evaluateContact(a, [ev("call", "2026-11-09 09:00"), ev("note", "2026-11-09 11:00")], beforeCutoff);
    expect(v.status).toBe("pending");
  });

  it("contact exactly at the cutoff is on time", () => {
    const v = evaluateContact(a, [ev("call", "2026-11-09 16:00"), ev("note", "2026-11-09 17:00")], afterCutoff);
    expect(v.status).toBe("contacted");
  });

  it("uncontacted becomes missed once the cutoff passes", () => {
    expect(evaluateContact(a, [], ist("2026-11-09 17:00")).status).toBe("pending");
    expect(evaluateContact(a, [], ist("2026-11-09 17:01")).status).toBe("missed");
  });

  it("reports which halves are done, for the 'called, note missing' hint", () => {
    const v = evaluateContact(a, [ev("call", "2026-11-09 11:00"), ev("stage", "2026-11-09 11:01")], beforeCutoff);
    expect(v.halves).toEqual({ call: true, note: false, whatsapp: false, stage: true });
    const w = evaluateContact(a, [ev("call", "2026-11-09 11:00", { withNote: true })], beforeCutoff);
    expect(w.halves.note).toBe(true);
  });
});

describe("evaluateContact — the older rule (backfill of days before go-live)", () => {
  const a = assignment("2026-11-09 10:00");

  it("any single logged action counts — a stage change alone, a WhatsApp alone", () => {
    expect(evaluateContact(a, [ev("stage", "2026-11-09 12:00")], afterCutoff, "any")).toMatchObject({
      status: "contacted",
      firstContactedAt: ist("2026-11-09 12:00"),
    });
    expect(evaluateContact(a, [ev("whatsapp", "2026-11-09 18:00")], ist("2026-11-09 19:00"), "any").status).toBe("contacted_late");
  });

  it("still only the assigned BDE, after the assignment; nothing at all is still a miss", () => {
    expect(evaluateContact(a, [ev("stage", "2026-11-09 12:00", { actorId: OTHER })], afterCutoff, "any").status).toBe("missed");
    expect(evaluateContact(a, [ev("call", "2026-11-09 09:00")], afterCutoff, "any").status).toBe("missed");
    expect(evaluateContact(a, [], afterCutoff, "any").status).toBe("missed");
  });

  it("the default is still R1", () => {
    expect(evaluateContact(a, [ev("stage", "2026-11-09 12:00")], afterCutoff).status).toBe("missed");
  });
});

describe("evaluateContact — reassignment (R6)", () => {
  it("left before the cutoff, uncontacted → reassigned (on nobody's record)", () => {
    const a = assignment("2026-11-09 10:00", { endedAt: ist("2026-11-09 12:00") });
    expect(evaluateContact(a, [], afterCutoff).status).toBe("reassigned");
  });

  it("left after the cutoff, uncontacted → still missed for the first BDE", () => {
    const a = assignment("2026-11-09 10:00", { endedAt: ist("2026-11-10 09:00") });
    expect(evaluateContact(a, [], ist("2026-11-10 10:00")).status).toBe("missed");
  });

  it("the old BDE's actions after the lead left them don't count", () => {
    const a = assignment("2026-11-09 10:00", { endedAt: ist("2026-11-09 12:00") });
    const v = evaluateContact(a, [ev("call", "2026-11-09 13:00"), ev("note", "2026-11-09 13:05")], afterCutoff);
    expect(v.status).toBe("reassigned");
  });

  it("contacted before being reassigned stays contacted", () => {
    const a = assignment("2026-11-09 10:00", { endedAt: ist("2026-11-09 12:00") });
    const v = evaluateContact(a, [ev("call", "2026-11-09 11:00"), ev("note", "2026-11-09 11:05")], afterCutoff);
    expect(v.status).toBe("contacted");
  });

  it("the new BDE's contact counts for them, not for the old one", () => {
    const mine = assignment("2026-11-09 12:00", { userId: OTHER });
    const events = [
      ev("call", "2026-11-09 13:00", { actorId: OTHER }),
      ev("note", "2026-11-09 13:05", { actorId: OTHER }),
    ];
    expect(evaluateContact(mine, events, afterCutoff).status).toBe("contacted");
    const theirs = assignment("2026-11-09 10:00", { endedAt: ist("2026-11-09 12:00") });
    expect(evaluateContact(theirs, events, afterCutoff).status).toBe("reassigned");
  });
});

describe("activityToContactEvent", () => {
  const row = (type: string, metadata: unknown = null, actorId: string | null = BDE) => ({
    type,
    actorId,
    occurredAt: ist("2026-11-09 11:00"),
    metadata,
  });

  it("ignores anything nobody did by hand", () => {
    expect(activityToContactEvent(row("WHATSAPP_SENT", { via: "task_reminder" }, null))).toBeNull();
    expect(activityToContactEvent(row("STATUS_CHANGED", { source: "lifecycle" }, null))).toBeNull();
  });

  it("marks a logged call that carries a note", () => {
    expect(activityToContactEvent(row("CALL_LOGGED", { outcome: "connected", note: "Interested" }))).toMatchObject({
      kind: "call",
      withNote: true,
    });
    expect(activityToContactEvent(row("CALL_LOGGED", { outcome: "no_answer", note: "  " }))?.withNote).toBe(false);
    expect(activityToContactEvent(row("CALL_LOGGED", null))?.withNote).toBe(false);
  });

  it("counts Voxbay calls the BDE dialled, and incoming ones only when answered", () => {
    expect(activityToContactEvent(row("VOXBAY_CALL", { direction: "outgoing", outcome: "missed" }))?.kind).toBe("call");
    expect(activityToContactEvent(row("VOXBAY_CALL", { direction: "incoming", outcome: "answered" }))?.kind).toBe("call");
    expect(activityToContactEvent(row("VOXBAY_CALL", { direction: "incoming", outcome: "missed" }))).toBeNull();
  });

  it("maps notes, WhatsApp and both stage and Status changes", () => {
    expect(activityToContactEvent(row("NOTE_ADDED"))?.kind).toBe("note");
    expect(activityToContactEvent(row("WHATSAPP_SENT", { via: "wa_me" }))?.kind).toBe("whatsapp");
    expect(activityToContactEvent(row("STATUS_CHANGED"))?.kind).toBe("stage");
    expect(activityToContactEvent(row("SUB_STATUS_CHANGED"))?.kind).toBe("stage");
  });

  it("does not count someone else's oversight note or other activity", () => {
    expect(activityToContactEvent(row("OVERSIGHT_NOTE_ADDED"))).toBeNull();
    expect(activityToContactEvent(row("TASK_CREATED"))).toBeNull();
  });
});

describe("planAssignmentSync", () => {
  const floor = ist("2026-11-09 00:00");
  const now = ist("2026-11-09 15:00");
  const leads = (entries: [string, LeadOwnerState][]) => new Map(entries);

  it("opens a row for a current owner that has none", () => {
    const plan = planAssignmentSync(
      leads([["L1", { assignedToId: BDE, assignedAt: ist("2026-11-09 10:00") }]]),
      [],
      floor,
      now,
    );
    expect(plan.open).toEqual([{ leadId: "L1", userId: BDE, assignedAt: ist("2026-11-09 10:00") }]);
    expect(plan.close).toEqual([]);
  });

  it("leaves an assignment that already has its row alone, open or closed", () => {
    const at = ist("2026-11-09 10:00");
    const open = planAssignmentSync(
      leads([["L1", { assignedToId: BDE, assignedAt: at }]]),
      [{ id: "r1", leadId: "L1", userId: BDE, assignedAt: at, endedAt: null }],
      floor,
      now,
    );
    expect(open).toEqual({ open: [], close: [] });
  });

  it("never opens rows for assignments before tracking started", () => {
    const plan = planAssignmentSync(
      leads([["L1", { assignedToId: BDE, assignedAt: ist("2026-11-08 10:00") }]]),
      [],
      floor,
      now,
    );
    expect(plan.open).toEqual([]);
  });

  it("closes the old owner's row when the lead was reassigned, at the reassignment", () => {
    const plan = planAssignmentSync(
      leads([["L1", { assignedToId: OTHER, assignedAt: ist("2026-11-09 12:00") }]]),
      [{ id: "r1", leadId: "L1", userId: BDE, assignedAt: ist("2026-11-09 10:00"), endedAt: null }],
      floor,
      now,
    );
    expect(plan.close).toEqual([{ id: "r1", endedAt: ist("2026-11-09 12:00") }]);
    expect(plan.open).toEqual([{ leadId: "L1", userId: OTHER, assignedAt: ist("2026-11-09 12:00") }]);
  });

  it("closes the row of a released lead, at the time of the pass", () => {
    const plan = planAssignmentSync(
      leads([["L1", { assignedToId: null, assignedAt: null }]]),
      [{ id: "r1", leadId: "L1", userId: BDE, assignedAt: ist("2026-11-09 10:00"), endedAt: null }],
      floor,
      now,
    );
    expect(plan.close).toEqual([{ id: "r1", endedAt: now }]);
    expect(plan.open).toEqual([]);
  });
});

describe("contactHint", () => {
  const h = (o: Partial<{ call: boolean; note: boolean; whatsapp: boolean; stage: boolean }>) => ({
    call: false,
    note: false,
    whatsapp: false,
    stage: false,
    ...o,
  });

  it("says what a half-done pair still needs", () => {
    expect(contactHint(h({ call: true }))).toBe("called, note missing");
    expect(contactHint(h({ whatsapp: true }))).toBe("WhatsApp sent, stage or Status change missing");
    expect(contactHint(h({ note: true }))).toBe("note added, call missing");
    expect(contactHint(h({ stage: true }))).toBe("stage changed, WhatsApp missing");
  });

  it("says nothing before anything is done", () => {
    expect(contactHint(h({}))).toBeNull();
  });
});
