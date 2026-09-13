import { describe, expect, it } from "vitest";
import type { Permissions } from "@/lib/rbac";
import { canSeePage } from "@/lib/rbac";
import {
  SOP_ADMIN_ANCHOR,
  SOP_CREATOR_ANCHOR,
  canApproveVersion,
  canArchiveSop,
  canCreateRevision,
  canDeleteSop,
  canEditVersion,
  canPublish,
  canRecordKpiReview,
  canReview,
  canViewSop,
  canViewVersion,
  getSopAccess,
  isProcessOwner,
  type SopLike,
  type SopVersionLike,
} from "@/lib/sop/rbac";

function perms(over: Partial<Permissions> = {}): Permissions {
  return {
    isAdmin: false,
    canApprove: false,
    needsApproval: true,
    draftFirst: false,
    pages: [],
    roleName: "User",
    ...over,
  };
}

const employee = (id: string, departmentIds: string[] = [], heads: string[] = []) => ({
  employeeId: id,
  departmentIds,
  headOfDepartmentIds: heads,
});

function sop(over: Partial<SopLike> = {}): SopLike {
  return {
    id: "sop1",
    ownerEmployeeId: "emp-owner",
    departmentId: "dept-ops",
    confidentiality: "general",
    createdById: "user-author",
    isArchived: false,
    deletedAt: null,
    ...over,
  };
}

function version(over: Partial<SopVersionLike> = {}): SopVersionLike {
  return {
    id: "v1",
    status: "draft",
    isLocked: false,
    reviewerId: null,
    approverId: null,
    createdById: "user-author",
    ownerEmployeeId: "emp-owner",
    confidentiality: "general",
    departmentId: "dept-ops",
    applicableDepartmentIds: [],
    applicableRoleIds: [],
    applicableEmployeeIds: [],
    ...over,
  };
}

describe("SOP access tiers", () => {
  it("makes a system admin a SOP admin", () => {
    const a = getSopAccess("u1", perms({ isAdmin: true }));
    expect(a.isSopAdmin).toBe(true);
    expect(a.canCreate).toBe(true);
    expect(a.canArchive).toBe(true);
    expect(a.canManageCategories).toBe(true);
  });

  it("mints a SOP admin from the settings page grant, with no code change", () => {
    const a = getSopAccess("u1", perms({ pages: [SOP_ADMIN_ANCHOR] }));
    expect(a.isSopAdmin).toBe(true);
    expect(a.isAdmin).toBe(false);
    expect(a.canCreate).toBe(true);
  });

  it("mints a creator from the create page grant, without admin powers", () => {
    const a = getSopAccess("u1", perms({ pages: [SOP_CREATOR_ANCHOR] }));
    expect(a.canCreate).toBe(true);
    expect(a.isSopAdmin).toBe(false);
    expect(a.canArchive).toBe(false);
    expect(a.canManageCategories).toBe(false);
  });

  it("gives a plain employee nothing beyond reading", () => {
    const a = getSopAccess("u1", perms(), employee("emp1", ["dept-ops"]));
    expect(a.canCreate).toBe(false);
    expect(a.isSopAdmin).toBe(false);
    expect(a.isGovernance).toBe(false);
    expect(a.isManagement).toBe(false);
    expect(a.employeeId).toBe("emp1");
    expect(a.departmentIds).toEqual(["dept-ops"]);
  });

  it("counts an approver or a department head as management", () => {
    expect(getSopAccess("u1", perms({ canApprove: true })).isManagement).toBe(true);
    expect(getSopAccess("u1", perms(), employee("emp1", [], ["dept-ops"])).isManagement).toBe(true);
  });

  it("survives a null permissions object", () => {
    const a = getSopAccess("u1", null);
    expect(a.isSopAdmin).toBe(false);
    expect(a.canCreate).toBe(false);
    expect(a.employeeId).toBeNull();
  });
});

describe("the reading pages need no grant", () => {
  it("shows the library and My SOPs to a role with no pages at all", () => {
    const p = perms();
    expect(canSeePage(p, "/sop/library")).toBe(true);
    expect(canSeePage(p, "/sop/my-sops")).toBe(true);
  });

  it("still gates authoring, governance and admin behind a grant", () => {
    const p = perms();
    for (const page of [
      "/sop/create",
      "/sop/dashboard",
      "/sop/review",
      "/sop/kpi-reviews",
      "/sop/acknowledgements",
      "/sop/archived",
      "/sop/settings",
    ]) {
      expect(canSeePage(p, page)).toBe(false);
    }
  });
});

