/**
 * SOP Management access control.
 *
 * Same shape as `ops-rbac.ts` and `hiring/rbac.ts`: one resolver, called by the
 * PAGE and by the API route, so there is exactly one answer to "may this person
 * do this". UI visibility is a consequence of the resolver, never a substitute
 * for it (§29).
 *
 * ── Where the seven roles in the brief come from ────────────────────────────
 * Two of them are global tiers and five are positions someone holds ON a
 * particular SOP. Modelling them all as global roles would have been wrong:
 * "Reviewer" is not a job title, it is who is named on this version.
 *
 *   Super Admin   — system `Permissions.isAdmin`.
 *   SOP Admin     — granted `/sop/settings`. Granting a Desgro role that page
 *                   mints a SOP admin with no code change, the same trick as
 *                   `/crm/settings` and `/operations/settings`.
 *   SOP Creator   — granted `/sop/create`.
 *   Process Owner — DERIVED: their employee record is the SOP's owner.
 *   Reviewer      — DERIVED: named as `SopVersion.reviewerId` on this version.
 *   Approver      — DERIVED: named as `SopVersion.approverId` on this version.
 *   Employee      — everyone else: read the published SOPs they are entitled
 *                   to, and acknowledge the ones assigned to them.
 *
 * The derived three are per-SOP, so they live in the `canX(access, sop, …)`
 * functions below rather than in the access object.
 */

import type { Permissions } from "@/lib/rbac";
import { isAdmin, canSeePage } from "@/lib/rbac";
import { EDITABLE_STATUSES, type Confidentiality, type SopStatus } from "./constants";

/** Granting a role this page promotes it to the SOP-admin tier. */
export const SOP_ADMIN_ANCHOR = "/sop/settings";
/** Granting a role this page lets it author SOPs. */
export const SOP_CREATOR_ANCHOR = "/sop/create";
/** Any of these marks a role as an active participant in SOP governance. */
export const SOP_GOVERNANCE_ANCHORS = ["/sop/review", "/sop/kpi-reviews", "/sop/acknowledgements"];
/**
 * The reading surface. Open to every signed-in user (see ALWAYS_VISIBLE_PAGES
 * in src/lib/rbac.ts) — an SOP nobody can find is not a published SOP, and an
 * employee who must acknowledge one has to be able to reach it.
 */
export const SOP_READER_PAGES = ["/sop/library", "/sop/my-sops"];

export type SopAccess = {
  userId: string;
  /** The signed-in user's linked employee record, when they have one. */
  employeeId: string | null;
  /** Department ids the employee belongs to — drives "Department Only" reads. */
  departmentIds: string[];
  /** Departments this employee heads — drives "Management" reads. */
  headOfDepartmentIds: string[];
  isAdmin: boolean;
  /** SOP-admin tier: publish, archive, manage categories, see everything. */
  isSopAdmin: boolean;
  /** May start a new SOP. */
  canCreate: boolean;
  /** Sits in the governance tier (a reviewer/approver pool member). */
  isGovernance: boolean;
  /** Management-tier reader (approver capability, dept head, or SOP admin). */
  isManagement: boolean;
  /** May archive / restore an SOP. */
  canArchive: boolean;
  /** May add, rename and retire SOP categories. */
  canManageCategories: boolean;
};

/** The stored side of the viewer's employee record, or null when unlinked. */
export type SopEmployeeContext = {
  employeeId: string;
  departmentIds: string[];
  headOfDepartmentIds: string[];
} | null;

/**
 * Pure resolver — no DB, so it is cheap on every request and directly testable.
 * `employee` is fetched once by the caller (see `loadSopAccess`).
 */
