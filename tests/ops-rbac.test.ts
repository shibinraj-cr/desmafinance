import { describe, it, expect } from "vitest";
import type { Permissions } from "@/lib/rbac";
import { getOpsAccess, canEditProject, canEditActionItem, type OpsAccess } from "@/lib/ops-rbac";

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

  it("promotes a role granted the settings page to ops manager", () => {
    const a = getOpsAccess("u1", perms({ pages: ["/operations/settings"] }));
    expect(a.isOpsManager).toBe(true);
    expect(a.canManageTemplates).toBe(true);
    expect(a.canAssign).toBe(true);
  });

  it("treats a role granted a workspace page as an ops user, not a manager", () => {
    for (const page of ["/operations/projects", "/operations/my-work"]) {
      const a = getOpsAccess("u1", perms({ pages: [page] }));
      expect(a.isOpsUser).toBe(true);
      expect(a.canViewProjects).toBe(true);
      expect(a.isOpsManager).toBe(false);
      expect(a.canManageTemplates).toBe(false);
      expect(a.canAssign).toBe(false);
    }
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

describe("canEditActionItem", () => {
  const nobody = { project: null, createdById: null, assignedToId: null };

  it("inherits the project rule when the task hangs off a project", () => {
    const item = { project: { assignedToId: "u2" }, createdById: "u1", assignedToId: "u1" };
    // Creator + assignee count for nothing here: the project owner runs its tasks.
    expect(canEditActionItem(access({ isOpsUser: true }), item, "u1")).toBe(false);
    expect(canEditActionItem(access({ isOpsUser: true }), { ...item, project: { assignedToId: "u1" } }, "u1")).toBe(true);
  });

  it("lets managers and admins edit a standalone task they have no part in", () => {
    expect(canEditActionItem(access({ isAdmin: true }), nobody, "u1")).toBe(true);
    expect(canEditActionItem(access({ isOpsManager: true }), nobody, "u1")).toBe(true);
  });

  it("lets an ops user edit a standalone task they raised or own", () => {
    const a = access({ isOpsUser: true });
    expect(canEditActionItem(a, { ...nobody, createdById: "u1" }, "u1")).toBe(true);
    expect(canEditActionItem(a, { ...nobody, assignedToId: "u1" }, "u1")).toBe(true);
  });

  it("blocks an ops user from another user's standalone task", () => {
    const item = { project: null, createdById: "u2", assignedToId: "u3" };
    expect(canEditActionItem(access({ isOpsUser: true }), item, "u1")).toBe(false);
  });

  it("blocks a non-ops user outright, even on a task naming them", () => {
    expect(canEditActionItem(access({}), { ...nobody, createdById: "u1", assignedToId: "u1" }, "u1")).toBe(false);
  });
});
