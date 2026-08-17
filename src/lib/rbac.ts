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

// Pages every authenticated user can see, regardless of their role's page
// list. These are self-service essentials that apply to all employees, so
// they stay visible without having to add them to each (current or future)
// role's Role.pages. The route-level guards on these pages already handle
// the "login not linked to an employee" case gracefully.
export const ALWAYS_VISIBLE_PAGES = ["/me/attendance", "/me/regularization", "/me/account"];

// Hard admin-only pages: hidden from EVERY non-admin's nav even when a role
// still carries the href in Role.pages. Distinct from the cosmetic `adminOnly`
// module flag (which admins may still grant by exception — e.g. Suhaina's
// /crm/settings): these are legacy self-report surfaces fully superseded by CRM
// capture, so no non-admin should reach them. The page + API route guards
// enforce the same rule server-side.
/**
 * WhatsApp module rollout gate. RELEASED — the mirror is live and receiving, so
 * the inbox is open to every CRM user.
 *
 * This only ever controlled who could SEE the module while it was being tested.
 * It is not the data rule and never was: what a consultant can actually read is
 * decided per conversation by conversationVisibilityWhere (src/lib/wa/access.ts)
 * — a BDE sees the candidates assigned to them, oversight roles see the desk.
 * Setting this back to `true` would hide the module again; it would not tighten
 * anything.
 *
 * Broadcasts stays narrower by its own rule: the page enforces canBulkEmail, and
 * the nav entry needs an explicit /crm/broadcasts page grant, so opening the
 * inbox does not hand every BDE a bulk-send tool.
 */
export const WA_UI_ADMIN_ONLY = false;

export const ADMIN_RESTRICTED_PAGES = [
  "/marketing/lead-pulse/daily-entry",
  "/marketing/lead-pulse/director-entry",
  // Removed automatically when WA_UI_ADMIN_ONLY flips — the CRM-user rule below
  // then takes over for the inbox, and /crm/broadcasts falls back to its own
  // canBulkEmail gate.
  ...(WA_UI_ADMIN_ONLY ? ["/crm/inbox", "/crm/broadcasts"] : []),
];

export function canSeePage(p: Permissions, href: string): boolean {
  if (!href.startsWith("/")) return false;
  // Admins see every page — keeps newly added admin-only routes visible
  // without forcing a Role.pages migration each time.
  if (p.isAdmin) return true;
  // Hard admin-only pages are never shown to non-admins, regardless of Role.pages.
  if (ADMIN_RESTRICTED_PAGES.some((pg) => href === pg || href.startsWith(pg + "/"))) return false;
  // Self-service essentials everyone can see.
  if (ALWAYS_VISIBLE_PAGES.some((pg) => href === pg || href.startsWith(pg + "/"))) return true;
  // CRM notifications, the personal Daily Report, the Campaign Delivery report
  // and the WhatsApp Inbox are visible to every CRM user — anyone who can reach
  // the CRM Leads page — so they need no separate Role.pages grant (and never
  // leak the CRM module to non-CRM users, who can't see /crm/leads). Each page
  // itself authorises via getCrmAccess.
  if (
    href === "/crm/notifications" ||
    href.startsWith("/crm/notifications/") ||
    href === "/crm/report" ||
    href.startsWith("/crm/report/") ||
    href === "/crm/deliveries" ||
    href.startsWith("/crm/deliveries/") ||
    href === "/crm/inbox" ||
    href.startsWith("/crm/inbox/")
  ) {
    return p.pages.some((pg) => pg === "/crm/leads" || pg.startsWith("/crm/leads/"));
  }
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
