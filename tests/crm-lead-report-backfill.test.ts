import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  assignmentKind,
  backfillCsv,
  missReason,
  rebuildEpisodes,
  workingDays,
  type AssignmentEvent,
  type LeadState,
} from "@/lib/crm-lead-report-backfill";
import { buildLeadReport } from "@/lib/crm-lead-report";

// 2026-10-05 is a Monday.
const ist = (dateTime: string) => new Date(`${dateTime.replace(" ", "T")}:00+05:30`);
const FROM = ist("2026-10-01 00:00");
const UNTIL = ist("2026-11-10 16:22"); // tracking began
const lead = (over: Partial<LeadState> = {}): LeadState => ({ id: "L1", assignedToId: null, assignedAt: null, importBatchCreatedAt: null, ...over });
const ev = (type: string, at: string, toUserId: string | null = null, leadId = "L1"): AssignmentEvent => ({ leadId, type, toUserId, at: ist(at) });

describe("rebuildEpisodes", () => {
  it("replays assign → reassign → release into episodes that end when the lead moved", () => {
    const eps = rebuildEpisodes(
      [ev("ASSIGNED", "2026-10-05 10:00", "A"), ev("REASSIGNED", "2026-10-06 11:00", "B"), ev("UNASSIGNED", "2026-10-07 12:00")],
      [lead()],
      FROM,
      UNTIL,
    );
    expect(eps).toEqual([
      { leadId: "L1", userId: "A", assignedAt: ist("2026-10-05 10:00"), endedAt: ist("2026-10-06 11:00"), previousUserId: null },
      { leadId: "L1", userId: "B", assignedAt: ist("2026-10-06 11:00"), endedAt: ist("2026-10-07 12:00"), previousUserId: "A" },
    ]);
  });

  it("gives the current owner's episode the lead's exact assignedAt — the key live tracking uses", () => {
    const at = new Date(ist("2026-10-05 10:00").getTime() - 120); // stamped just before the activity
    const [ep] = rebuildEpisodes([ev("ASSIGNED", "2026-10-05 10:00", "A")], [lead({ assignedToId: "A", assignedAt: at })], FROM, UNTIL);
    expect(ep).toEqual({ leadId: "L1", userId: "A", assignedAt: at, endedAt: null, previousUserId: null });
  });

  it("adds an assignment the ledger never logged (a re-enrolment), from the lead itself", () => {
    const eps = rebuildEpisodes([], [lead({ assignedToId: "A", assignedAt: ist("2026-10-08 09:00") })], FROM, UNTIL);
    expect(eps).toEqual([{ leadId: "L1", userId: "A", assignedAt: ist("2026-10-08 09:00"), endedAt: null, previousUserId: null }]);
  });

  it("an episode that ends after go-live ends when it really did; one starting after go-live is left to tracking", () => {
    const eps = rebuildEpisodes(
      [ev("ASSIGNED", "2026-11-09 10:00", "A"), ev("REASSIGNED", "2026-11-10 18:00", "B")],
      [lead({ assignedToId: "B", assignedAt: ist("2026-11-10 18:00") })],
      FROM,
      UNTIL,
    );
    expect(eps).toEqual([
      { leadId: "L1", userId: "A", assignedAt: ist("2026-11-09 10:00"), endedAt: ist("2026-11-10 18:00"), previousUserId: null },
    ]);
  });

  it("leaves out bulk-import carryover, keeps a deliberate assignment of an imported lead", () => {
    const batch = ist("2026-10-05 09:00");
    const carry = rebuildEpisodes([ev("ASSIGNED", "2026-10-05 09:02", "A")], [lead({ importBatchCreatedAt: batch })], FROM, UNTIL);
    expect(carry).toEqual([]);
    const later = rebuildEpisodes([ev("ASSIGNED", "2026-10-06 10:00", "A")], [lead({ importBatchCreatedAt: batch })], FROM, UNTIL);
    expect(later).toHaveLength(1);
  });

  it("ignores a repeat assignment to the same owner, and anything before the range", () => {
    const eps = rebuildEpisodes(
      [ev("ASSIGNED", "2026-09-20 10:00", "A"), ev("ASSIGNED", "2026-10-05 10:00", "A")],
      [lead()],
      FROM,
      UNTIL,
    );
    expect(eps).toEqual([]);
  });
});

describe("assignmentKind / missReason", () => {
  const ep = (at: string, previousUserId: string | null = null) => ({ assignedAt: ist(at), previousUserId });

  it("tells a new lead from an older one handed out, and from a takeover", () => {
    expect(assignmentKind(ep("2026-10-05 10:00"), ist("2026-10-05 09:00"))).toBe("fresh");
    expect(assignmentKind(ep("2026-10-05 10:00"), ist("2026-09-01 09:00"))).toBe("older");
    expect(assignmentKind(ep("2026-10-05 10:00", "B"), ist("2026-10-05 09:00"))).toBe("reassigned");
  });

  it("says what was logged on a miss", () => {
    const h = (o: Partial<{ call: boolean; note: boolean; whatsapp: boolean; stage: boolean }>) => ({ call: false, note: false, whatsapp: false, stage: false, ...o });
    expect(missReason("missed", h({}))).toBe("nothing");
    expect(missReason("missed", h({ call: true, stage: true }))).toBe("call_no_note");
    expect(missReason("missed", h({ stage: true }))).toBe("stage_only");
    expect(missReason("missed", h({ whatsapp: true, note: true }))).toBe("whatsapp_no_stage");
    expect(missReason("missed", h({ note: true }))).toBe("note_only");
    expect(missReason("contacted_late", h({ call: true, note: true }))).toBe("late");
  });
});

describe("workingDays", () => {
  it("skips Sundays and holidays", () => {
    expect(workingDays("2026-10-03", "2026-10-06", new Set(["2026-10-05"]))).toEqual(["2026-10-03", "2026-10-06"]);
  });
});

describe("backfillCsv", () => {
  it("one line per BDE per day, day then name", () => {
    const report = buildLeadReport("2026-10-05", [], []);
    const csv = backfillCsv([
      { day: "2026-10-06", userId: "u1", name: "BDE A", report, existing: "none" },
      { day: "2026-10-05", userId: "u2", name: "BDE, B", report, existing: "submitted" },
    ]);
    expect(csv.split("\n")[0]).toBe(
      "day,bde,received,carried_in,contacted,missed,contacted_late,pending,due_later,handovers_given,stored_before",
    );
    expect(csv.split("\n")[1]).toBe('2026-10-05,"BDE, B",0,0,0,0,0,0,0,0,submitted');
    expect(csv.split("\n")[2]).toMatch(/^2026-10-06,BDE A,/);
  });
});
