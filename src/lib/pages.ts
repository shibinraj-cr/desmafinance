// Canonical list of pages whose access can be toggled per role.
// Adding a new dashboard page? Add it here AND make sure the path appears
// in the `pages` array of any role that should see it.

export type AppPage = {
  href: string;
  label: string;
  icon: string;
  /** Restrict to admin-capable roles by default (e.g. user/role management). */
  adminOnly?: boolean;
};

export const APP_PAGES: AppPage[] = [
  { href: "/overview", label: "Overview", icon: "dashboard" },
  { href: "/revenue", label: "Revenue", icon: "payments" },
  { href: "/expenses", label: "Expenses", icon: "receipt_long" },
  { href: "/cashflow", label: "Cash Flow", icon: "account_balance" },
  { href: "/daily-tracker", label: "Daily Tracker", icon: "edit_calendar" },
  { href: "/approvals", label: "Approvals", icon: "rule" },
  { href: "/ai-insights", label: "AI Insights", icon: "psychology" },
  { href: "/users", label: "User Management", icon: "manage_accounts", adminOnly: true },
  { href: "/roles", label: "Role Management", icon: "shield_person", adminOnly: true },
];

/** All page hrefs (used as default for system Admin role). */
export const ALL_PAGE_HREFS = APP_PAGES.map((p) => p.href);

/** Pages every non-admin role gets by default. */
export const DEFAULT_NON_ADMIN_PAGES = APP_PAGES.filter((p) => !p.adminOnly).map(
  (p) => p.href,
);
