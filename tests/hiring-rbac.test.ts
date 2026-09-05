import { describe, it, expect } from "vitest";
import type { Permissions } from "@/lib/rbac";
import {
  resolveHiringAccess,
  can,
  canReviewJob,
  canScoreJob,
  ROLE_PERMISSIONS,
  HIRING_PERMISSIONS,
  HIRING_SETTINGS_PAGE,
  type HiringMemberLike,
} from "@/lib/hiring/rbac";

function perms(partial: Partial<Permissions> = {}): Permissions {
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

function member(partial: Partial<NonNullable<HiringMemberLike>> = {}): HiringMemberLike {
  return {
    baseRole: "recruiter",
    customRoleName: null,
    extraPermissions: [],
    deniedPermissions: [],
    isActive: true,
    ...partial,
  };
}

describe("hiring role resolution", () => {
  it("makes a system admin an owner with every permission", () => {
    const a = resolveHiringAccess("u1", perms({ isAdmin: true }), null);
    expect(a.baseRole).toBe("owner");
    for (const key of HIRING_PERMISSIONS) expect(can(a, key)).toBe(true);
  });

  it("promotes a role granted the hiring settings page to HR manager", () => {
    const a = resolveHiringAccess("u1", perms({ pages: [HIRING_SETTINGS_PAGE] }), null);
    expect(a.baseRole).toBe("hr_manager");
    expect(can(a, "team:manage")).toBe(true);
  });

  it("treats a role granted only a hiring rail as a recruiter", () => {
    const a = resolveHiringAccess("u1", perms({ pages: ["/hiring/jobs"] }), null);
    expect(a.baseRole).toBe("recruiter");
    expect(can(a, "job:write")).toBe(true);
    // §6: recruiters get no offers and no partner fees.
    expect(can(a, "offer:manage")).toBe(false);
    expect(can(a, "sourcing:manage")).toBe(false);
  });

  it("falls back to employee — referrals and self only — with no grants", () => {
    const a = resolveHiringAccess("u1", perms(), null);
    expect(a.baseRole).toBe("employee");
    expect(can(a, "referral:manage")).toBe(true);
    expect(can(a, "candidate:read")).toBe(false);
    expect(a.isHiringUser).toBe(false);
  });

  it("lets an employee granted the referrals page into the section", () => {
    const a = resolveHiringAccess("u1", perms({ pages: ["/hiring/referrals"] }), null);
    expect(a.baseRole).toBe("employee");
    expect(a.isHiringUser).toBe(true);
  });

  it("prefers an explicit member row over the page-grant tier", () => {
    // Page grants say recruiter; the pinned row says employee, and wins.
    const a = resolveHiringAccess("u1", perms({ pages: ["/hiring/jobs"] }), member({ baseRole: "employee" }));
    expect(a.baseRole).toBe("employee");
    expect(can(a, "job:write")).toBe(false);
  });

  it("keeps a system admin an owner even when their member row says otherwise", () => {
    const a = resolveHiringAccess("u1", perms({ isAdmin: true }), member({ baseRole: "employee" }));
    expect(a.baseRole).toBe("owner");
  });

  it("ignores an inactive member row and falls back to page grants", () => {
    const a = resolveHiringAccess("u1", perms({ pages: ["/hiring/jobs"] }), member({ baseRole: "owner", isActive: false }));
    expect(a.baseRole).toBe("recruiter");
  });
});

describe("custom roles", () => {
  it("adds extra permissions on top of the base role", () => {
    const a = resolveHiringAccess("u1", perms(), member({ extraPermissions: ["offer:manage"] }));
    expect(can(a, "offer:manage")).toBe(true);
  });

  it("lets a denial beat both the base role and an extra grant", () => {
    const a = resolveHiringAccess(
      "u1",
      perms(),
      member({ extraPermissions: ["offer:manage"], deniedPermissions: ["offer:manage", "job:write"] }),
    );
    expect(can(a, "offer:manage")).toBe(false);
    expect(can(a, "job:write")).toBe(false);
  });

  it("does not let an inactive member's extra grants apply", () => {
    const a = resolveHiringAccess(
      "u1",
      perms({ pages: ["/hiring/jobs"] }),
      member({ isActive: false, extraPermissions: ["offer:manage"] }),
    );
    expect(can(a, "offer:manage")).toBe(false);
  });

  it("shows the custom role name when one is set", () => {
    const a = resolveHiringAccess("u1", perms(), member({ customRoleName: "Campus Recruiter" }));
    expect(a.roleLabel).toBe("Campus Recruiter");
  });

  it("ignores permission keys that are not real", () => {
    const a = resolveHiringAccess("u1", perms(), member({ extraPermissions: ["job:delete_everything"] }));
    expect(a.permissions).not.toContain("job:delete_everything");
  });
});

describe("hiring manager is derived from the requisition, not a stored role", () => {
  const job = { ownerId: "owner-1", hiringManagerId: "hm-1" };

  it("lets the named hiring manager review the req's candidates", () => {
    const a = resolveHiringAccess("hm-1", perms(), null); // plain employee
    expect(can(a, "candidate:read")).toBe(false);
    expect(canReviewJob(a, job)).toBe(true);
    expect(canScoreJob(a, job)).toBe(true);
  });

  it("lets the req owner review it too", () => {
    const a = resolveHiringAccess("owner-1", perms(), null);
    expect(canReviewJob(a, job)).toBe(true);
  });

  it("does not leak the req to an unrelated employee", () => {
    const a = resolveHiringAccess("stranger", perms(), null);
    expect(canReviewJob(a, job)).toBe(false);
    expect(canScoreJob(a, job)).toBe(false);
  });

  it("is additive — a recruiter still reviews reqs they are not named on", () => {
    const a = resolveHiringAccess("stranger", perms({ pages: ["/hiring/jobs"] }), null);
    expect(canReviewJob(a, job)).toBe(true);
  });
});

describe("role permission table", () => {
  it("gives an external partner no read of internal candidates or notes", () => {
    expect(ROLE_PERMISSIONS.partner).not.toContain("candidate:read");
    expect(ROLE_PERMISSIONS.partner).not.toContain("candidate:write");
    expect(ROLE_PERMISSIONS.partner).not.toContain("analytics:read");
    expect(ROLE_PERMISSIONS.partner).not.toContain("offer:manage");
  });

  it("gives an employee nothing beyond referrals and their own profile", () => {
    expect([...ROLE_PERMISSIONS.employee].sort()).toEqual(
      ["referral:manage", "self:read", "self:write"].sort(),
    );
  });
});
