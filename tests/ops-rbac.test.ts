import { describe, it, expect } from "vitest";
import type { Permissions } from "@/lib/rbac";
import { getOpsAccess, canEditProject, type OpsAccess } from "@/lib/ops-rbac";

function perms(partial: Partial<Permissions>): Permissions {
  return {
    isAdmin: false,
    canApprove: false,
    needsApproval: true,
    draftFirst: false,
    pages: [],
    roleName: "User",
    ...partial,
  };
}

function access(partial: Partial<OpsAccess>): OpsAccess {
  return {
    userId: "u1",
    isAdmin: false,
    isOpsUser: false,
    isOpsManager: false,
    canViewProjects: false,
    canManageTemplates: false,
    canAssign: false,
    ...partial,
  };
}

describe("getOpsAccess", () => {
  it("makes system admins ops managers with full rights", () => {
    const a = getOpsAccess("u1", perms({ isAdmin: true }));
    expect(a.isOpsManager).toBe(true);
    expect(a.isOpsUser).toBe(true);
    expect(a.canManageTemplates).toBe(true);
    expect(a.canAssign).toBe(true);
  });

  it("promotes a role granted the templates page to ops manager", () => {
    const a = getOpsAccess("u1", perms({ pages: ["/operations/templates"] }));
    expect(a.isOpsManager).toBe(true);
    expect(a.canManageTemplates).toBe(true);
  });

  it("treats a role granted only the projects page as an ops user, not a manager", () => {
    const a = getOpsAccess("u1", perms({ pages: ["/operations/projects"] }));
    expect(a.isOpsUser).toBe(true);
    expect(a.canViewProjects).toBe(true);
    expect(a.isOpsManager).toBe(false);
    expect(a.canManageTemplates).toBe(false);
  });

  it("grants nothing to a role with no operations pages", () => {
    const a = getOpsAccess("u1", perms({ pages: ["/finance/overview"] }));
    expect(a.isOpsUser).toBe(false);
    expect(a.isOpsManager).toBe(false);
    expect(a.canManageTemplates).toBe(false);
  });

  it("handles a null permission set", () => {
    const a = getOpsAccess("u1", null);
    expect(a.isOpsUser).toBe(false);
    expect(a.isOpsManager).toBe(false);
  });
});

describe("canEditProject", () => {
  it("lets admins and managers edit any project", () => {
    expect(canEditProject(access({ isAdmin: true }), { assignedToId: "other" }, "u1")).toBe(true);
    expect(canEditProject(access({ isOpsManager: true }), { assignedToId: null }, "u1")).toBe(true);
  });

  it("lets an ops user edit only projects assigned to them", () => {
    expect(canEditProject(access({ isOpsUser: true }), { assignedToId: "u1" }, "u1")).toBe(true);
  });

  it("blocks an ops user from editing another user's project", () => {
    expect(canEditProject(access({ isOpsUser: true }), { assignedToId: "u2" }, "u1")).toBe(false);
  });

  it("blocks an ops user from editing an unassigned project", () => {
    expect(canEditProject(access({ isOpsUser: true }), { assignedToId: null }, "u1")).toBe(false);
  });

  it("blocks users with no ops rights", () => {
    expect(canEditProject(access({}), { assignedToId: "u1" }, "u1")).toBe(false);
  });
});
