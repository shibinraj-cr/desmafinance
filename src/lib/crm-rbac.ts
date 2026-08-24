import type { Permissions } from "./rbac";
import { isAdmin, canSeePage } from "./rbac";
import { getLeadPulseAccess } from "./lead-pulse-rbac";

/**
 * Capability marker (NOT a real route) granting VIEW-ONLY access to the whole
 * team's CRM Team Activity dashboard. A role gets it to mark a sales-team lead
 * who oversees the team while staying a normal BDE — without the CRM-admin
 * powers (assign / import / settings) that `canManageCrm` carries. The nav never
 * renders it (it isn't in MODULES); it's purely a permission flag.
 */
export const CRM_TEAM_LEAD_PAGE = "/crm/team-all";

/**
 * The Message Templates page. Granting a role this page lets it author the CRM
 * email/WhatsApp templates (see {@link CrmAccess.canManageTemplates}) WITHOUT
 * the full CRM-admin powers of `/crm/settings`. This is how a marketing
 * supervisor (e.g. Suhaina) manages templates while staying a normal BDE.
 */
export const CRM_TEMPLATES_PAGE = "/crm/templates";

/**
 * Capability marker (NOT a real route) granting the ability to assign / reassign
 * leads to consultants (see {@link CrmAccess.canAssign}) WITHOUT the rest of the
 * CRM-admin tier that `/crm/settings` carries (bulk import, bulk email,
 * Settings). This lets a sales-team lead re-distribute leads across the team
 * while staying a normal BDE. The nav never renders it (it isn't in MODULES);
 * it's purely a permission flag read by getCrmAccess().
 */
export const CRM_ASSIGN_PAGE = "/crm/assign";

/**
 * Capability marker (NOT a real route) granting access to the full lead History
 * tab (see {@link CrmAccess.canViewHistory}) — the complete activity log incl.
 * opens, note before/after and mail/call detail — WITHOUT the other CRM-admin
 * powers. Paired with {@link CRM_ASSIGN_PAGE} for a sales-team lead who oversees
 * the team. Purely a permission flag; not in MODULES.
 */
export const CRM_HISTORY_PAGE = "/crm/history";

/**
 * The BDE Enrollment dashboard (`/crm/team/bde-enrollment`) — a money view of
 * enrolment & conversion figures, built admin-only. Granting a role this page
 * lets it view that dashboard WITHOUT any other admin-only page, e.g. a
 * marketing supervisor who needs enrolment figures but not the rest of the
 * admin surface. Checked directly by the page (not part of `CrmAccess`, since
 * nothing else derives from it).
 */
export const CRM_BDE_ENROLLMENT_PAGE = "/crm/team/bde-enrollment";

/**
 * Resolved CRM capabilities for the current user. Mirrors the shape of
 * `LeadPulseAccess` — a single object the page/API layers branch on.
 *
 * Capability rules (must hold in BOTH the UI and the API):
 *   - Everyone with CRM view access sees ALL leads (the list is NOT filtered
 *     by assignee).
 *   - Edit (status / fields / notes / comms-logging) is allowed only when the
 *     lead is assigned to the current user — unless they are a system admin or
 *     a Lead Pulse supervisor, who may edit any lead. See `canEditLead`.
 *   - Assign / reassign, the full History tab, bulk import, and Settings need
 *     the CRM-admin tier (`canManageCrm`): system admins, plus any role that
 *     can see the CRM Settings page (the CRM control panel). This lets a
 *     non-system-admin (e.g. a marketing supervisor) run the CRM without
 *     gaining Finance/HR/user-management access.
 *   - Assign / reassign and the full History tab can ALSO be granted à la carte
 *     via the {@link CRM_ASSIGN_PAGE} / {@link CRM_HISTORY_PAGE} markers, so a
 *     sales-team lead gets exactly those two powers without bulk import, bulk
 *     email, or Settings.
 */
