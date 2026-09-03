import type { Permissions } from "./rbac";
import { isAdmin, canSeePage } from "./rbac";

/**
 * Resolved Operations-module capabilities for the current user. Mirrors the
 * shape of `CrmAccess` — a single object the page/API layers branch on.
 *
 * Page-grant based, no separate roster table (the "is this user an ops user /
 * manager" question resolves purely from `Role.pages`, one source of truth):
 *   - The Operations-manager tier (`isOpsManager`) — system admins, plus any
 *     role granted the manager anchor page. Gates template authoring,
 *     assignment, and (later) settings. Granting a role that page promotes it
 *     to ops manager with no code change, exactly like `canManageCrm`.
 *   - An ops user (`isOpsUser`) can view projects / their own work queue.
 *   - Per-project mutation is allowed when the project is assigned to the
 *     current user — unless they are a manager/admin. See `canEditProject`.
 */
export type OpsAccess = {
  userId: string;
  isAdmin: boolean;
  /** Can view projects and their own "My Work" queue. */
  isOpsUser: boolean;
  /** Operations-admin tier — broader than viewing, narrower than system admin. */
  isOpsManager: boolean;
  canViewProjects: boolean;
  canManageTemplates: boolean;
  canAssign: boolean;
};

// Granting a role the Settings page promotes it to the Operations-manager tier
// (assignment, template authoring, settings) — the same trick as `canManageCrm`
// keyed on `/crm/settings`. No code change needed to mint future ops managers.
const OPS_MANAGER_ANCHOR = "/operations/settings";
/**
 * Any workspace page marks a role as an operations user (day-to-day worker).
 * Exported because it is also the assignee roster: the pages that offer an
 * "assign to" picker filter `User.roleRef.pages` on exactly this list, so the
 * dropdown can only ever offer someone `roleIsOpsUser` will accept.
 */
export const OPS_USER_ANCHORS = ["/operations/projects", "/operations/my-work", "/operations/my-tasks"];

/**
 * Pure function of (userId, perms) — no DB. Operations access derives entirely
 * from the role's page grants, so this is trivially testable and cheap to call
 * in every server page / API route.
 */
export function getOpsAccess(userId: string, perms: Permissions | null): OpsAccess {
  const admin = isAdmin(perms ?? null);
  const isOpsManager = admin || (perms ? canSeePage(perms, OPS_MANAGER_ANCHOR) : false);
  const isOpsUser =
    isOpsManager || (perms ? OPS_USER_ANCHORS.some((p) => canSeePage(perms, p)) : false);

  return {
    userId,
    isAdmin: admin,
    isOpsUser,
    isOpsManager,
    canViewProjects: isOpsUser,
    canManageTemplates: isOpsManager,
    canAssign: isOpsManager,
  };
}

/**
 * Whether a role — given its admin flag and granted page hrefs — counts as an
 * operations user. Same rule as `isOpsUser` in `getOpsAccess`, but from raw
 * role fields rather than a `Permissions` object, so it can vet an *assignee*
 * other than the current user (e.g. validating a task's assignedTo). Tasks may
 * only be assigned to ops users.
 */
export function roleIsOpsUser(isAdmin: boolean, pages: string[]): boolean {
  if (isAdmin) return true;
  return pages.includes(OPS_MANAGER_ANCHOR) || OPS_USER_ANCHORS.some((p) => pages.includes(p));
}

/**
 * Whether the current user may MUTATE a given project (status, assignment, its
 * tasks). Managers/admins may edit any project; an ops user may edit only
 * projects assigned to them. Enforced identically in the API and the UI.
 */
export function canEditProject(
  access: OpsAccess,
  project: { assignedToId: string | null },
  userId: string,
): boolean {
  return (
    access.isAdmin ||
    access.isOpsManager ||
    (access.isOpsUser && project.assignedToId === userId)
  );
}

/**
 * Whether the current user may mutate one ad-hoc task (OpsActionItem).
 *
 * A task that hangs off a project inherits that project's rule exactly — the
 * owner (or a manager) runs the candidate's work, so they run its tasks. A
 * **standalone** task has no project to inherit from, so ownership is personal:
 * the person who created it or the person it is assigned to, plus the
 * manager/admin tier who can see everyone's queue anyway.
 */
export function canEditActionItem(
  access: OpsAccess,
  item: {
    project: { assignedToId: string | null } | null;
    createdById: string | null;
    assignedToId: string | null;
  },
  userId: string,
): boolean {
  if (item.project) return canEditProject(access, item.project, userId);
  if (access.isAdmin || access.isOpsManager) return true;
  return access.isOpsUser && (item.createdById === userId || item.assignedToId === userId);
}
