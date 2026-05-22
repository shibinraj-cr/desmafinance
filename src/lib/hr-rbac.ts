import type { Permissions } from "./rbac";

/**
 * HR-side capability checks. We piggyback on the existing Role.pages
 * array — any role that has access to /hr/* pages is treated as an HR
 * user; admins always pass. Approval-style actions (leave decisions,
 * salary run approval, publishing policies) additionally require
 * canApprove (HR Manager / Admin).
 */

export function isHrUser(p: Permissions | null | undefined): boolean {
  if (!p) return false;
  if (p.isAdmin) return true;
  return p.pages.some((pg) => pg.startsWith("/hr/"));
}

/** HR users with approval authority — HR Manager or Admin. */
export function canApproveHr(p: Permissions | null | undefined): boolean {
  if (!p) return false;
  if (p.isAdmin) return true;
  return isHrUser(p) && p.canApprove;
}

/** Finance Manager / Admin: download the Axis Bank bulk-upload file. */
export function canDownloadAxis(p: Permissions | null | undefined): boolean {
  if (!p) return false;
  if (p.isAdmin) return true;
  return p.canApprove && p.pages.includes("/hr/salary");
}

/** Self-service: anyone signed in can hit /me/* pages. */
export function isEmployeePortalUser(p: Permissions | null | undefined): boolean {
  if (!p) return false;
  return p.pages.some((pg) => pg.startsWith("/me/")) || p.isAdmin;
}
