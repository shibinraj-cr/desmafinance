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
 *     lead is assigned to the current user — unless they are an admin. See
 *     `canEditLead`.
 *   - Assign / reassign, the full History tab, bulk import, and Settings are
 *     admin-only.
 */
export type CrmAccess = {
  userId: string;
  isAdmin: boolean;
  /** True when the user's Lead Pulse role is l1 or l2. */
  isBde: boolean;
  /** True when the user's Lead Pulse role is supervisor. */
  isSupervisor: boolean;
  /** BDE display name from the Lead Pulse roster (null when not a BDE). */
  bdeDisplayName: string | null;

  canViewLeads: boolean;
  canCreateLeads: boolean;
  canBulkImport: boolean;
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

  return {
    userId,
    isAdmin: admin,
    isBde,
    isSupervisor,
    bdeDisplayName: lp.displayName,
    canViewLeads: admin || isBde || isSupervisor || hasPage,
    canCreateLeads: admin || isBde,
    canBulkImport: admin,
    canAssign: admin,
    canViewHistory: admin,
    canManageSettings: admin,
  };
}

/**
 * Whether the current user may MUTATE a given lead (status, fields, notes,
 * comms logging). Admins may edit any lead; BDEs may edit only leads assigned
 * to them. Enforced identically in the API and the UI.
 */
export function canEditLead(
  access: CrmAccess,
  lead: { assignedToId: string | null },
  userId: string,
): boolean {
  return access.isAdmin || (access.isBde && lead.assignedToId === userId);
}
