import { describe, expect, it } from "vitest";
import { canViewTeamPerformance } from "@/lib/team-performance-rbac";
import type { Permissions } from "@/lib/rbac";

const base: Permissions = {
  isAdmin: false,
  canApprove: false,
  needsApproval: true,
  draftFirst: false,
  pages: [],
  roleName: "Employee",
};

describe("canViewTeamPerformance", () => {
  it("denies a missing session", () => {
    expect(canViewTeamPerformance(null)).toBe(false);
  });
  it("allows admins", () => {
    expect(canViewTeamPerformance({ ...base, isAdmin: true, roleName: "Admin" })).toBe(true);
  });
  it("allows HR Manager (any case)", () => {
    expect(canViewTeamPerformance({ ...base, canApprove: true, roleName: "HR Manager" })).toBe(true);
    expect(canViewTeamPerformance({ ...base, roleName: "hr manager " })).toBe(true);
  });
  it("denies other roles even if the page was granted", () => {
    const pages = ["/performance/overview"];
    expect(canViewTeamPerformance({ ...base, pages, roleName: "HR Executive" })).toBe(false);
    expect(canViewTeamPerformance({ ...base, pages, canApprove: true, roleName: "Finance Manager" })).toBe(false);
    expect(canViewTeamPerformance({ ...base, pages, roleName: "Employee" })).toBe(false);
  });
});
