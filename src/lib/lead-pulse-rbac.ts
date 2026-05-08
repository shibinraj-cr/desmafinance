import { prisma } from "./prisma";
import type { Permissions } from "./rbac";
import { isAdmin } from "./rbac";

export type LeadPulseRoleSlug = "l1" | "l2" | "supervisor";

export const LEAD_PULSE_ROLE_SLUGS = ["l1", "l2", "supervisor"] as const;

export type LeadPulseAccess = {
  /** The user's Lead Pulse role, or null if not assigned. */
  role: LeadPulseRoleSlug | null;
  /** Display name for reports / BDE column. */
  displayName: string | null;
  /** Whether the user can see the supervisor surface (dashboard, reports, settings). */
  canSupervise: boolean;
  /** Whether the user can submit daily entries. */
  canSubmitEntries: boolean;
  /** Effective for this user — DESFIN admins have implicit supervise rights. */
  desfinAdmin: boolean;
};

/**
 * Resolve a user's Lead Pulse capabilities. DESFIN admins implicitly have
 * supervisor-level access in Lead Pulse without needing an explicit
 * LeadPulseRole row, so they can bootstrap the team roster.
 */
export async function getLeadPulseAccess(
  userId: string,
  desfinPerms: Permissions | null,
): Promise<LeadPulseAccess> {
  const desfinAdmin = isAdmin(desfinPerms ?? null);
  const lpRole = await prisma.leadPulseRole.findUnique({
    where: { userId },
  });

  if (!lpRole) {
    return {
      role: null,
      displayName: null,
      canSupervise: desfinAdmin,
      canSubmitEntries: false,
      desfinAdmin,
    };
  }

  const role = lpRole.role as LeadPulseRoleSlug;
  return {
    role,
    displayName: lpRole.displayName,
    canSupervise: desfinAdmin || role === "supervisor",
    canSubmitEntries: lpRole.active && (role === "l1" || role === "l2"),
    desfinAdmin,
  };
}

export function leadPulseRoleLabel(role?: string | null): string {
  if (role === "l1") return "L1 BDE";
  if (role === "l2") return "L2 BDE";
  if (role === "supervisor") return "Supervisor";
  return "Unassigned";
}

/**
 * Tailwind classes for the Lead Pulse role pill — gold for L1, cyan for L2,
 * orange for supervisor (per BUILD_SPEC §2).
 */
export function leadPulseRoleBadgeClass(role?: string | null): string {
  if (role === "l1") return "bg-[#facc15] text-[#3c2f00]";
  if (role === "l2") return "bg-[#33e4ff] text-[#00363e]";
  if (role === "supervisor") return "bg-[#ffb693] text-[#561f00]";
  return "bg-[#393428] text-[#d1c6ab]";
}