export function getSopAccess(
  userId: string,
  perms: Permissions | null,
  employee: SopEmployeeContext = null,
): SopAccess {
  const admin = isAdmin(perms ?? null);
  const isSopAdmin = admin || (perms ? canSeePage(perms, SOP_ADMIN_ANCHOR) : false);
  const canCreate = isSopAdmin || (perms ? canSeePage(perms, SOP_CREATOR_ANCHOR) : false);
  const isGovernance =
    isSopAdmin || (perms ? SOP_GOVERNANCE_ANCHORS.some((p) => canSeePage(perms, p)) : false);

  const headOfDepartmentIds = employee?.headOfDepartmentIds ?? [];
  // "Management" for confidentiality purposes: someone who signs things off,
  // heads a department, or administers SOPs. `canApprove` is the app's existing
  // sign-off capability flag, so this needs no new role.
  const isManagement =
    isSopAdmin || !!perms?.canApprove || headOfDepartmentIds.length > 0;

  return {
    userId,
    employeeId: employee?.employeeId ?? null,
    departmentIds: employee?.departmentIds ?? [],
    headOfDepartmentIds,
    isAdmin: admin,
    isSopAdmin,
    canCreate,
    isGovernance,
    isManagement,
    canArchive: isSopAdmin,
    canManageCategories: isSopAdmin,
  };
}

// ── Per-SOP positions ───────────────────────────────────────────────────────

/** The minimum an authorisation check needs to know about an SOP. */
export type SopLike = {
  id: string;
  ownerEmployeeId: string;
  departmentId: string | null;
  confidentiality: string;
  createdById: string | null;
  isArchived: boolean;
  deletedAt: Date | null;
};

/** The minimum an authorisation check needs to know about one version. */
export type SopVersionLike = {
  id: string;
  status: string;
  isLocked: boolean;
  reviewerId: string | null;
  approverId: string | null;
  createdById: string | null;
  ownerEmployeeId: string;
  confidentiality: string;
  departmentId: string | null;
  applicableDepartmentIds: string[];
  applicableRoleIds: string[];
  applicableEmployeeIds: string[];
};

/** Is the viewer the SOP's process owner? */
export function isProcessOwner(access: SopAccess, sop: Pick<SopLike, "ownerEmployeeId">): boolean {
  return !!access.employeeId && access.employeeId === sop.ownerEmployeeId;
}

/** Did the viewer create this SOP (or this version)? */
export function isAuthor(
  access: SopAccess,
  target: { createdById: string | null },
): boolean {
  return !!target.createdById && target.createdById === access.userId;
}

export function isNamedReviewer(access: SopAccess, version: Pick<SopVersionLike, "reviewerId">): boolean {
  return !!version.reviewerId && version.reviewerId === access.userId;
}

