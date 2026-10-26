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
 * Capability marker (NOT a real route) letting a non-BDE create new leads, but
 * only as candidate referrals: the create route stamps the
 * {@link CANDIDATE_REFERRAL_SOURCE_CODE} source whatever the form sent (see
 * {@link CrmAccess.referralLeadsOnly}), so source reporting can't be skewed by
 * someone who isn't working the funnel. The lead is born unassigned, for an
 * admin to hand to a consultant. Purely a permission flag; not in MODULES.
 */
export const CRM_REFERRAL_LEADS_PAGE = "/crm/referral-leads";

/** LeadPulseSource.code of the "Candidate Referral" source (seed-lead-pulse.ts). */
export const CANDIDATE_REFERRAL_SOURCE_CODE = "candidate_referral";

/**
 * Capability marker (NOT a real route) letting a non-BDE add tasks to any
 * ENROLLED lead — e.g. a referral follow-up call to a candidate who has already
 * joined — without edit rights on the lead itself. They may then work (edit,
 * complete, delete) only the tasks assigned to them. See {@link canAddTask} /
 * {@link canEditTask}. Purely a permission flag; not in MODULES.
 */
export const CRM_ENROLLED_TASKS_PAGE = "/crm/enrolled-tasks";

/** CrmLeadStatus.code of the Enrolled stage. */
const ENROLLED_STATUS_CODE = "enrolled";

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
  /**
   * The user's create right comes ONLY from {@link CRM_REFERRAL_LEADS_PAGE}, so
   * every lead they create is a candidate referral (the create route forces the
   * source). False for BDEs and CRM admins, who create any kind of lead.
   */
  referralLeadsOnly: boolean;
  /**
   * Re-enroll an enrolled candidate for another service. Narrower than
   * `canCreateLeads`: the re-enrolled lead goes to the creating BDE (see
   * crm-reenroll.ts), so a referral-only creator, who is not a BDE, can't.
   */
  canReEnroll: boolean;
  /** Add tasks to any enrolled lead ({@link CRM_ENROLLED_TASKS_PAGE}). */
  canTaskEnrolledLeads: boolean;
  canBulkImport: boolean;
  /** Send a bulk email to many leads at once (CRM-admin, like bulk import). */
  canBulkEmail: boolean;
  /**
   * Move MANY leads to a new pipeline stage in one action (the Leads list's
   * bulk "Change stage"). Deliberately the same population as "may edit ANY
   * lead's status" — system admins and Lead Pulse supervisors (which is what
   * the Marketing Admin role is) — so bulk is a faster path to a power the
   * user already has, never a new one. In particular a BDE never gets it: they
   * may only edit leads assigned to them, so a bulk sweep isn't theirs to make.
   * Note this is NOT `canManageCrm`: a role granted /crm/settings without
   * supervisor rights can't edit an unassigned lead one at a time either.
   */
  canBulkStatus: boolean;
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
  /**
   * Undo an enrollment (src/lib/crm-unenroll.ts). A tier above `canEditLead`:
   * un-enrolling discards a Finance revenue draft, removes a BDE's closed-won
   * tick from the month's Actual, and removes or cancels an Operations project —
   * so the owning consultant must not be able to quietly reverse their own
   * numbers. System admins, Lead Pulse supervisors and the CRM-admin tier only.
   */
  canUnenroll: boolean;
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
  // Referral creators and enrolled-lead task-takers: one narrow power each, for
  // a role that supports the funnel without working it. Both also need CRM view
  // access — neither marker is a way into the CRM by itself.
  const canViewLeads = admin || isBde || isSupervisor || isCrmTeamLead || hasPage;
  const canCreateAnyLead = canManageCrm || isBde;
  const canCreateReferrals = canViewLeads && !!perms && canSeePage(perms, CRM_REFERRAL_LEADS_PAGE);
  const canTaskEnrolledLeads = canViewLeads && !!perms && canSeePage(perms, CRM_ENROLLED_TASKS_PAGE);

  return {
    userId,
    isAdmin: admin,
    isBde,
    isSupervisor,
    isCrmTeamLead,
    canManageCrm,
    canManageTemplates,
    bdeDisplayName: lp.displayName,
    canViewLeads,
    canCreateLeads: canCreateAnyLead || canCreateReferrals,
    referralLeadsOnly: !canCreateAnyLead && canCreateReferrals,
    canReEnroll: canCreateAnyLead,
    canTaskEnrolledLeads,
    canBulkImport: canManageCrm,
    canBulkEmail: canManageCrm,
    // Mirrors canEditLead's "may edit any lead" arm exactly (admin | supervisor).
    canBulkStatus: admin || isSupervisor,
    canAssign: canAssignLeads,
    canViewHistory: canViewLeadHistory,
    canManageSettings: canManageCrm,
    canUnenroll: admin || isSupervisor || canManageCrm,
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

/**
 * Whether the current user may ADD a task to a lead: anyone who may edit it,
 * plus — on an enrolled lead only — a role granted {@link CRM_ENROLLED_TASKS_PAGE}.
 * Enforced identically in the API and the UI.
 */
export function canAddTask(
  access: CrmAccess,
  lead: { assignedToId: string | null; status: { code: string } | null },
  userId: string,
): boolean {
  return (
    canEditLead(access, lead, userId) ||
    (access.canTaskEnrolledLeads && lead.status?.code === ENROLLED_STATUS_CODE)
  );
}

/**
 * Whether the current user may edit, complete or delete an existing task:
 * anyone who may edit the lead, plus an enrolled-lead task-taker for the tasks
 * assigned to them — never a consultant's task on the same lead.
 */
export function canEditTask(
  access: CrmAccess,
  task: { assignedToId: string | null },
  lead: { assignedToId: string | null; status: { code: string } | null },
  userId: string,
): boolean {
  return (
    canEditLead(access, lead, userId) ||
    (canAddTask(access, lead, userId) && task.assignedToId === userId)
  );
}