export type CrmAccess = {
  userId: string;
  isAdmin: boolean;
  /** True when the user's Lead Pulse role is l1 or l2. */
  isBde: boolean;
  /** True when the user's Lead Pulse role is supervisor. */
  isSupervisor: boolean;
  /**
   * View-only CRM team lead — may see the WHOLE team's Team Activity dashboard
   * without the CRM-admin powers of `canManageCrm`. Granted via the
   * {@link CRM_TEAM_LEAD_PAGE} capability marker, so a sales-team head can
   * oversee the team while remaining a normal BDE.
   */
  isCrmTeamLead: boolean;
  /**
   * CRM-admin tier — broader than CRM viewing, narrower than system admin.
   * True for system admins and for any role granted the `/crm/settings` page.
   * Gates assign / import / bulk-email / history / settings.
   */
  canManageCrm: boolean;
  /**
   * Author/edit CRM email & WhatsApp templates. True for full CRM admins and
   * for any role granted the {@link CRM_TEMPLATES_PAGE} — so a marketing
   * supervisor can manage templates without CRM assign/import/settings powers.
   */
  canManageTemplates: boolean;
  /** BDE display name from the Lead Pulse roster (null when not a BDE). */
  bdeDisplayName: string | null;

  canViewLeads: boolean;
  canCreateLeads: boolean;
  canBulkImport: boolean;
  /** Send a bulk email to many leads at once (CRM-admin, like bulk import). */
  canBulkEmail: boolean;
  /**
   * Assign / reassign leads to consultants. True for full CRM admins and for any
   * role granted the {@link CRM_ASSIGN_PAGE} marker — so a sales-team lead can
   * re-distribute leads without CRM import/bulk-email/settings powers.
   */
  canAssign: boolean;
  /**
   * View the full lead History tab. True for full CRM admins and for any role
   * granted the {@link CRM_HISTORY_PAGE} marker.
   */
  canViewHistory: boolean;
  canManageSettings: boolean;
};

export async function getCrmAccess(
  userId: string,
  perms: Permissions | null,
): Promise<CrmAccess> {
  const admin = isAdmin(perms ?? null);
  const lp = await getLeadPulseAccess(userId, perms ?? null);
  // canSubmitEntries already encodes `active && (l1 || l2)` — so a deactivated
  // BDE role immediately loses CRM create/edit rights, matching how the rest of
  // the CRM gates on the active flag (getAssignableBdes, the assign route).
  const isBde = lp.canSubmitEntries;
  const isSupervisor = lp.role === "supervisor";
  // Custom (non-built-in) roles can be granted /crm/leads explicitly.
  const hasPage = perms ? canSeePage(perms, "/crm/leads") : false;
  const isCrmTeamLead = perms ? canSeePage(perms, CRM_TEAM_LEAD_PAGE) : false;
  // CRM-admin tier: system admins, plus anyone whose role can see the CRM
  // Settings page. Granting a role `/crm/settings` therefore promotes it to
  // CRM admin — no code change needed for future CRM admins.
  const canManageCrm = admin || (perms ? canSeePage(perms, "/crm/settings") : false);
  // Narrow operational markers — let a sales-team lead assign/reassign leads and
  // read the full History tab without the full CRM-admin tier (import, bulk
  // email, settings). Same "one capability, not all of CRM admin" pattern as the
  // team-lead and templates markers.
  const canAssignLeads = canManageCrm || (perms ? canSeePage(perms, CRM_ASSIGN_PAGE) : false);
  const canViewLeadHistory = canManageCrm || (perms ? canSeePage(perms, CRM_HISTORY_PAGE) : false);
  // Template authoring: full CRM admins, plus any role explicitly granted the
  // Message Templates page (e.g. a marketing supervisor).
  const canManageTemplates = canManageCrm || (perms ? canSeePage(perms, CRM_TEMPLATES_PAGE) : false);

  return {
    userId,
    isAdmin: admin,
    isBde,
    isSupervisor,
    isCrmTeamLead,
    canManageCrm,
    canManageTemplates,
    bdeDisplayName: lp.displayName,
    canViewLeads: admin || isBde || isSupervisor || isCrmTeamLead || hasPage,
    canCreateLeads: canManageCrm || isBde,
    canBulkImport: canManageCrm,
    canBulkEmail: canManageCrm,
    canAssign: canAssignLeads,
    canViewHistory: canViewLeadHistory,
    canManageSettings: canManageCrm,
  };
}

/**
 * Whether the current user may MUTATE a given lead (status, fields, notes,
 * comms logging). System admins and Lead Pulse supervisors may edit any lead;
 * BDEs may edit only leads assigned to them. Enforced identically in the API
 * and the UI.
 */
export function canEditLead(
  access: CrmAccess,
  lead: { assignedToId: string | null },
  userId: string,
): boolean {
  return (
    access.isAdmin ||
    access.isSupervisor ||
    (access.isBde && lead.assignedToId === userId)
  );
}