describe("confidentiality", () => {
  const outsider = getSopAccess("u-outsider", perms(), employee("emp-other", ["dept-hr"]));
  const inDept = getSopAccess("u-dept", perms(), employee("emp-dept", ["dept-ops"]));
  const manager = getSopAccess("u-mgr", perms({ canApprove: true }), employee("emp-mgr", ["dept-hr"]));
  const admin = getSopAccess("u-admin", perms({ isAdmin: true }));

  it("lets anyone read a General SOP", () => {
    expect(canViewSop(outsider, sop({ confidentiality: "general" }))).toBe(true);
  });

  it("limits a Department Only SOP to its department (or management)", () => {
    const s = sop({ confidentiality: "department" });
    expect(canViewSop(outsider, s)).toBe(false);
    expect(canViewSop(inDept, s)).toBe(true);
    expect(canViewSop(manager, s)).toBe(true);
  });

  it("opens a Department Only SOP to a department it was published to", () => {
    const s = sop({ confidentiality: "department" });
    const v = version({ applicableDepartmentIds: ["dept-hr"] });
    expect(canViewSop(outsider, s, v)).toBe(true);
  });

  it("limits a Management SOP to management", () => {
    const s = sop({ confidentiality: "management" });
    expect(canViewSop(outsider, s)).toBe(false);
    expect(canViewSop(inDept, s)).toBe(false);
    expect(canViewSop(manager, s)).toBe(true);
    expect(canViewSop(admin, s)).toBe(true);
  });

  it("limits a Restricted SOP to the people named on it", () => {
    const s = sop({ confidentiality: "restricted" });
    expect(canViewSop(manager, s)).toBe(false);
    expect(canViewSop(inDept, s)).toBe(false);
    expect(canViewSop(admin, s)).toBe(true);

    const owner = getSopAccess("u-owner", perms(), employee("emp-owner"));
    expect(canViewSop(owner, s)).toBe(true);

    const author = getSopAccess("user-author", perms());
    expect(canViewSop(author, s)).toBe(true);

    // Explicitly published to this individual.
    const named = getSopAccess("u-named", perms(), employee("emp-named"));
    expect(canViewSop(named, s, version({ applicableEmployeeIds: ["emp-named"] }))).toBe(true);
  });

  it("fails closed on an unrecognised confidentiality value", () => {
    expect(canViewSop(inDept, sop({ confidentiality: "top-secret" }))).toBe(false);
    // An admin still gets through, so a bad value cannot lock everyone out.
    expect(canViewSop(admin, sop({ confidentiality: "top-secret" }))).toBe(true);
  });

  it("hides an archived SOP from everyone but a SOP admin", () => {
    const s = sop({ isArchived: true });
    expect(canViewSop(inDept, s)).toBe(false);
    expect(canViewSop(admin, s)).toBe(true);
  });

  it("hides a soft-deleted SOP from everyone but a SOP admin", () => {
    const s = sop({ deletedAt: new Date() });
    expect(canViewSop(admin, s)).toBe(true);
    expect(canViewSop(inDept, s)).toBe(false);
  });
});

describe("unpublished versions are not public", () => {
  const reader = getSopAccess("u-reader", perms(), employee("emp-reader", ["dept-ops"]));

  it("hides a draft from a reader entitled to the published SOP", () => {
    expect(canViewVersion(reader, sop(), version({ status: "draft" }))).toBe(false);
  });

  it("shows a draft to its author, its reviewer and its approver", () => {
    const author = getSopAccess("user-author", perms());
    expect(canViewVersion(author, sop(), version({ status: "draft" }))).toBe(true);

    const reviewer = getSopAccess("u-rev", perms());
    expect(
      canViewVersion(reviewer, sop(), version({ status: "review_requested", reviewerId: "u-rev" })),
    ).toBe(true);

    const approver = getSopAccess("u-app", perms());
    expect(
      canViewVersion(approver, sop(), version({ status: "approval_pending", approverId: "u-app" })),
    ).toBe(true);
  });

  it("shows a published version to anyone entitled to the SOP", () => {
    expect(canViewVersion(reader, sop(), version({ status: "published", isLocked: true }))).toBe(true);
  });
});

describe("editing", () => {
  const owner = getSopAccess("u-owner", perms(), employee("emp-owner"));
  const author = getSopAccess("user-author", perms());
  const admin = getSopAccess("u-admin", perms({ isAdmin: true }));
  const stranger = getSopAccess("u-stranger", perms(), employee("emp-stranger"));

  it("lets the owner, the author and an admin edit a draft", () => {
    const v = version({ status: "draft" });
    expect(canEditVersion(owner, sop(), v)).toBe(true);
    expect(canEditVersion(author, sop(), v)).toBe(true);
    expect(canEditVersion(admin, sop(), v)).toBe(true);
    expect(canEditVersion(stranger, sop(), v)).toBe(false);
  });

  it("refuses to edit a LOCKED version — even for a system admin", () => {
    const published = version({ status: "published", isLocked: true });
    expect(canEditVersion(admin, sop(), published)).toBe(false);
    expect(canEditVersion(owner, sop(), published)).toBe(false);
  });

  it("refuses to edit a version that is out for review or approval", () => {
    expect(canEditVersion(owner, sop(), version({ status: "review_requested" }))).toBe(false);
    expect(canEditVersion(owner, sop(), version({ status: "approval_pending" }))).toBe(false);
    expect(canEditVersion(owner, sop(), version({ status: "approved" }))).toBe(false);
  });

  it("lets an author edit again once changes are requested", () => {
    expect(canEditVersion(author, sop(), version({ status: "changes_requested" }))).toBe(true);
  });

  it("refuses to edit anything on an archived SOP", () => {
    expect(canEditVersion(admin, sop({ isArchived: true }), version({ status: "draft" }))).toBe(false);
  });
});

