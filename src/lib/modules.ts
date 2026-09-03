// App-wide module registry. Adding a new module = add an entry here, drop
// pages into `src/app/(app)/<basePath>/...`, and update Role.pages on roles
// that should see those pages.

import { isAdmin, canSeePage, type Permissions } from "@/lib/rbac";

export type ModuleStatus = "active" | "coming_soon";

export type AppPage = {
  href: string;
  label: string;
  icon: string;
  /** Pages tagged adminOnly are shown in the role-management UI as such. */
  adminOnly?: boolean;
  /**
   * Optional sidebar section this page belongs to (e.g. "LEAVE", "PAYROLL").
   * Purely cosmetic: pages sharing a `group` render under one muted header in
   * the sidebar. Untagged pages render flat. Does not affect routing or RBAC.
   */
  group?: string;
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
      { href: "/finance/overview", label: "Overview", icon: "dashboard", group: "OVERVIEW" },
      { href: "/finance/revenue", label: "Revenue", icon: "payments", group: "MONEY IN" },
      { href: "/finance/collection-plan", label: "Collection Plan", icon: "schedule_send", group: "MONEY IN" },
      { href: "/finance/expenses", label: "Expenses", icon: "receipt_long", group: "MONEY OUT" },
      { href: "/finance/cashflow", label: "Cash Flow", icon: "account_balance", group: "MONEY OUT" },
      { href: "/finance/daily-tracker", label: "Daily Tracker", icon: "edit_calendar", group: "OPERATIONS" },
      { href: "/finance/parties", label: "Parties", icon: "groups", group: "OPERATIONS" },
      { href: "/finance/incentive-calculator", label: "Incentive Calculator", icon: "redeem", group: "OPERATIONS" },
      { href: "/finance/approvals", label: "Approvals", icon: "rule", group: "REVIEW" },
      { href: "/finance/ai-insights", label: "AI Insights", icon: "psychology", group: "REVIEW" },
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
        group: "LEAD PULSE",
      },
      {
        // Legacy self-report surface. The CRM now captures every close directly
        // (enroll → daily close), so this is admin-only for oversight/backfill.
        href: "/marketing/lead-pulse/daily-entry",
        label: "Daily Entry",
        icon: "edit_note",
        group: "LEAD PULSE",
        adminOnly: true,
      },
      {
        // Legacy self-report surface — admin-only for the same reason as Daily Entry.
        href: "/marketing/lead-pulse/director-entry",
        label: "Director Entry",
        icon: "co_present",
        group: "LEAD PULSE",
        adminOnly: true,
      },
      {
        href: "/marketing/lead-pulse/pipeline",
        label: "Pipeline",
        icon: "timeline",
        group: "LEAD PULSE",
      },
      {
        href: "/marketing/lead-pulse/monthly-report",
        label: "Monthly Report",
        icon: "table_chart",
        group: "INSIGHTS",
      },
      {
        href: "/marketing/lead-pulse/bde-performance",
        label: "BDE Performance",
        icon: "person_search",
        group: "INSIGHTS",
      },
      {
        href: "/marketing/lead-pulse/planner",
        label: "Growth Planner",
        icon: "rocket_launch",
        group: "INSIGHTS",
      },
      {
        href: "/marketing/lead-pulse/team-roster",
        label: "Team Roster",
        icon: "groups",
        group: "TEAM & TARGETS",
      },
      {
        href: "/marketing/lead-pulse/targets",
        label: "L2 Targets",
        icon: "flag",
        group: "TEAM & TARGETS",
      },
      {
        href: "/marketing/lead-pulse/crm-metrics",
        label: "CRM Metrics (Beta)",
        icon: "compare_arrows",
        group: "TEAM & TARGETS",
      },
      {
        href: "/marketing/lead-pulse/approvals",
        label: "Daily Approvals",
        icon: "rule",
        group: "TEAM & TARGETS",
      },
      {
        href: "/marketing/parties",
        label: "Candidates & Vendors",
        icon: "groups",
        group: "TOOLS",
      },
      {
        href: "/marketing/holiday-calendar",
        label: "Holiday Calendar",
        icon: "event",
        group: "TOOLS",
      },
      {
        href: "/marketing/voxbay",
        label: "Voxbay Call Analysis",
        icon: "phone_in_talk",
        group: "TOOLS",
      },
      {
        href: "/marketing/lead-pulse/settings",
        label: "Settings",
        icon: "tune",
        group: "TOOLS",
      },
    ],
  },
  {
    id: "crm",
    name: "CRM",
    icon: "contacts",
    basePath: "/crm",
    status: "active",
    pages: [
      {
        href: "/crm/team",
        label: "Dashboard",
        icon: "insights",
        group: "ACTIVITY",
      },
      {
        // Enrolment & conversion money view (targets, pipeline value, source
        // ROI) — the finance-facing sibling of Dashboard's people/process view.
        href: "/crm/team/bde-enrollment",
        label: "BDE Enrollment",
        icon: "leaderboard",
        group: "ACTIVITY",
        adminOnly: true,
      },
      {
        // A BDE's end-of-day report (auto-filled from their activity) + manager
        // review. Personal to every CRM user, so visibility is handled in
        // canSeePage (any CRM user), not a per-role Role.pages grant.
        href: "/crm/report",
        label: "Daily Report",
        icon: "assignment",
        group: "ACTIVITY",
      },
      {
        // Personal in-app notifications (e.g. a lead was assigned to you). Its own
        // group so it gets a dedicated, unread-badged item in the CRM left-nav.
        // Visibility is handled in canSeePage (any CRM user), not Role.pages.
        href: "/crm/notifications",
        label: "Notifications",
        icon: "notifications",
        group: "NOTIFICATIONS",
      },
      {
        href: "/crm/leads",
        label: "Leads",
        icon: "groups",
        group: "PIPELINE",
      },
      {
        href: "/crm/tasks",
        label: "Tasks",
        icon: "task_alt",
        group: "PIPELINE",
      },
      {
        // Its own group, so WhatsApp is a destination in the left bar rather
        // than a page buried inside Pipeline — the left bar lists GROUPS, so
        // anything sharing a group with Leads is invisible until you are already
        // in Pipeline. Answering candidates is its own job, not a sub-task of
        // working the pipeline.
        //
        // Group order follows first appearance in this list (see moduleGroups),
        // so sitting here puts WhatsApp directly below Pipeline.
        //
        // Not adminOnly: any CRM user works their own threads. Page enforces
        // canViewLeads; each conversation re-checks who may act on it.
        href: "/crm/inbox",
        label: "Inbox",
        icon: "forum",
        group: "WHATSAPP",
      },
      {
        // Lives beside the inbox rather than in Tools: both are the WhatsApp
        // workspace, and a marketer looking for broadcasts looks under WhatsApp.
        // Page enforces canBulkEmail — the same authority as a bulk email.
        href: "/crm/broadcasts",
        label: "Broadcasts",
        icon: "campaign",
        group: "WHATSAPP",
      },
      {
        // Not adminOnly: gated by an explicit page grant so a marketing
        // supervisor can be given template access without full CRM admin.
        href: "/crm/templates",
        label: "Message Templates",
        icon: "quickreply",
        group: "TOOLS",
      },
      {
        // Not adminOnly: any CRM user sees which re-marketing touches failed to
        // reach the lead (bad number / frequency cap). Page enforces canViewLeads.
        href: "/crm/deliveries",
        label: "Campaign Delivery",
        icon: "sms_failed",
        group: "TOOLS",
      },
      {
        // The whole drip, not just its failures: what has gone out, what is due,
        // and which touch earned the reply. Same access as Campaign Delivery —
        // a consultant should be able to see the schedule for their own leads.
        href: "/crm/remarketing",
        // "Re-marketing Report", not "Re-marketing": Settings already has a tab
        // by that name for the CONFIG, and two identically-named destinations
        // sent the first person looking for this page to the wrong one.
        label: "Re-marketing Report",
        icon: "campaign",
        group: "TOOLS",
      },
      {
        // Not adminOnly: gated by an explicit page grant so the Marketing Admin
        // can be given the Meta reconciliation tool without full CRM admin.
        href: "/crm/meta-reconcile",
        label: "Meta Reconcile",
        icon: "rule",
        group: "ADMIN",
      },
      {
        // Companion to Meta Reconcile: audit whether Voxbay incoming callers are
        // in the CRM. Same page-grant gating (Admin + Marketing Admin).
        href: "/crm/voxbay-reconcile",
        label: "Voxbay Reconcile",
        icon: "phone_in_talk",
        group: "ADMIN",
      },
      {
        href: "/crm/settings",
        label: "Settings",
        icon: "tune",
        group: "ADMIN",
        adminOnly: true,
      },
    ],
  },
  {
    id: "operations",
    name: "Operations",
    icon: "fact_check",
    basePath: "/operations",
    status: "active",
    pages: [
      { href: "/operations/my-work", label: "My Work", icon: "task_alt", group: "WORK" },
      { href: "/operations/my-tasks", label: "My Tasks", icon: "checklist_rtl", group: "WORK" },
      { href: "/operations/projects", label: "Projects", icon: "folder_managed", group: "WORK" },
      {
        href: "/operations/templates",
        label: "Process Templates",
        icon: "checklist",
        group: "SETUP",
        adminOnly: true,
      },
      {
        href: "/operations/settings",
        label: "Settings",
        icon: "tune",
        group: "SETUP",
        adminOnly: true,
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
      { href: "/hr/dashboard", label: "Dashboard", icon: "dashboard", group: "PEOPLE" },
      { href: "/hr/employees", label: "Employees", icon: "groups", group: "PEOPLE" },
      { href: "/hr/org-chart", label: "Org Chart", icon: "account_tree", group: "PEOPLE" },
      { href: "/hr/birthdays", label: "Birthday Calendar", icon: "cake", group: "PEOPLE" },
      { href: "/hr/leave", label: "Leave Requests", icon: "event_busy", group: "LEAVE" },
      { href: "/hr/leave-balances", label: "Leave Balances", icon: "savings", group: "LEAVE" },
      { href: "/hr/leave-eligibility", label: "Leave Eligibility", icon: "auto_awesome", group: "LEAVE" },
      { href: "/hr/sandwich-policy", label: "Sandwich Policy", icon: "rule_settings", group: "LEAVE" },
      { href: "/hr/attendance", label: "Attendance", icon: "fact_check", group: "ATTENDANCE" },
      { href: "/hr/attendance/scorecard", label: "Scorecard", icon: "scoreboard", group: "ATTENDANCE" },
      { href: "/hr/regularization", label: "Attendance Corrections", icon: "edit_calendar", group: "ATTENDANCE" },
      { href: "/hr/shifts", label: "Shifts", icon: "schedule", group: "ATTENDANCE" },
      { href: "/hr/shift-assignments", label: "Shift Assignments", icon: "schedule_send", group: "ATTENDANCE" },
      { href: "/hr/attendance/settings", label: "Biometric Sync", icon: "fingerprint", group: "ATTENDANCE" },
      { href: "/hr/salary-structures", label: "Salary Structures", icon: "calculate", group: "PAYROLL" },
      { href: "/hr/salary", label: "Salary Runs", icon: "payments", group: "PAYROLL" },
      { href: "/hr/masters/designations", label: "Designations", icon: "stairs", group: "MASTERS" },
      { href: "/hr/masters/departments", label: "Departments", icon: "domain", group: "MASTERS" },
      { href: "/hr/masters/roles", label: "Roles", icon: "badge", group: "MASTERS" },
      { href: "/hr/psych", label: "Psychometric", icon: "psychology", group: "PSYCHOMETRIC" },
      { href: "/hr/psych/assignments", label: "Psych Assignments", icon: "assignment_ind", group: "PSYCHOMETRIC" },
      { href: "/hr/psych/questions", label: "Psych Questions", icon: "quiz", group: "PSYCHOMETRIC" },
      { href: "/hr/holidays", label: "Holiday Calendar", icon: "event", group: "RESOURCES" },
      { href: "/hr/policies", label: "Policies & Manuals", icon: "menu_book", group: "RESOURCES" },
      { href: "/hr/trainings", label: "Trainings", icon: "school", group: "RESOURCES" },
      { href: "/hr/notifications", label: "Notifications", icon: "campaign", group: "RESOURCES" },
    ],
  },
  {
    id: "hiring",
    name: "Hiring",
    icon: "person_search",
    basePath: "/hiring",
    status: "active",
    pages: [
      // Rails land phase by phase; only pages that exist are registered, so the
      // left rail never shows a link to a 404.
      { href: "/hiring/pipeline", label: "Pipeline", icon: "view_kanban", group: "HIRING" },
      { href: "/hiring/jobs", label: "Jobs", icon: "work", group: "HIRING" },
      { href: "/hiring/candidates", label: "Candidates", icon: "groups", group: "HIRING" },
      { href: "/hiring/interviews", label: "Interviews", icon: "event_available", group: "HIRING" },
      {
        // Granting a role this page promotes it to the hiring HR-manager tier
        // (see HIRING_SETTINGS_PAGE in src/lib/hiring/rbac.ts) — the same trick
        // as /crm/settings. Not adminOnly: that is the whole point.
        href: "/hiring/settings",
        label: "Roles & Access",
        icon: "shield_person",
        group: "WORKSPACE",
      },
      {
        href: "/hiring/settings/audit",
        label: "Audit Log",
        icon: "history",
        group: "WORKSPACE",
      },
    ],
  },
  {
    id: "me",
    name: "My Workspace",
    icon: "person",
    basePath: "/me",
    status: "active",
    pages: [
      { href: "/me/home", label: "Home", icon: "home", group: "HOME" },
      { href: "/me/attendance", label: "My Attendance", icon: "fact_check", group: "TIME & LEAVE" },
      { href: "/me/regularization", label: "Regularization", icon: "edit_calendar", group: "TIME & LEAVE" },
      { href: "/me/leave", label: "My Leave", icon: "event_busy", group: "TIME & LEAVE" },
      { href: "/me/payslips", label: "Payslips", icon: "receipt_long", group: "PAY" },
      { href: "/me/birthdays", label: "Birthdays", icon: "cake", group: "RESOURCES" },
      { href: "/me/policies", label: "Policies", icon: "menu_book", group: "RESOURCES" },
      { href: "/me/trainings", label: "Trainings", icon: "school", group: "RESOURCES" },
      { href: "/me/notifications", label: "Notifications", icon: "notifications", group: "RESOURCES" },
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
      { href: "/usage", label: "Usage", icon: "timelapse", adminOnly: true },
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

/** A named cluster of pages within a module (e.g. "LEAVE"). */
export type AppGroup = { name: string; pages: AppPage[] };

/**
 * The module's pages bucketed into their `group`, in first-appearance order.
 * Pages without a `group` fall under the "" bucket (used by ungrouped modules).
 */
export function moduleGroups(mod: AppModule): AppGroup[] {
  const order: string[] = [];
  const byName = new Map<string, AppPage[]>();
  for (const p of mod.pages) {
    const key = p.group ?? "";
    if (!byName.has(key)) {
      byName.set(key, []);
      order.push(key);
    }
    byName.get(key)!.push(p);
  }
  return order.map((name) => ({ name, pages: byName.get(name)! }));
}

/** Whether a module organizes its pages into named groups. */
export function moduleHasGroups(mod: AppModule): boolean {
  return mod.pages.some((p) => !!p.group);
}

/**
 * The most specific page within `mod` that `pathname` is currently on — the
 * page with the longest matching href (so e.g. /marketing/lead-pulse/pipeline
 * resolves to Pipeline, not the shorter Lead Pulse parent).
 */
export function activePage(mod: AppModule, pathname: string): AppPage | null {
  let best: AppPage | null = null;
  for (const p of mod.pages) {
    if (pathname === p.href || pathname.startsWith(p.href + "/")) {
      if (!best || p.href.length > best.href.length) best = p;
    }
  }
  return best;
}

/**
 * The first page within `mod` the signed-in user is allowed to open — the
 * page a module tile / switcher should land them on. Null if the module has
 * no page they can see.
 */
export function firstAllowedPage(mod: AppModule, perms: Permissions): AppPage | null {
  return mod.pages.find((p) => canSeePage(perms, p.href)) ?? null;
}

/**
 * Modules the signed-in user can see — shared by the sidebar switcher and the
 * app launcher so both stay in lock-step:
 *   • admin-only modules are hidden from non-admins,
 *   • coming-soon modules show only to admins (so they know what's queued),
 *   • an active module needs at least one page the user is allowed to open.
 */
export function visibleModules(perms: Permissions): AppModule[] {
  return MODULES.filter((m) => {
    if (m.adminOnly && !isAdmin(perms)) return false;
    if (m.status === "coming_soon") return isAdmin(perms);
    return m.pages.some((p) => canSeePage(perms, p.href));
  });
}
