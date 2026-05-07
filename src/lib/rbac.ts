// Role definitions and permission helpers. The `role` column on User is a
// plain string in the schema for forward-compat; we narrow at the call site.

export const ROLES = ["admin", "manager", "executive"] as const;
export type Role = (typeof ROLES)[number];

export function isValidRole(r: string | null | undefined): r is Role {
  return r === "admin" || r === "manager" || r === "executive";
}

export function isAdmin(role?: string | null): boolean {
  return role === "admin";
}

export function canManageUsers(role?: string | null): boolean {
  return role === "admin";
}

/** Manager + admin can approve/reject pending changes. */
export function canApprove(role?: string | null): boolean {
  return role === "admin" || role === "manager";
}

/** Whether a user's transaction mutations should be queued for approval. */
export function needsApproval(role?: string | null): boolean {
  // Anything that isn't admin or manager goes through the approval queue.
  // The legacy "user" role default is treated like an executive.
  return !canApprove(role);
}

export function roleLabel(role?: string | null): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "manager":
      return "Manager";
    case "executive":
      return "Executive";
    default:
      return "User";
  }
}

export function roleBadgeClass(role?: string | null): string {
  switch (role) {
    case "admin":
      return "bg-primary text-on-primary";
    case "manager":
      return "bg-accent text-on-primary";
    case "executive":
      return "bg-surface-container-high text-on-surface";
    default:
      return "bg-surface-container text-on-surface-variant";
  }
}
