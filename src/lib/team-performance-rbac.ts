import type { Permissions } from "./rbac";

/** Every page of the Team Performance module. */
export const TEAM_PERFORMANCE_PAGES = [
  "/performance/overview",
  "/performance/candidate-support",
  "/performance/unanswered",
  "/performance/bde",
] as const;

/** Role names (case-insensitive) that may open Team Performance besides admins. */
const ALLOWED_ROLE_NAMES = ["hr manager"];

/**
 * Team Performance is restricted to Admin and HR Manager.
 *
 * This is deliberately a role check, not just a Role.pages check: the
 * module holds staff scorecards, so granting the page to another role in
 * Role Management must NOT open it up. Admins always pass.
 */
export function canViewTeamPerformance(p: Permissions | null | undefined): boolean {
  if (!p) return false;
  if (p.isAdmin) return true;
  return ALLOWED_ROLE_NAMES.includes((p.roleName ?? "").trim().toLowerCase());
}
