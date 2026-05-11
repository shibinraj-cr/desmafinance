// App-wide module registry. Adding a new module = add an entry here, drop
// pages into `src/app/(app)/<basePath>/...`, and update Role.pages on roles
// that should see those pages.

export type ModuleStatus = "active" | "coming_soon";

export type AppPage = {
  href: string;
  label: string;
  icon: string;
  /** Pages tagged adminOnly are shown in the role-management UI as such. */
  adminOnly?: boolean;
};

export type AppModule = {
  id: string;
  name: string;
  icon: string;
  /** URL prefix this module owns, e.g. "/finance" or "/system" or "" for cross-module. */
  basePath: string;
  status: ModuleStatus;
  /** Whether non-admin users should see this module in the switcher. System is admin-only. */
  adminOnly?: boolean;
  pages: AppPage[];
};

export const MODULES: AppModule[] = [
  {
    id: "finance",
    name: "Finance",
    icon: "account_balance",
    basePath: "/finance",
    status: "active",
    pages: [
      { href: "/finance/overview", label: "Overview", icon: "dashboard" },
      { href: "/finance/revenue", label: "Revenue", icon: "payments" },
      { href: "/finance/expenses", label: "Expenses", icon: "receipt_long" },
      { href: "/finance/cashflow", label: "Cash Flow", icon: "account_balance" },
      { href: "/finance/daily-tracker", label: "Daily Tracker", icon: "edit_calendar" },
      { href: "/finance/parties", label: "Candidates & Vendors", icon: "groups" },
      { href: "/finance/approvals", label: "Approvals", icon: "rule" },
      { href: "/finance/ai-insights", label: "AI Insights", icon: "psychology" },
    ],
  },
  {
    id: "marketing",
    name: "Marketing",
    icon: "campaign",
    basePath: "/marketing",
    status: "active",
    pages: [
      {
        href: "/marketing/lead-pulse",
        label: "Lead Pulse",
        icon: "trending_up",
      },
      {
        href: "/marketing/lead-pulse/daily-entry",
        label: "Daily Entry",
        icon: "edit_note",
      },
      {
        href: "/marketing/lead-pulse/monthly-report",
        label: "Monthly Report",
        icon: "table_chart",
      },
      {
        href: "/marketing/lead-pulse/bde-performance",
        label: "BDE Performance",
        icon: "person_search",
      },
      {
        href: "/marketing/lead-pulse/team-roster",
        label: "Team Roster",
        icon: "groups",
      },
      {
        href: "/marketing/lead-pulse/settings",
        label: "Settings",
        icon: "tune",
      },
      {
        href: "/marketing/parties",
        label: "Candidates & Vendors",
        icon: "groups",
      },
    ],
  },
  {
    id: "hr",
    name: "HR",
    icon: "groups",
    basePath: "/hr",
    status: "coming_soon",
    pages: [],
  },
  {
    id: "master-data",
    name: "Master Data",
    icon: "category",
    basePath: "/master-data",
    status: "active",
    adminOnly: true,
    pages: [
      {
        href: "/master-data/categories",
        label: "Categories",
        icon: "account_tree",
        adminOnly: true,
      },
      {
        href: "/master-data/services",
        label: "Services",
        icon: "lan",
        adminOnly: true,
      },
      { href: "/master-data/parties", label: "Parties", icon: "groups", adminOnly: true },
      { href: "/master-data/sources", label: "Sources", icon: "campaign" },
    ],
  },
  {
    id: "system",
    name: "System",
    icon: "settings",
    basePath: "",
    status: "active",
    adminOnly: true,
    pages: [
      { href: "/users", label: "User Management", icon: "manage_accounts", adminOnly: true },
      { href: "/roles", label: "Role Management", icon: "shield_person", adminOnly: true },
    ],
  },
];

/** Flat list of every page across every module — for the role-management page-access UI. */
export const ALL_PAGES: AppPage[] = MODULES.flatMap((m) => m.pages);
export const ALL_PAGE_HREFS: string[] = ALL_PAGES.map((p) => p.href);

/** Pages every non-admin role gets by default (Finance only, no system). */
export const DEFAULT_NON_ADMIN_PAGES: string[] = MODULES.filter(
  (m) => m.id === "finance",
).flatMap((m) => m.pages.map((p) => p.href));

/** Find the module that owns a given href. */
export function moduleForPath(href: string): AppModule | null {
  if (!href.startsWith("/")) return null;
  // System pages have basePath "" — match by membership instead.
  for (const m of MODULES) {
    if (m.basePath && href.startsWith(m.basePath + "/")) return m;
    if (m.pages.some((p) => p.href === href || href.startsWith(p.href + "/"))) return m;
  }
  return null;
}