export function isNamedApprover(access: SopAccess, version: Pick<SopVersionLike, "approverId">): boolean {
  return !!version.approverId && version.approverId === access.userId;
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * May the viewer READ this SOP?
 *
 * Confidentiality is the gate, and it is checked here — not in a query filter
 * that a future caller might forget. Everyone directly involved (owner, author,
 * named reviewer/approver) can always read their own SOP whatever the level;
 * otherwise the level decides.
 */
export function canViewSop(
  access: SopAccess,
  sop: SopLike,
  version?: Pick<SopVersionLike, "applicableDepartmentIds" | "applicableEmployeeIds"> | null,
): boolean {
  if (sop.deletedAt) return access.isSopAdmin;
  // Archived SOPs stay readable to admins only (§20).
  if (sop.isArchived && !access.isSopAdmin) return false;
  if (access.isSopAdmin) return true;

  // Directly involved — always.
  if (isProcessOwner(access, sop) || isAuthor(access, sop)) return true;

  // Explicitly published to this person.
  if (
    access.employeeId &&
    version?.applicableEmployeeIds?.includes(access.employeeId)
  ) {
    return true;
  }

  const level = sop.confidentiality as Confidentiality;
  switch (level) {
    case "general":
      return true;
    case "department": {
      const inOwnDept = !!sop.departmentId && access.departmentIds.includes(sop.departmentId);
      const inPublishedDept = (version?.applicableDepartmentIds ?? []).some((d) =>
        access.departmentIds.includes(d),
      );
      return inOwnDept || inPublishedDept || access.isManagement;
    }
    case "management":
      return access.isManagement;
    case "restricted":
      // Only the people named on it, and SOP admins (handled above).
      return false;
    default:
      // An unrecognised level is treated as the strictest — failing closed is
      // the only safe default for a confidentiality field.
      return false;
  }
}

/** Same question for one specific version (a reviewer must reach a draft). */
export function canViewVersion(
  access: SopAccess,
  sop: SopLike,
  version: SopVersionLike,
): boolean {
  if (
    isNamedReviewer(access, version) ||
    isNamedApprover(access, version) ||
    isAuthor(access, version)
  ) {
    return true;
  }
  // An unpublished version is a work in progress: only the people working on it
  // (above), the owner, and admins see it — not the whole company.
  if (version.status !== "published" && version.status !== "archived") {
    return access.isSopAdmin || isProcessOwner(access, sop);
  }
  return canViewSop(access, sop, version);
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * May the viewer EDIT this version's content?
 *
 * Two independent conditions, both required:
 *   1. the version is in an editable state and not locked — a published
 *      version is history and nobody, admin included, rewrites it (§12);
 *   2. the viewer owns, authored or administers it.
 */
export function canEditVersion(
  access: SopAccess,
  sop: SopLike,
  version: Pick<SopVersionLike, "status" | "isLocked" | "createdById">,
): boolean {
  if (sop.deletedAt || sop.isArchived) return false;
  if (version.isLocked) return false;
  if (!EDITABLE_STATUSES.includes(version.status as SopStatus)) return false;
  return access.isSopAdmin || isProcessOwner(access, sop) || isAuthor(access, version);
}

/** May the viewer send this version to its reviewer? */
export function canRequestReview(
  access: SopAccess,
  sop: SopLike,
  version: Pick<SopVersionLike, "status" | "isLocked" | "createdById">,
): boolean {
  return canEditVersion(access, sop, version);
}

/** May the viewer act on the REVIEW stage of this version? */
export function canReview(access: SopAccess, sop: SopLike, version: SopVersionLike): boolean {
  if (sop.deletedAt || sop.isArchived || version.isLocked) return false;
  if (version.status !== "review_requested") return false;
  return access.isSopAdmin || isNamedReviewer(access, version);
}

/** May the viewer act on the APPROVAL stage of this version? */
export function canApproveVersion(
  access: SopAccess,
  sop: SopLike,
  version: SopVersionLike,
): boolean {
  if (sop.deletedAt || sop.isArchived || version.isLocked) return false;
  if (version.status !== "approval_pending") return false;
  return access.isSopAdmin || isNamedApprover(access, version);
}

/**
 * May the viewer PUBLISH an approved version?
 *
 * Deliberately narrower than approval: §17 gives publishing to SOP Admin and
 * Super Admin only. The approver signs the content off; a publisher decides it
 * goes live, to whom, and from when.
 */
export function canPublish(
  access: SopAccess,
  sop: SopLike,
  version: Pick<SopVersionLike, "status" | "isLocked">,
): boolean {
  if (sop.deletedAt || sop.isArchived || version.isLocked) return false;
  if (version.status !== "approved") return false;
  return access.isSopAdmin;
}

/** May the viewer start the next version of a published SOP? */
export function canCreateRevision(access: SopAccess, sop: SopLike): boolean {
  if (sop.deletedAt || sop.isArchived) return false;
  return access.isSopAdmin || isProcessOwner(access, sop) || isAuthor(access, sop);
}

/** May the viewer archive (or restore) this SOP? */
export function canArchiveSop(access: SopAccess, sop: SopLike): boolean {
  if (sop.deletedAt) return false;
  return access.canArchive;
}

/**
 * May the viewer record a KPI result against this SOP? The process owner runs
 * their own numbers; the named KPI owner runs theirs; admins can do either.
 */
export function canRecordKpiReview(
  access: SopAccess,
  sop: SopLike,
  kpi: { kpiOwnerEmployeeId: string | null },
): boolean {
  if (sop.deletedAt) return false;
  if (access.isSopAdmin || isProcessOwner(access, sop)) return true;
  return !!access.employeeId && kpi.kpiOwnerEmployeeId === access.employeeId;
}

/**
 * May the viewer soft-delete this SOP? Only an unpublished, never-published SOP
 * can go — once something has been published, the record is permanent and the
 * way out is Archive.
 */
export function canDeleteSop(
  access: SopAccess,
  sop: SopLike & { currentVersionId: string | null },
): boolean {
  if (sop.deletedAt) return false;
  if (sop.currentVersionId) return false;
  return access.isSopAdmin || isAuthor(access, sop) || isProcessOwner(access, sop);
}
