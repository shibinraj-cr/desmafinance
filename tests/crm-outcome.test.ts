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

describe("followUpPreset", () => {
  it("later today is two hours on, capped at 18:00", () => {
    const morning = new Date(2026, 9, 26, 10, 0);
    expect(followUpPreset("later_today", morning)).toEqual(new Date(2026, 9, 26, 12, 0));
    const lateAfternoon = new Date(2026, 9, 26, 17, 0);
    expect(followUpPreset("later_today", lateAfternoon)).toEqual(new Date(2026, 9, 26, 18, 0));
    const evening = new Date(2026, 9, 26, 19, 0);
    expect(followUpPreset("later_today", evening)).toEqual(new Date(2026, 9, 26, 20, 0));
  });
  it("tomorrow / in 3 days / next week land at 10:00", () => {
    const now = new Date(2026, 9, 26, 15, 30);
    expect(followUpPreset("tomorrow", now)).toEqual(new Date(2026, 9, 27, 10, 0));
    expect(followUpPreset("in_3_days", now)).toEqual(new Date(2026, 9, 29, 10, 0));
    expect(followUpPreset("next_week", now)).toEqual(new Date(2026, 10, 2, 10, 0));
  });
});

describe("suggestedFollowUpSubject", () => {
  it("names the retry when the candidate was not reached", () => {
    expect(suggestedFollowUpSubject("no_answer")).toMatch(/not reached/);
    expect(suggestedFollowUpSubject("connected")).toBe("Follow-up call");
  });
});
