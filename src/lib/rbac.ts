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
export const ALWAYS_VISIBLE_PAGES = [
  "/me/attendance",
  "/me/regularization",
  "/me/account",
  // Executive meetings shared with this user (or holding an action item they
  // own). Every login can open it; the page itself only ever lists meetings
  // explicitly shared with the viewer, so an empty grant leaks nothing.
  "/me/meetings",
  // News & Updates is a company-wide broadcast: gating it behind a per-role
  // page grant would mean an announcement silently reaching only some staff.
  // Its admin surface stays out via ADMIN_RESTRICTED_PAGES below.
  "/news",
];

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
  // Managing which links the feed polls is an admin job; /news itself is open to
  // everyone, and this entry is checked first so the blanket grant cannot leak it.
  "/news/manage",
  // The Personal Wealth desk. Its rows are owner-scoped in the database, so a
  // non-owner would only ever see their own empty page — but a private-finance
  // route has no business appearing in anyone else's sidebar either.
  "/executive/wealth",
  // Removed automatically when WA_UI_ADMIN_ONLY flips — the CRM-user rule below
  // then takes over for the inbox, and /crm/broadcasts falls back to its own
  // canBulkEmail gate.
  ...(WA_UI_ADMIN_ONLY ? ["/crm/inbox", "/crm/broadcasts"] : []),
];

/**
 * Capability marker (NOT a real route) that switches off the CRM-user pages
 * canSeePage hands every role with /crm/leads — Notifications, Daily Report,
 * Campaign Delivery, the WhatsApp Inbox, the Broadcast Report and Sales
 * Training — so a role that only works the lead list (e.g. a communication
 * executive chasing referrals) sees just Leads in the CRM nav; the lead page's
 * WhatsApp tab goes too. Sales Training can still be granted explicitly. This
 * is visibility, not data access: those pages still authorise themselves via
 * getCrmAccess.
 */
export const CRM_LEADS_ONLY_PAGE = "/crm/leads-only";

/** Whether this (non-admin) role carries {@link CRM_LEADS_ONLY_PAGE}. */
export function isCrmLeadsOnly(p: Permissions | null): boolean {
  return !!p && !p.isAdmin && p.pages.includes(CRM_LEADS_ONLY_PAGE);
}

export function canSeePage(p: Permissions, href: string): boolean {
  if (!href.startsWith("/")) return false;
  // Admins see every page — keeps newly added admin-only routes visible
  // without forcing a Role.pages migration each time.
  if (p.isAdmin) return true;
  // Hard admin-only pages are never shown to non-admins, regardless of Role.pages.
  if (ADMIN_RESTRICTED_PAGES.some((pg) => href === pg || href.startsWith(pg + "/"))) return false;
  // Self-service essentials everyone can see.
  if (ALWAYS_VISIBLE_PAGES.some((pg) => href === pg || href.startsWith(pg + "/"))) return true;
  // CRM notifications, the personal Daily Report, the Campaign Delivery report,
  // the WhatsApp Inbox and the Broadcast Report are visible to every CRM user — anyone who can reach
  // the CRM Leads page — so they need no separate Role.pages grant (and never
  // leak the CRM module to non-CRM users, who can't see /crm/leads). Each page
  // itself authorises via getCrmAccess. CRM_LEADS_ONLY_PAGE opts a role out.
  const crmUser =
    p.pages.some((pg) => pg === "/crm/leads" || pg.startsWith("/crm/leads/")) && !isCrmLeadsOnly(p);
  if (
    href === "/crm/notifications" ||
    href.startsWith("/crm/notifications/") ||
    href === "/crm/report" ||
    href.startsWith("/crm/report/") ||
    href === "/crm/my-day" ||
    href === "/crm/deliveries" ||
    href.startsWith("/crm/deliveries/") ||
    href === "/crm/inbox" ||
    href.startsWith("/crm/inbox/") ||
    // The Broadcast Report, by itself: a consultant sees replies on their own
    // leads. The prefix rule below would otherwise tie it to a /crm/broadcasts
    // grant, which is the bulk-send tool and stays narrow.
    href === "/crm/broadcasts/report" ||
    href.startsWith("/crm/broadcasts/report/")
  ) {
    return crmUser;
  }
  // Sales Training is for sales consultants, who are CRM users — show it to
  // them without a separate grant, so an HR enrolment is never stranded behind
  // a missing Role.pages entry. Other roles can still be granted it explicitly;
  // the page itself only opens for enrolled learners.
  if ((href === "/me/sales-training" || href.startsWith("/me/sales-training/")) && crmUser) {
    return true;
  }
  // Agreement templates are setup, not day-to-day work: a role granted
  // /operations/agreements (send and track agreements) must not inherit the
  // template editor through the prefix rule below. Templates need their own grant.
  if (href === "/operations/agreements/templates" || href.startsWith("/operations/agreements/templates/")) {
    return p.pages.some((pg) => pg === "/operations/agreements/templates" || pg.startsWith("/operations/agreements/templates/"));
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
