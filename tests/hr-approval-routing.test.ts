/**
 * Leave-approval routing.
 *
 * The hole this closes: an HR Manager could sign off on their own leave — not
 * through the request queue (that already hid their own rows) but by editing
 * their own attendance day directly on /hr/attendance, which ran no such check.
 * Two HR Managers could also approve each other's, which is the same conflict
 * with one extra step. Both now route to a single designated approver.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    employee: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  permissionsForUser,
  designatedLeaveApproverIds,
  hrApproverEmployeeIds,
  canApproveHrApproverRequests,
  leaveDecisionBlockedReason,
  reviewQueueScope,
} from "@/lib/hr-approval-routing";
import type { Permissions } from "@/lib/rbac";

const role = (over: Partial<NonNullable<Parameters<typeof permissionsForUser>[0]["roleRef"]>> = {}) => ({
  isAdmin: false,
  canApprove: false,
  needsApproval: true,
  pages: [] as string[],
  name: "Role",
  ...over,
});

const HR_MANAGER_ROLE = role({ canApprove: true, pages: ["/hr/attendance", "/hr/leave"], name: "HR Manager" });
const ADMIN_ROLE = role({ isAdmin: true, canApprove: true, pages: ["/users"], name: "Admin" });
const STAFF_ROLE = role({ pages: ["/me/leave"], name: "Executive" });

const perms = (over: Partial<Permissions> = {}): Permissions => ({
  isAdmin: false,
  canApprove: false,
  needsApproval: true,
  draftFirst: false,
  pages: [],
  roleName: "Executive",
  ...over,
});

const HR_PERMS = perms({ canApprove: true, pages: ["/hr/attendance"], roleName: "HR Manager" });
const ADMIN_PERMS = perms({ isAdmin: true, canApprove: true, roleName: "Admin" });

/** Employees as `hrApproverEmployeeIds` reads them: one HR Manager, one staffer. */
function seedEmployees() {
  vi.mocked(prisma.employee.findMany).mockResolvedValue([
    { id: "emp-hr", user: { isActive: true, role: null, draftFirst: false, roleRef: HR_MANAGER_ROLE } },
    { id: "emp-staff", user: { isActive: true, role: null, draftFirst: false, roleRef: STAFF_ROLE } },
    { id: "emp-owner", user: { isActive: true, role: null, draftFirst: false, roleRef: ADMIN_ROLE } },
  ] as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HR_LEAVE_APPROVER;
  // By default the designated approver resolves to the owner's login.
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "user-owner" }] as never);
  seedEmployees();
  vi.mocked(prisma.employee.findUnique).mockResolvedValue(null as never);
});

describe("permissionsForUser", () => {
  it("reads the linked role record when present", () => {
    const p = permissionsForUser({ role: "executive", draftFirst: false, roleRef: HR_MANAGER_ROLE });
    expect(p.canApprove).toBe(true);
    expect(p.roleName).toBe("HR Manager");
  });

  it("falls back to the legacy string role when there is no role record", () => {
    const p = permissionsForUser({ role: "admin", draftFirst: false, roleRef: null });
    expect(p.isAdmin).toBe(true);
  });
});

describe("designatedLeaveApproverIds", () => {
  it("matches username or email, case-insensitively", async () => {
    await designatedLeaveApproverIds();
    const where = vi.mocked(prisma.user.findMany).mock.calls[0][0]!.where as Record<string, unknown>;
    expect(where.isActive).toBe(true);
    expect(where.OR).toEqual([
      { username: { in: ["shibin"], mode: "insensitive" } },
      { email: { in: ["shibin"], mode: "insensitive" } },
    ]);
  });

  it("takes a comma-separated HR_LEAVE_APPROVER override, lowercased", async () => {
    process.env.HR_LEAVE_APPROVER = "Owner, owner@example.com";
    await designatedLeaveApproverIds();
    const where = vi.mocked(prisma.user.findMany).mock.calls[0][0]!.where as Record<string, unknown>;
    expect(where.OR).toEqual([
      { username: { in: ["owner", "owner@example.com"], mode: "insensitive" } },
      { email: { in: ["owner", "owner@example.com"], mode: "insensitive" } },
    ]);
  });
});