describe("review and approval", () => {
  const reviewer = getSopAccess("u-rev", perms());
  const approver = getSopAccess("u-app", perms());
  const admin = getSopAccess("u-admin", perms({ isAdmin: true }));
  const owner = getSopAccess("u-owner", perms(), employee("emp-owner"));

  it("lets only the named reviewer (or an admin) act at the review gate", () => {
    const v = version({ status: "review_requested", reviewerId: "u-rev" });
    expect(canReview(reviewer, sop(), v)).toBe(true);
    expect(canReview(admin, sop(), v)).toBe(true);
    expect(canReview(approver, sop(), v)).toBe(false);
    // The owner does not get to review their own SOP just for owning it.
    expect(canReview(owner, sop(), v)).toBe(false);
  });

  it("lets only the named approver (or an admin) act at the approval gate", () => {
    const v = version({ status: "approval_pending", approverId: "u-app" });
    expect(canApproveVersion(approver, sop(), v)).toBe(true);
    expect(canApproveVersion(admin, sop(), v)).toBe(true);
    expect(canApproveVersion(reviewer, sop(), v)).toBe(false);
  });

  it("refuses a decision at the wrong stage", () => {
    expect(canReview(reviewer, sop(), version({ status: "draft", reviewerId: "u-rev" }))).toBe(false);
    expect(
      canApproveVersion(approver, sop(), version({ status: "review_requested", approverId: "u-app" })),
    ).toBe(false);
  });
});

describe("publishing is narrower than approving", () => {
  const approver = getSopAccess("u-app", perms());
  const owner = getSopAccess("u-owner", perms(), employee("emp-owner"));
  const sopAdmin = getSopAccess("u-sa", perms({ pages: [SOP_ADMIN_ANCHOR] }));

  it("allows a SOP admin to publish an approved version", () => {
    expect(canPublish(sopAdmin, sop(), version({ status: "approved" }))).toBe(true);
  });

  it("refuses the approver and the owner", () => {
    const v = version({ status: "approved", approverId: "u-app" });
    expect(canPublish(approver, sop(), v)).toBe(false);
    expect(canPublish(owner, sop(), v)).toBe(false);
  });

  it("refuses to publish anything that is not approved", () => {
    expect(canPublish(sopAdmin, sop(), version({ status: "draft" }))).toBe(false);
    expect(canPublish(sopAdmin, sop(), version({ status: "approval_pending" }))).toBe(false);
    expect(canPublish(sopAdmin, sop(), version({ status: "published", isLocked: true }))).toBe(false);
  });
});

describe("revision, archive, delete", () => {
  const owner = getSopAccess("u-owner", perms(), employee("emp-owner"));
  const sopAdmin = getSopAccess("u-sa", perms({ pages: [SOP_ADMIN_ANCHOR] }));
  const stranger = getSopAccess("u-x", perms(), employee("emp-x"));

  it("lets the owner or an admin start a revision", () => {
    expect(canCreateRevision(owner, sop())).toBe(true);
    expect(canCreateRevision(sopAdmin, sop())).toBe(true);
    expect(canCreateRevision(stranger, sop())).toBe(false);
  });

  it("limits archiving to SOP admins", () => {
    expect(canArchiveSop(sopAdmin, sop())).toBe(true);
    expect(canArchiveSop(owner, sop())).toBe(false);
  });

  it("allows deleting only an SOP that was never published", () => {
    expect(canDeleteSop(owner, { ...sop(), currentVersionId: null })).toBe(true);
    expect(canDeleteSop(sopAdmin, { ...sop(), currentVersionId: "v-live" })).toBe(false);
    expect(canDeleteSop(stranger, { ...sop(), currentVersionId: null })).toBe(false);
  });
});

describe("KPI results", () => {
  const owner = getSopAccess("u-owner", perms(), employee("emp-owner"));
  const kpiOwner = getSopAccess("u-kpi", perms(), employee("emp-kpi"));
  const stranger = getSopAccess("u-x", perms(), employee("emp-x"));

  it("lets the process owner record any KPI on their SOP", () => {
    expect(canRecordKpiReview(owner, sop(), { kpiOwnerEmployeeId: null })).toBe(true);
  });

  it("lets the named KPI owner record their own", () => {
    expect(canRecordKpiReview(kpiOwner, sop(), { kpiOwnerEmployeeId: "emp-kpi" })).toBe(true);
    expect(canRecordKpiReview(stranger, sop(), { kpiOwnerEmployeeId: "emp-kpi" })).toBe(false);
  });
});

describe("process-owner derivation", () => {
  it("is by employee record, not by login", () => {
    const withEmployee = getSopAccess("u1", perms(), employee("emp-owner"));
    expect(isProcessOwner(withEmployee, sop())).toBe(true);

    // A login with no linked employee is never the process owner, even if the
    // ids happen to look alike.
    const withoutEmployee = getSopAccess("emp-owner", perms());
    expect(isProcessOwner(withoutEmployee, sop())).toBe(false);
  });
});
