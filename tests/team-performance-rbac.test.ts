import { describe, expect, it } from "vitest";
import {
  canViewAnyTeamPerformancePage,
  canViewTeamPerformancePage,
  hasFullTeamPerformanceAccess,
  TEAM_PERFORMANCE_PAGES,
  TP_BDE,
  TP_OVERVIEW,
  TP_SUPPORT,
  TP_UNANSWERED,
} from "@/lib/team-performance-rbac";
import type { Permissions } from "@/lib/rbac";

const base: Permissions = {
  isAdmin: false,
  canApprove: false,
  needsApproval: true,
  draftFirst: false,
  pages: [],
  roleName: "Employee",
};

describe("Team Performance access", () => {
  it("denies a missing session", () => {
    expect(canViewTeamPerformancePage(null, TP_OVERVIEW)).toBe(false);
    expect(hasFullTeamPerformanceAccess(null)).toBe(false);
  });

  it("gives admins and HR Manager every page without a grant", () => {
    for (const p of [
      { ...base, isAdmin: true, roleName: "Admin" },
      { ...base, roleName: "HR Manager" },
      { ...base, roleName: " hr manager " },
    ]) {
      expect(hasFullTeamPerformanceAccess(p)).toBe(true);
      for (const h of TEAM_PERFORMANCE_PAGES) {
        expect(canViewTeamPerformancePage(p, h)).toBe(true);
      }
    }
  });

  it("gives other roles only the pages ticked in Role Management", () => {
    const ops = { ...base, roleName: "Operations Manager", pages: [TP_SUPPORT, TP_UNANSWERED] };
    expect(canViewTeamPerformancePage(ops, TP_SUPPORT)).toBe(true);
    expect(canViewTeamPerformancePage(ops, TP_UNANSWERED)).toBe(true);
    expect(canViewTeamPerformancePage(ops, TP_OVERVIEW)).toBe(false);
    expect(canViewTeamPerformancePage(ops, TP_BDE)).toBe(false);
    expect(canViewAnyTeamPerformancePage(ops)).toBe(true);
    expect(hasFullTeamPerformanceAccess(ops)).toBe(false);
  });

  it("denies roles with no Team Performance pages", () => {
    expect(canViewAnyTeamPerformancePage({ ...base, roleName: "Finance Manager", canApprove: true })).toBe(false);
  });
});
