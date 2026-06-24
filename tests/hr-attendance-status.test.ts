/**
 * Punch guardrail (src/lib/hr-attendance-status.ts): a day with punch-ins is a
 * worked day (P/HD) and can never be reclassified as paid leave (LV) or full
 * absence (A). This is the rule that stops worked half-days being marked paid.
 */
import { describe, it, expect } from "vitest";
import { hasPunch, leaveStatusBlockedByPunch } from "@/lib/hr-attendance-status";

describe("hasPunch", () => {
  it("true when either in or out is present", () => {
    expect(hasPunch("09:00", "17:30")).toBe(true);
    expect(hasPunch("09:00", null)).toBe(true);
    expect(hasPunch(null, "17:30")).toBe(true);
  });
  it("false when both are absent", () => {
    expect(hasPunch(null, null)).toBe(false);
  });
});

describe("leaveStatusBlockedByPunch", () => {
  it("blocks paid leave (LV) and absence (A) on a punched day", () => {
    expect(leaveStatusBlockedByPunch("LV", "09:04", "13:32")).toBe(true);
    expect(leaveStatusBlockedByPunch("A", "09:00", null)).toBe(true);
  });
  it("allows LV / A on a no-punch day (genuine leave or absence)", () => {
    expect(leaveStatusBlockedByPunch("LV", null, null)).toBe(false);
    expect(leaveStatusBlockedByPunch("A", null, null)).toBe(false);
  });
  it("allows HD / P / OD / REG on a punched day (it's a worked day)", () => {
    expect(leaveStatusBlockedByPunch("HD", "09:00", "13:00")).toBe(false);
    expect(leaveStatusBlockedByPunch("P", "09:00", "17:30")).toBe(false);
    expect(leaveStatusBlockedByPunch("OD", "09:00", "17:30")).toBe(false);
    expect(leaveStatusBlockedByPunch("REG", "09:00", "17:30")).toBe(false);
  });
});
