import { describe, it, expect } from "vitest";
import {
  triggerMatches,
  timeTriggerWhere,
  conditionsPass,
  render,
  STARTER_RECIPES,
  ERROR_STREAK_LIMIT,
  ACTION_TYPES,
  TRIGGER_TYPES,
  type Trigger,
} from "@/lib/hiring/automations";

describe("event triggers", () => {
  const ctx = { event: "stage_entered" as const, applicationId: "a1", stageName: "Interview", stageKind: "open" };

  it("matches a named stage", () => {
    expect(triggerMatches({ type: "stage_entered", params: { stageName: "Interview" } }, ctx)).toBe(true);
  });

  it("matches the stage name case- and space-insensitively", () => {
    expect(triggerMatches({ type: "stage_entered", params: { stageName: "  interview " } }, ctx)).toBe(true);
  });

  it("does not match a different stage", () => {
    expect(triggerMatches({ type: "stage_entered", params: { stageName: "Offer" } }, ctx)).toBe(false);
  });

  it("matches any stage when none is named", () => {
    expect(triggerMatches({ type: "stage_entered" }, ctx)).toBe(true);
  });

  it("fires a score threshold only at or above the number", () => {
    const scored = { event: "scored" as const, applicationId: "a1", aiScore: 80 };
    expect(triggerMatches({ type: "score_threshold", params: { minScore: 80 } }, scored)).toBe(true);
    expect(triggerMatches({ type: "score_threshold", params: { minScore: 81 } }, scored)).toBe(false);
  });

  it("does not fire a score threshold on an unscored application", () => {
    expect(
      triggerMatches({ type: "score_threshold", params: { minScore: 50 } }, {
        event: "scored",
        applicationId: "a1",
        aiScore: null,
      }),
    ).toBe(false);
  });

  it("never matches a time-based trigger on an event — those are swept", () => {
    for (const type of ["time_in_stage", "no_activity"] as const) {
      expect(triggerMatches({ type, params: { days: 1 } }, ctx)).toBe(false);
    }
  });
});

describe("time-based triggers", () => {
  const now = new Date("2026-09-10T00:00:00Z");

  it("finds applications sitting in a stage past the cutoff", () => {
    const where = timeTriggerWhere({ type: "time_in_stage", params: { days: 7 } }, now)!;
    expect((where.stageEnteredAt as { lt: Date }).lt.toISOString()).toBe("2026-09-03T00:00:00.000Z");
    expect(where.status).toBe("active");
  });

  it("scopes to a named stage when one is given", () => {
    const where = timeTriggerWhere(
      { type: "time_in_stage", params: { days: 7, stageName: "Shortlisted" } },
      now,
    )!;
    expect(where.stage).toEqual({ name: { equals: "Shortlisted", mode: "insensitive" } });
  });

  it("counts NEVER contacted as no activity, which a plain `lt` would drop", () => {
    const where = timeTriggerWhere({ type: "no_activity", params: { days: 30 } }, now)!;
    const clauses = where.OR as { lastContactedAt: unknown }[];
    expect(clauses.some((c) => c.lastContactedAt === null)).toBe(true);
  });

  it("refuses a nonsensical window rather than matching everyone", () => {
    expect(timeTriggerWhere({ type: "time_in_stage", params: { days: 0 } })).toBeNull();
    expect(timeTriggerWhere({ type: "no_activity", params: {} })).toBeNull();
  });

  it("has no time window for an event trigger", () => {
    expect(timeTriggerWhere({ type: "offer_sent" } as Trigger)).toBeNull();
  });
});

describe("conditions", () => {
  const row = { status: "active", aiScore: 72, jobTitle: "Business Development Executive" };

  it("passes when every condition holds", () => {
    expect(
      conditionsPass([{ field: "status", op: "eq", value: "active" }, { field: "aiScore", op: "gt", value: 70 }], row),
    ).toBe(true);
  });

  it("fails when any one does not", () => {
    expect(conditionsPass([{ field: "aiScore", op: "gt", value: 90 }], row)).toBe(false);
  });

  it("matches a substring case-insensitively", () => {
    expect(conditionsPass([{ field: "jobTitle", op: "contains", value: "development" }], row)).toBe(true);
  });

  it("passes trivially with no conditions", () => {
    expect(conditionsPass([], row)).toBe(true);
  });

  it("does not compare a number against a string and call it true", () => {
    expect(conditionsPass([{ field: "aiScore", op: "gt", value: "10" }], row)).toBe(false);
  });
});

describe("template rendering", () => {
  const app = { candidate: { fullName: "Anu Menon" }, job: { title: "Documentation Executive" } };

  it("fills the merge fields", () => {
    expect(render("Hi {{firstName}}, about {{jobTitle}}", app)).toBe("Hi Anu, about Documentation Executive");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(render("{{ candidateName }}", app)).toBe("Anu Menon");
  });

  it("leaves an unknown field alone rather than blanking it", () => {
    expect(render("{{unknown}}", app)).toBe("{{unknown}}");
  });
});

describe("starter recipes", () => {
  it("ships the six the spec names", () => {
    expect(STARTER_RECIPES).toHaveLength(6);
  });

  it("uses only real trigger and action types", () => {
    for (const recipe of STARTER_RECIPES) {
      expect(TRIGGER_TYPES).toContain(recipe.trigger.type);
      for (const action of recipe.actions) expect(ACTION_TYPES).toContain(action.type);
    }
  });

  it("never rejects anybody — no starter moves a candidate to a lost stage", () => {
    for (const recipe of STARTER_RECIPES) {
      for (const action of recipe.actions) {
        if (action.type !== "move_stage") continue;
        const stage = String(action.params?.stageName ?? "").toLowerCase();
        expect(stage).not.toContain("reject");
      }
    }
  });

  it("pauses a failing recipe after three consecutive errors", () => {
    expect(ERROR_STREAK_LIMIT).toBe(3);
  });
});
