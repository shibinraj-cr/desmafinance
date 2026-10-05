/**
 * Designation-name rules (trainee basic-only, owner no-attendance) read the
 * employee's EFFECTIVE designation: the HrDesignation relation, falling back to
 * the legacy free-text field only when no relation is set. The legacy string
 * is never shown or edited once the relation exists, so it goes stale on
 * promotion — an Officer must not be paid basic-only because it still says
 * "Trainee".
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  effectiveDesignation,
  isTraineeDesignation,
  isOwnerDesignation,
} from "@/lib/hr-salary-engine";

describe("effectiveDesignation", () => {
  it("prefers the relation over a stale legacy string", () => {
    const promoted = { designationRef: { name: "Officer" }, designation: "Trainee" };
    expect(effectiveDesignation(promoted)).toBe("Officer");
    expect(isTraineeDesignation(effectiveDesignation(promoted))).toBe(false);
  });

  it("falls back to the legacy string when no relation is set", () => {
    const legacy = { designationRef: null, designation: "Trainee" };
    expect(isTraineeDesignation(effectiveDesignation(legacy))).toBe(true);
  });

  it("applies the relation's rule when the relation says so", () => {
    expect(isTraineeDesignation(effectiveDesignation({ designationRef: { name: "Trainee" }, designation: null }))).toBe(true);
    expect(isOwnerDesignation(effectiveDesignation({ designationRef: { name: "Director" }, designation: "Officer" }))).toBe(true);
  });

  it("is null when neither is set", () => {
    expect(effectiveDesignation({})).toBeNull();
  });
});
