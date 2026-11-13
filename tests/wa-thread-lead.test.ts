import { describe, it, expect } from "vitest";
import {
  pickThreadLead,
  threadOwnerAfterInbound,
  DUPLICATE_STATUS_CODE,
  type ThreadLeadCandidate,
} from "@/lib/wa/thread-lead";

/** A lead on the thread's number; each test overrides only what it is about. */
function lead(over: Partial<ThreadLeadCandidate> & { id: string }): ThreadLeadCandidate {
  return {
    assignedToId: null,
    statusCode: "follow_up",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

describe("pickThreadLead", () => {
  it("returns null for a number with no leads", () => {
    expect(pickThreadLead([])).toBeNull();
  });

  it("takes the only lead there is, duplicate or not", () => {
    const only = lead({ id: "a", statusCode: DUPLICATE_STATUS_CODE });
    expect(pickThreadLead([only])?.id).toBe("a");
  });

  // The reported bug: a Meta-imported candidate whose oldest row is the flagged
  // copy, with the lead anybody is working created later.
  it("prefers a real lead over one flagged duplicate, however old the duplicate is", () => {
    const dup = lead({
      id: "dup",
      statusCode: DUPLICATE_STATUS_CODE,
      createdAt: new Date("2026-05-01T00:00:00Z"),
    });
    const live = lead({
      id: "live",
      assignedToId: "u1",
      createdAt: new Date("2026-09-01T00:00:00Z"),
    });
    expect(pickThreadLead([dup, live])?.id).toBe("live");
    // Order of the input must not decide it.
    expect(pickThreadLead([live, dup])?.id).toBe("live");
  });

  it("prefers a lead somebody owns over one nobody does", () => {
    const unowned = lead({ id: "unowned", createdAt: new Date("2026-02-01T00:00:00Z") });
    const owned = lead({ id: "owned", assignedToId: "u1", createdAt: new Date("2026-06-01T00:00:00Z") });
    expect(pickThreadLead([unowned, owned])?.id).toBe("owned");
  });

  // The original rule, kept as the tie-break: among equals the earliest record
  // is the canonical one a re-inquiry folds onto.
  it("falls back to the oldest among equals", () => {
    const older = lead({ id: "older", assignedToId: "u1", createdAt: new Date("2026-03-01T00:00:00Z") });
    const newer = lead({ id: "newer", assignedToId: "u2", createdAt: new Date("2026-07-01T00:00:00Z") });
    expect(pickThreadLead([newer, older])?.id).toBe("older");
  });

  it("still picks a duplicate when every lead on the number is one", () => {
    const a = lead({ id: "b", statusCode: DUPLICATE_STATUS_CODE, createdAt: new Date("2026-04-01T00:00:00Z") });
    const b = lead({ id: "a", statusCode: DUPLICATE_STATUS_CODE, createdAt: new Date("2026-02-01T00:00:00Z") });
    expect(pickThreadLead([a, b])?.id).toBe("a");
  });

  it("treats a lead with no stage as a real lead", () => {
    const noStage = lead({ id: "none", statusCode: null, createdAt: new Date("2026-08-01T00:00:00Z") });
    const dup = lead({ id: "dup", statusCode: DUPLICATE_STATUS_CODE, createdAt: new Date("2026-01-01T00:00:00Z") });
    expect(pickThreadLead([noStage, dup])?.id).toBe("none");
  });

  // Two webhook deliveries racing on one number must not pick differently, or
  // the link flaps between two equally-ranked rows on every inbound message.
  it("is deterministic when rank and timestamp are identical", () => {
    const sameTime = new Date("2026-05-05T00:00:00Z");
    const x = lead({ id: "x", assignedToId: "u1", createdAt: sameTime });
    const y = lead({ id: "y", assignedToId: "u2", createdAt: sameTime });
    expect(pickThreadLead([x, y])?.id).toBe("x");
    expect(pickThreadLead([y, x])?.id).toBe("x");
  });
});

describe("threadOwnerAfterInbound", () => {
  const on = (assignedToId: string | null, statusCode: string | null = "follow_up") => ({ assignedToId, statusCode });

  it("leaves an unlinked thread alone, even one somebody was handed", () => {
    expect(threadOwnerAfterInbound({ current: "u1", lead: null, numberLeads: [] })).toBeUndefined();
    expect(threadOwnerAfterInbound({ current: null, lead: null, numberLeads: [] })).toBeUndefined();
  });

  it("gives an ownerless thread to the lead's owner", () => {
    expect(threadOwnerAfterInbound({ current: null, lead: { assignedToId: "u1" }, numberLeads: [on("u1")] })).toBe("u1");
  });

  it("changes nothing when neither has an owner, or both agree", () => {
    expect(threadOwnerAfterInbound({ current: null, lead: { assignedToId: null }, numberLeads: [on(null)] })).toBeUndefined();
    expect(threadOwnerAfterInbound({ current: "u1", lead: { assignedToId: "u1" }, numberLeads: [on("u1")] })).toBeUndefined();
  });

  // The reported bug: the lead was unassigned (re-marketing, an old assignment
  // from before threads were synced) but the thread still named a consultant, so
  // the candidate's reply never reached "Unassigned + Needs reply".
  it("releases a stale owner when the lead is unassigned and they own nothing else on the number", () => {
    expect(
      threadOwnerAfterInbound({ current: "former", lead: { assignedToId: null }, numberLeads: [on(null)] }),
    ).toBeNull();
  });

  it("moves a stale owner to the lead's current owner", () => {
    expect(
      threadOwnerAfterInbound({ current: "former", lead: { assignedToId: "now" }, numberLeads: [on("now")] }),
    ).toBe("now");
  });

  // One number, two leads: assigning the sibling moved the thread to its owner.
  // That handover must survive the candidate's next message.
  it("keeps an owner who still holds another real lead on the same number", () => {
    expect(
      threadOwnerAfterInbound({
        current: "sibling",
        lead: { assignedToId: "bound" },
        numberLeads: [on("bound"), on("sibling")],
      }),
    ).toBeUndefined();
  });

  // Owning the importer's copy is not owning the candidate.
  it("does not count a lead flagged duplicate as still owning the candidate", () => {
    expect(
      threadOwnerAfterInbound({
        current: "former",
        lead: { assignedToId: null },
        numberLeads: [on(null), on("former", DUPLICATE_STATUS_CODE)],
      }),
    ).toBeNull();
  });
});
