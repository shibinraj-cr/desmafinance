/**
 * Authorization-logic tests (src/lib/rbac.ts + src/lib/hr-rbac.ts).
 *
 * These pure predicates decide who can see which page and who can approve
 * money/HR actions. A regression here is a security regression, so the
 * behaviour is pinned: admins pass everything, page access is exact-or-prefix,
 * and HR approval requires both HR access AND approval authority.
 */
import { describe, it, expect } from "vitest";
import {
  fromLegacyString,
  isAdmin,
  canManageUsers,
  canApprove,
  needsApproval,
  canSeePage,
  roleLabel,
  type Permissions,
} from "@/lib/rbac";
import { isHrUser, canApproveHr, canDownloadAxis, isEmployeePortalUser } from "@/lib/hr-rbac";

function perms(over: Partial<Permissions> = {}): Permissions {
  return {
    isAdmin: false,
    canApprove: false,
    needsApproval: false,
    draftFirst: false,
    pages: [],
    roleName: "User",
    ...over,
  };
}

describe("fromLegacyString", () => {
  it("maps 'admin' to full capabilities including user/role management pages", () => {
    const p = fromLegacyString("admin");
    expect(p.isAdmin).toBe(true);
    expect(p.canApprove).toBe(true);
    expect(p.needsApproval).toBe(false);
    expect(p.pages).toContain("/users");
    expect(p.pages).toContain("/roles");
  });

  it("maps 'manager' to an approver that is not an admin", () => {
    const p = fromLegacyString("manager");
    expect(p.isAdmin).toBe(false);
    expect(p.canApprove).toBe(true);
    expect(p.pages).not.toContain("/users");
  });

  it("maps an unknown/executive role to a needs-approval, non-approver", () => {
    const p = fromLegacyString("executive");
    expect(p.canApprove).toBe(false);
    expect(p.needsApproval).toBe(true);
    expect(p.isAdmin).toBe(false);
  });

  it("defaults a null role to executive-level (needs approval)", () => {
    expect(fromLegacyString(null).needsApproval).toBe(true);
  });
});

describe("capability flag helpers", () => {
  it("isAdmin / canManageUsers track the isAdmin flag", () => {
    expect(isAdmin(perms({ isAdmin: true }))).toBe(true);
    expect(isAdmin(perms())).toBe(false);
    expect(canManageUsers(perms({ isAdmin: true }))).toBe(true);
    expect(canManageUsers(perms({ canApprove: true }))).toBe(false); // approver ≠ user manager
  });

  it("canApprove / needsApproval track their flags and tolerate null", () => {
    expect(canApprove(perms({ canApprove: true }))).toBe(true);
    expect(canApprove(null)).toBe(false);
    expect(needsApproval(perms({ needsApproval: true }))).toBe(true);
    expect(needsApproval(undefined)).toBe(false);
  });
});

describe("canSeePage", () => {
  const exec = perms({ pages: ["/finance/overview", "/finance/daily-tracker"] });

  it("admins see every page regardless of their page list", () => {
    const admin = perms({ isAdmin: true, pages: [] });
    expect(canSeePage(admin, "/users")).toBe(true);
    expect(canSeePage(admin, "/hr/salary")).toBe(true);
  });

  it("grants exact matches and child paths (prefix + '/')", () => {
    expect(canSeePage(exec, "/finance/overview")).toBe(true);
    expect(canSeePage(exec, "/finance/daily-tracker")).toBe(true);
    expect(canSeePage(exec, "/finance/daily-tracker/123/edit")).toBe(true);
  });

  it("denies pages not in the list and rejects sibling-prefix false positives", () => {
    expect(canSeePage(exec, "/users")).toBe(false);
    // "/finance/daily-trackerX" must NOT match the "/finance/daily-tracker" grant.
    expect(canSeePage(exec, "/finance/daily-trackerX")).toBe(false);
  });

  it("rejects non-absolute hrefs", () => {
    expect(canSeePage(exec, "finance/overview")).toBe(false);
  });

  it("shows self-service essentials (My Attendance, Regularization) to every role", () => {
    // exec has only finance pages, yet still sees the always-visible tabs.
    expect(canSeePage(exec, "/me/attendance")).toBe(true);
    expect(canSeePage(exec, "/me/regularization")).toBe(true);
    // and their child routes
    expect(canSeePage(exec, "/me/attendance/2026-04")).toBe(true);
    // but NOT other /me pages they weren't granted
    expect(canSeePage(exec, "/me/payslips")).toBe(false);
  });
});

describe("roleLabel", () => {
  it("falls back to 'User' when no role name is present", () => {
    expect(roleLabel(null)).toBe("User");
    expect(roleLabel("HR Manager")).toBe("HR Manager");
  });
});

describe("hr-rbac", () => {
  const hrStaff = perms({ pages: ["/hr/employees", "/hr/attendance"] });
  const hrManager = perms({ pages: ["/hr/salary"], canApprove: true });
  const financeOnly = perms({ pages: ["/finance/overview"], canApprove: true });
  const admin = perms({ isAdmin: true });

  it("isHrUser: admins and anyone with an /hr/* page; nobody else; null is false", () => {
    expect(isHrUser(admin)).toBe(true);
    expect(isHrUser(hrStaff)).toBe(true);
    expect(isHrUser(financeOnly)).toBe(false);
    expect(isHrUser(null)).toBe(false);
  });

  it("canApproveHr: requires BOTH hr access AND approval authority (admins always pass)", () => {
    expect(canApproveHr(admin)).toBe(true);
    expect(canApproveHr(hrManager)).toBe(true); // /hr/* page + canApprove
    expect(canApproveHr(hrStaff)).toBe(false); // hr access but no approval authority
    expect(canApproveHr(financeOnly)).toBe(false); // approver but not HR
    expect(canApproveHr(null)).toBe(false);
  });

  it("canDownloadAxis: approver with the /hr/salary page, or admin", () => {
    expect(canDownloadAxis(admin)).toBe(true);
    expect(canDownloadAxis(hrManager)).toBe(true);
    expect(canDownloadAxis(hrStaff)).toBe(false); // no canApprove and no /hr/salary
    expect(canDownloadAxis(financeOnly)).toBe(false); // approver but lacks /hr/salary
  });

  it("isEmployeePortalUser: anyone with an /me/* page, or admin", () => {
    expect(isEmployeePortalUser(perms({ pages: ["/me/home"] }))).toBe(true);
    expect(isEmployeePortalUser(admin)).toBe(true);
    expect(isEmployeePortalUser(perms({ pages: ["/finance/overview"] }))).toBe(false);
    expect(isEmployeePortalUser(null)).toBe(false);
  });
});
