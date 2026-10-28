import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { inHoldout, resendScopeWhere } from "@/lib/wa/broadcast";
import { enrolmentLift } from "@/lib/wa/broadcast-holdout";

describe("inHoldout", () => {
  it("is deterministic — re-materialising puts a lead back in the same group", () => {
    expect(inHoldout("b1", "lead-42", 10)).toBe(inHoldout("b1", "lead-42", 10));
  });
  it("holds back roughly the requested share", () => {
    let held = 0;
    for (let i = 0; i < 5000; i++) if (inHoldout("campaign-x", `lead-${i}`, 10)) held++;
    expect(held / 5000).toBeGreaterThan(0.08);
    expect(held / 5000).toBeLessThan(0.12);
  });
  it("holds back nobody at 0%", () => {
    for (let i = 0; i < 200; i++) expect(inHoldout("b", `l${i}`, 0)).toBe(false);
  });
});

describe("resendScopeWhere", () => {
  it("never re-sends to the control group", () => {
    expect(resendScopeWhere("not_delivered").NOT).toEqual({ skipReason: "holdout" });
  });
});

describe("enrolmentLift", () => {
  it("percentage-point difference, sent minus held back", () => {
    expect(enrolmentLift({ leads: 900, enrolled: 27 }, { leads: 100, enrolled: 1 })).toBe(2);
  });
  it("null when a group is empty", () => {
    expect(enrolmentLift({ leads: 10, enrolled: 1 }, { leads: 0, enrolled: 0 })).toBeNull();
  });
});
