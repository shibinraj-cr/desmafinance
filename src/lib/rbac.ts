// Role/permission helpers. We now prefer a Role record (with explicit
// capability flags + page list) and fall back to the legacy string `role`
// field on User when no relation is present.

export type Permissions = {
  isAdmin: boolean;
  canApprove: boolean;
  needsApproval: boolean;
  /** When true, new transactions land as personal drafts (visible only
   *  on /finance/approvals/my-drafts) instead of going straight into
   *  the approval queue. Used for Ganga's review-before-submit flow. */
  draftFirst: boolean;
  pages: string[];
  /** The display name of the role (e.g. "Admin", "Manager", custom name). */
  roleName: string;
};

/** Legacy string-only check. Used as fallback when no Role record. */
export function fromLegacyString(role?: string | null): Permissions {
  const r = role ?? "executive";
  const FINANCE_PAGES = [
    "/finance/overview",
    "/finance/revenue",
    "/finance/expenses",
    "/finance/cashflow",
    "/finance/daily-tracker",
    "/finance/approvals",
    "/finance/ai-insights",
  ];
  if (r === "admin") {
    return {
      isAdmin: true,
      canApprove: true,
      needsApproval: false,
      draftFirst: false,
      pages: [...FINANCE_PAGES, "/users", "/roles"],
      roleName: "Admin",
    };
  }
  if (r === "manager") {
    return {
      isAdmin: false,
      canApprove: true,
      needsApproval: false,
      draftFirst: false,
      pages: FINANCE_PAGES,
      roleName: "Manager",
    };
  }
  return {
    isAdmin: false,
    canApprove: false,
    needsApproval: true,
    draftFirst: false,
    pages: FINANCE_PAGES,
    roleName: r === "executive" ? "Executive" : "User",
  };
}

export function isAdmin(p?: Permissions | null): boolean {
  return !!p?.isAdmin;
}

export function canManageUsers(p?: Permissions | null): boolean {
  return !!p?.isAdmin;
}

export function canApprove(p?: Permissions | null): boolean {
  return !!p?.canApprove;
}

export function needsApproval(p?: Permissions | null): boolean {
  return !!p?.needsApproval;
}

export function canSeePage(p: Permissions, href: string): boolean {
  if (!href.startsWith("/")) return false;
  // Exact match or prefix match (e.g. allowing /daily-tracker permits
  // /daily-tracker/[id]/edit too).
  return p.pages.some((pg) => href === pg || href.startsWith(pg + "/"));
}

/** Tone class for role pills shown in the user table. */
export function roleBadgeClass(roleName?: string | null): string {
  if (!roleName) return "bg-surface-container text-on-surface-variant";
  if (roleName === "Admin") return "bg-primary text-on-primary";
  // Manager-style roles (any role with "manager" in the name) get the accent tone.
  if (/manager/i.test(roleName)) return "bg-accent text-on-primary";
  // Executive/system role default
  if (/executive/i.test(roleName)) return "bg-surface-container-high text-on-surface";
  return "bg-surface-container text-on-surface-variant";
}

export function roleLabel(roleName?: string | null): string {
  return roleName ?? "User";
}
