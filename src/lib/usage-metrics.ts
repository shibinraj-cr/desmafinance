/**
 * Server-side rollups over ModuleUsageDaily for the two usage surfaces:
 *   - getModuleUsageMatrix → the admin "Usage" page (users × modules active time).
 *   - getCrmUsageByUser    → the CRM engagement panel (per-BDE CRM time + sub-page
 *                            breakdown), joined against outcome rows on /crm/team.
 *
 * All time is stored as active seconds (see src/lib/usage-tracking.ts); these
 * helpers only sum and shape it. Day filtering is by the `day` calendar column,
 * so the `Range` from period.ts (UTC-midnight boundaries) lines up at day grain.
 */
import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";
import type { Range } from "./period";
import { MODULES } from "./modules";

/** Build a `day` filter from a period Range (half-open [from, to)). */
function dayWhere(range: Range): Prisma.ModuleUsageDailyWhereInput {
  const day: Prisma.DateTimeFilter = {};
  if (range.from) day.gte = range.from;
  if (range.to) day.lt = range.to;
  return range.from || range.to ? { day } : {};
}

/** Registry order for module columns, so the matrix reads in the app's own order. */
const MODULE_ORDER: string[] = MODULES.map((m) => m.id);
const MODULE_NAME: Record<string, string> = Object.fromEntries(MODULES.map((m) => [m.id, m.name]));

/** Human label for a module column (falls back to the raw id, e.g. "unknown"). */
export function moduleLabel(id: string): string {
  return MODULE_NAME[id] ?? (id === "unknown" ? "Other" : id);
}

export type ModuleUsageUserRow = {
  userId: string;
  displayName: string;
  role: string;
  /** moduleId → active seconds over the range. */
  perModule: Record<string, number>;
  total: number;
};

export type ModuleUsageMatrix = {
  /** Module ids that have data, in registry order (with "unknown"/others last). */
  moduleIds: string[];
  rows: ModuleUsageUserRow[];
  /** moduleId → total active seconds across all users. */
  columnTotals: Record<string, number>;
  grandTotal: number;
};

/**
 * Users × modules active-time matrix for the admin Usage page, busiest user
 * first. Only users with recorded time in the range appear.
 */
export async function getModuleUsageMatrix(range: Range): Promise<ModuleUsageMatrix> {
  const grouped = await prisma.moduleUsageDaily.groupBy({
    by: ["userId", "moduleId"],
    where: dayWhere(range),
    _sum: { activeSeconds: true },
  });

  const byUser = new Map<string, ModuleUsageUserRow>();
  const columnTotals: Record<string, number> = {};
  const present = new Set<string>();
  let grandTotal = 0;

  for (const g of grouped) {
    const secs = g._sum.activeSeconds ?? 0;
    if (secs <= 0) continue;
    present.add(g.moduleId);
    columnTotals[g.moduleId] = (columnTotals[g.moduleId] ?? 0) + secs;
    grandTotal += secs;
    let row = byUser.get(g.userId);
    if (!row) {
      row = { userId: g.userId, displayName: g.userId, role: "", perModule: {}, total: 0 };
      byUser.set(g.userId, row);
    }
    row.perModule[g.moduleId] = (row.perModule[g.moduleId] ?? 0) + secs;
    row.total += secs;
  }

  // Attach display names/roles for the users that appear.
  const userIds = [...byUser.keys()];
  if (userIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, roleRef: { select: { name: true } }, role: true },
    });
    for (const u of users) {
      const row = byUser.get(u.id);
      if (row) {
        row.displayName = u.username;
        row.role = u.roleRef?.name ?? u.role;
      }
    }
  }

  // Columns: registry order first, then any extras (e.g. "unknown") alphabetically.
  const moduleIds = [
    ...MODULE_ORDER.filter((id) => present.has(id)),
    ...[...present].filter((id) => !MODULE_ORDER.includes(id)).sort(),
  ];

  const rows = [...byUser.values()].sort(
    (a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName),
  );

  return { moduleIds, rows, columnTotals, grandTotal };
}

export type CrmUsageRow = {
  userId: string;
  totalSeconds: number;
  /** page href → active seconds (e.g. "/crm/leads" → 43560). */
  byPage: Record<string, number>;
};

/**
 * Per-user CRM active time with a sub-page breakdown, over the range. Optionally
 * scoped to a set of user ids (the consultants shown on /crm/team). Returned as a
 * Map keyed by userId for a cheap join against the team's outcome rows.
 */
export async function getCrmUsageByUser(
  range: Range,
  userIds?: string[],
): Promise<Map<string, CrmUsageRow>> {
  const where: Prisma.ModuleUsageDailyWhereInput = { moduleId: "crm", ...dayWhere(range) };
  if (userIds) {
    if (userIds.length === 0) return new Map();
    where.userId = { in: userIds };
  }

  const grouped = await prisma.moduleUsageDaily.groupBy({
    by: ["userId", "page"],
    where,
    _sum: { activeSeconds: true },
  });

  const map = new Map<string, CrmUsageRow>();
  for (const g of grouped) {
    const secs = g._sum.activeSeconds ?? 0;
    if (secs <= 0) continue;
    let row = map.get(g.userId);
    if (!row) {
      row = { userId: g.userId, totalSeconds: 0, byPage: {} };
      map.set(g.userId, row);
    }
    row.byPage[g.page] = (row.byPage[g.page] ?? 0) + secs;
    row.totalSeconds += secs;
  }
  return map;
}
