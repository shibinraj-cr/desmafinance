import type { Permissions } from "./rbac";
import { isAdmin, canSeePage } from "./rbac";
import { getLeadPulseAccess } from "./lead-pulse-rbac";

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
 */
export type CrmAccess = {
  userId: string;
  isAdmin: boolean;
  /** True when the user's Lead Pulse role is l1 or l2. */
  isBde: boolean;
  /** True when the user's Lead Pulse role is supervisor. */
  isSupervisor: boolean;
  /**
   * CRM-admin tier — broader than CRM viewing, narrower than system admin.
   * True for system admins and for any role granted the `/crm/settings` page.
   * Gates assign / import / bulk-email / history / settings.
   */
  canManageCrm: boolean;
  /** BDE display name from the Lead Pulse roster (null when not a BDE). */
  bdeDisplayName: string | null;

  canViewLeads: boolean;
  canCreateLeads: boolean;
  canBulkImport: boolean;
  /** Send a bulk email to many leads at once (CRM-admin, like bulk import). */
  canBulkEmail: boolean;
  canAssign: boolean;
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
  // CRM-admin tier: system admins, plus anyone whose role can see the CRM
  // Settings page. Granting a role `/crm/settings` therefore promotes it to
  // CRM admin — no code change needed for future CRM admins.
  const canManageCrm = admin || (perms ? canSeePage(perms, "/crm/settings") : false);

  return {
    userId,
    isAdmin: admin,
    isBde,
    isSupervisor,
    canManageCrm,
    bdeDisplayName: lp.displayName,
    canViewLeads: admin || isBde || isSupervisor || hasPage,
    canCreateLeads: canManageCrm || isBde,
    canBulkImport: canManageCrm,
    canBulkEmail: canManageCrm,
    canAssign: canManageCrm,
    canViewHistory: canManageCrm,
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
