/**
 * Uncontacted-lead alarm — the pop-up that nags a BDE (and the Marketing Admin)
 * about leads assigned more than two hours ago that are still sitting in the
 * New stage (`not_yet_started`).
 *
 * Derived, never stored: a lead is on the alarm exactly while it is assigned,
 * still in New, and its assignment is older than {@link UNCONTACTED_AFTER_MINUTES}.
 * Moving it to Follow Up (or any other stage) is what clears it — there is no
 * acknowledge or dismiss record to go stale, and a reassignment restarts the
 * clock for the new owner because `assignedAt` is re-stamped.
 *
 * Who sees what:
 *   - an active BDE (Lead Pulse l1/l2) sees their own overdue leads;
 *   - the Marketing Admin (the "Marketing Admin" role, or any non-system-admin
 *     Lead Pulse supervisor — which is how that role is modelled) sees every
 *     BDE's overdue leads, with the owner's name, so they can chase or reassign;
 *   - nobody else, system admins included, is ever interrupted.
 *
 * The cadence lives in the browser (components/UncontactedLeadAlarm): the list
 * is polled every minute and the pop-up re-opens every
 * {@link UNCONTACTED_REMIND_EVERY_MINUTES} while anything is on it.
 *
 * This module is pure (no prisma) so the client component can share the rules;
 * the query lives in crm-uncontacted-leads.ts.
 */
import type { Permissions } from "./rbac";

/** A lead still in New this long after assignment is "not contacted". */
export const UNCONTACTED_AFTER_MINUTES = 120;

/** The pop-up re-opens this often while any lead is overdue. */
export const UNCONTACTED_REMIND_EVERY_MINUTES = 20;

/** Rows returned to the pop-up (worst first); the total is always exact. */
export const UNCONTACTED_LIST_LIMIT = 25;

/** The role name the Marketing Admin setup route creates. */
export const MARKETING_ADMIN_ROLE_NAME = "Marketing Admin";

/** "own" = the viewer's assigned leads; "team" = every BDE's. */
export type UncontactedScope = "own" | "team";

/**
 * Which leads, if any, this user is alarmed about. Null means the alarm is not
 * mounted for them at all, so everyone outside the sales team pays nothing.
 */
export function uncontactedAlarmScope(
  perms: Pick<Permissions, "isAdmin" | "roleName"> | null,
  lpRole: { role: string; active: boolean } | null,
): UncontactedScope | null {
  if (!perms) return null;
  if (!perms.isAdmin) {
    if (perms.roleName === MARKETING_ADMIN_ROLE_NAME) return "team";
    if (lpRole?.active && lpRole.role === "supervisor") return "team";
  }
  if (lpRole?.active && (lpRole.role === "l1" || lpRole.role === "l2")) return "own";
  return null;
}

/** Leads assigned at or before this instant (and still New) are overdue. */
export function uncontactedCutoff(now: Date): Date {
  return new Date(now.getTime() - UNCONTACTED_AFTER_MINUTES * 60_000);
}

/**
 * Whether the pop-up should open now. It opens whenever something is overdue
 * and it hasn't been shown (or dismissed) in the last reminder interval — so a
 * lead that breaches while nothing else is overdue pops at once, and after that
 * the whole list comes back every interval until it is empty.
 */
export function shouldPopUp(opts: { now: number; lastShownAt: number | null; overdueCount: number }): boolean {
  if (opts.overdueCount <= 0) return false;
  if (opts.lastShownAt == null) return true;
  return opts.now - opts.lastShownAt >= UNCONTACTED_REMIND_EVERY_MINUTES * 60_000;
}

export type UncontactedLead = {
  id: string;
  candidateName: string;
  phone: string | null;
  /** ISO — when it was assigned (falls back to created for legacy rows). */
  assignedAt: string;
  assigneeName: string | null;
  source: string | null;
};

export type UncontactedSnapshot = {
  scope: UncontactedScope;
  total: number;
  leads: UncontactedLead[];
  /** The New stage's id, for the "see all" link into the filtered leads list. */
  newStatusId: string | null;
};