describe("hrApproverEmployeeIds", () => {
  it("returns only employees whose own login can approve HR requests", async () => {
    expect(await hrApproverEmployeeIds()).toEqual(["emp-hr", "emp-owner"]);
  });

  it("drops a deactivated account — it can't approve anything", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "emp-hr", user: { isActive: false, role: null, draftFirst: false, roleRef: HR_MANAGER_ROLE } },
    ] as never);
    expect(await hrApproverEmployeeIds()).toEqual([]);
  });
});

describe("canApproveHrApproverRequests", () => {
  it("is true for the designated approver", async () => {
    expect(await canApproveHrApproverRequests("user-owner", ADMIN_PERMS)).toBe(true);
  });

  it("is false for an HR Manager who is not the designated approver", async () => {
    expect(await canApproveHrApproverRequests("user-hr", HR_PERMS)).toBe(false);
  });

  it("degrades to Admin — never to any HR approver — when nobody resolves", async () => {
    // Account renamed or deactivated: the rule must still hold.
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    expect(await canApproveHrApproverRequests("user-hr", HR_PERMS)).toBe(false);
    expect(await canApproveHrApproverRequests("user-someadmin", ADMIN_PERMS)).toBe(true);
  });
});

describe("leaveDecisionBlockedReason", () => {
  it("blocks an approver deciding their own day", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-hr" } as never);
    const reason = await leaveDecisionBlockedReason({
      approverUserId: "user-hr",
      perms: HR_PERMS,
      employeeIds: ["emp-hr"],
    });
    expect(reason).toMatch(/can't decide your own/i);
  });

  it("blocks it even inside a bulk batch that is mostly other people", async () => {
    // The /hr/attendance grid decides many days at once — one own day in the
    // batch must fail the whole call, not be quietly skipped.
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-hr" } as never);
    const reason = await leaveDecisionBlockedReason({
      approverUserId: "user-hr",
      perms: HR_PERMS,
      employeeIds: ["emp-staff", "emp-staff", "emp-hr"],
    });
    expect(reason).toMatch(/can't decide your own/i);
  });

  it("blocks one HR approver deciding another HR approver's day", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-hr2" } as never);
    const reason = await leaveDecisionBlockedReason({
      approverUserId: "user-hr2",
      perms: HR_PERMS,
      employeeIds: ["emp-hr"],
    });
    expect(reason).toMatch(/designated approver/i);
  });

  it("lets the designated approver decide an HR approver's day", async () => {
    expect(
      await leaveDecisionBlockedReason({
        approverUserId: "user-owner",
        perms: ADMIN_PERMS,
        employeeIds: ["emp-hr"],
      }),
    ).toBeNull();
  });

  it("leaves ordinary staff decisions alone", async () => {
    expect(
      await leaveDecisionBlockedReason({
        approverUserId: "user-hr",
        perms: HR_PERMS,
        employeeIds: ["emp-staff"],
      }),
    ).toBeNull();
  });

  it("counts the restricted days when a batch mixes several HR approvers", async () => {
    const reason = await leaveDecisionBlockedReason({
      approverUserId: "user-hr2",
      perms: HR_PERMS,
      employeeIds: ["emp-hr", "emp-owner", "emp-staff"],
    });
    expect(reason).toMatch(/^2 of these days/);
  });

  it("is a no-op on an empty batch", async () => {
    expect(
      await leaveDecisionBlockedReason({ approverUserId: "user-hr", perms: HR_PERMS, employeeIds: [] }),
    ).toBeNull();
  });
});

describe("reviewQueueScope", () => {
  it("hides an HR Manager's own row AND every other HR approver's", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-hr2" } as never);
    const scope = await reviewQueueScope("user-hr2", HR_PERMS);
    expect(scope.employeeId!.notIn.sort()).toEqual(["emp-hr", "emp-hr2", "emp-owner"]);
  });

  it("hides only their own row from the designated approver", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-owner" } as never);
    const scope = await reviewQueueScope("user-owner", ADMIN_PERMS);
    expect(scope.employeeId!.notIn).toEqual(["emp-owner"]);
  });

  it("returns an empty filter for an approver with no linked employee record", async () => {
    // A pure admin login has nothing of its own to hide.
    expect(await reviewQueueScope("user-owner", ADMIN_PERMS)).toEqual({});
  });
});
