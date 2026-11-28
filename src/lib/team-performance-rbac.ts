import type { Permissions } from "./rbac";

export const TP_OVERVIEW = "/performance/overview";
export const TP_SUPPORT = "/performance/candidate-support";
export const TP_UNANSWERED = "/performance/unanswered";
export const TP_BDE = "/performance/bde";

/** Every page of the Team Performance module. */
export const TEAM_PERFORMANCE_PAGES = [TP_OVERVIEW, TP_SUPPORT, TP_UNANSWERED, TP_BDE] as const;
export type TeamPerformancePage = (typeof TEAM_PERFORMANCE_PAGES)[number];

/** Role names (case-insensitive) that always get the whole module, like admins. */
const FULL_ACCESS_ROLE_NAMES = ["hr manager"];

/**
 * Full access to Team Performance: admins and HR Manager — every page, plus
 * session-based score ingest. Other roles get only the pages ticked for them
 * in Role Management (see canViewTeamPerformancePage).
 */
export function hasFullTeamPerformanceAccess(p: Permissions | null | undefined): boolean {
  if (!p) return false;
  if (p.isAdmin) return true;
  return FULL_ACCESS_ROLE_NAMES.includes((p.roleName ?? "").trim().toLowerCase());
}

/**
 * Per-page access. Admin / HR Manager see everything; any other role sees a
 * page only when that exact page is in its Role.pages (Role Management), so
 * e.g. Operations can be given Candidate Support + Unanswered Queries without
 * the Overview or BDE pages.
 */
export function canViewTeamPerformancePage(
  p: Permissions | null | undefined,
  href: TeamPerformancePage,
): boolean {
  if (!p) return false;
  if (hasFullTeamPerformanceAccess(p)) return true;
  return p.pages.includes(href);
}

/** Any Team Performance page at all (e.g. for the holidays endpoint). */
export function canViewAnyTeamPerformancePage(p: Permissions | null | undefined): boolean {
  return TEAM_PERFORMANCE_PAGES.some((h) => canViewTeamPerformancePage(p, h));
}
