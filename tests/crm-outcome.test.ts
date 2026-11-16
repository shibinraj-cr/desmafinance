import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { NEW_STAGE_CODE, followUpPreset, outcomeMovesNewLead, suggestedFollowUpSubject } from "@/lib/crm-outcome";
import { NEW_LEAD_STATUS_CODE } from "@/lib/crm-leads";

describe("outcomeMovesNewLead", () => {
  it("only a call that reached the candidate moves a New lead to Follow-Up", () => {
    expect(outcomeMovesNewLead("connected", NEW_STAGE_CODE)).toBe(true);
    expect(outcomeMovesNewLead("no_answer", NEW_STAGE_CODE)).toBe(false);
    expect(outcomeMovesNewLead("busy", NEW_STAGE_CODE)).toBe(false);
  });
  it("never moves a lead that is already past New", () => {
    expect(outcomeMovesNewLead("connected", "follow_up")).toBe(false);
  });
  it("the client-side code matches the server constant", () => {
    expect(NEW_STAGE_CODE).toBe(NEW_LEAD_STATUS_CODE);
  });
});

// Explicit +05:30 instants: the presets are India wall-clock time whatever
// timezone the test machine (or the consultant's laptop) is on.
const ist = (s: string) => new Date(`${s}:00+05:30`);

describe("followUpPreset", () => {
  it("later today is two hours on, capped at 18:00 IST", () => {
    expect(followUpPreset("later_today", ist("2026-10-26T10:00"))).toEqual(ist("2026-10-26T12:00"));
    expect(followUpPreset("later_today", ist("2026-10-26T17:00"))).toEqual(ist("2026-10-26T18:00"));
    expect(followUpPreset("later_today", ist("2026-10-26T19:00"))).toEqual(ist("2026-10-26T20:00"));
  });
  it("tomorrow / in 3 days / next week land at 10:00 IST", () => {
    const now = ist("2026-10-26T15:30");
    expect(followUpPreset("tomorrow", now)).toEqual(ist("2026-10-27T10:00"));
    expect(followUpPreset("in_3_days", now)).toEqual(ist("2026-10-29T10:00"));
    expect(followUpPreset("next_week", now)).toEqual(ist("2026-11-02T10:00"));
  });
  it("counts days from the India date, not the UTC one", () => {
    // 00:30 IST on the 27th is still the 26th in UTC — tomorrow is the 28th.
    expect(followUpPreset("tomorrow", ist("2026-10-27T00:30"))).toEqual(ist("2026-10-28T10:00"));
  });
});

describe("suggestedFollowUpSubject", () => {
  it("names the retry when the candidate was not reached", () => {
    expect(suggestedFollowUpSubject("no_answer")).toMatch(/not reached/);
    expect(suggestedFollowUpSubject("connected")).toBe("Follow-up call");
  });
});
