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
    id: "executive",
    name: "Executive",
    icon: "leaderboard",
    basePath: "/executive",
    status: "active",
    adminOnly: true,
    pages: [
      {
        href: "/executive/dashboard",
        label: "CEO Dashboard",
        icon: "insights",
        adminOnly: true,
      },
    ],
  },
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
      { href: "/finance/collection-plan", label: "Collection Plan", icon: "schedule_send" },
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
        href: "/marketing/lead-pulse/pipeline",
        label: "Pipeline",
        icon: "timeline",
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
        href: "/marketing/lead-pulse/approvals",
        label: "Daily Approvals",
        icon: "rule",
      },
      {
        href: "/marketing/lead-pulse/director-entry",
        label: "Director Entry",
        icon: "co_present",
      },
      {
        href: "/marketing/lead-pulse/targets",
        label: "L2 Targets",
        icon: "flag",
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
      {
        href: "/marketing/holiday-calendar",
        label: "Holiday Calendar",
        icon: "event",
      },
      {
        href: "/marketing/voxbay",
        label: "Voxbay Call Analysis",
        icon: "phone_in_talk",
      },
    ],
  },
  {
    id: "hr",
    name: "HR",
    icon: "badge",
    basePath: "/hr",
    status: "active",
    pages: [
      { href: "/hr/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/hr/employees", label: "Employees", icon: "groups" },
      { href: "/hr/org-chart", label: "Org Chart", icon: "account_tree" },
      { href: "/hr/masters/designations", label: "Designations", icon: "stairs" },
      { href: "/hr/masters/departments", label: "Departments", icon: "domain" },
      { href: "/hr/masters/roles", label: "Roles", icon: "badge" },
      { href: "/hr/shifts", label: "Shifts", icon: "schedule" },
      { href: "/hr/attendance", label: "Attendance", icon: "fact_check" },
      { href: "/hr/leave-review", label: "Leave Review", icon: "rule" },
      { href: "/hr/leave", label: "Leave Requests", icon: "event_busy" },
      { href: "/hr/leave-balances", label: "Leave Balances", icon: "savings" },
      { href: "/hr/holidays", label: "Holiday Calendar", icon: "event" },
      { href: "/hr/salary-structures", label: "Salary Structures", icon: "calculate" },
      { href: "/hr/salary", label: "Salary Runs", icon: "payments" },
      { href: "/hr/policies", label: "Policies & Manuals", icon: "menu_book" },
      { href: "/hr/trainings", label: "Trainings", icon: "school" },
      { href: "/hr/notifications", label: "Notifications", icon: "campaign" },
    ],
  },
  {
    id: "me",
    name: "My Workspace",
    icon: "person",
    basePath: "/me",
    status: "active",
    pages: [
      { href: "/me/home", label: "Home", icon: "home" },
      { href: "/me/leave", label: "My Leave", icon: "event_busy" },
      { href: "/me/policies", label: "Policies", icon: "menu_book" },
      { href: "/me/trainings", label: "Trainings", icon: "school" },
      { href: "/me/payslips", label: "Payslips", icon: "receipt_long" },
      { href: "/me/notifications", label: "Notifications", icon: "notifications" },
    ],
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
