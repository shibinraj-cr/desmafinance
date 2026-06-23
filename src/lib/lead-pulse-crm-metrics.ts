/**
 * CRM-sourced Lead Pulse metrics — the forward-looking replacement for the
 * manual daily entry. Metrics come from CRM data only:
 *   - leads assigned   = Lead.assignedAt + assignedToId (set by Suhaina on assign)
 *   - enrollments (won) = LeadPulsePipeline status=closed_won (CRM "Enroll")
 *   - lost             = leads assigned this month now in a lost-kind status
 *
 * Phase 1 runs these ALONGSIDE the daily-entry metrics so the numbers can be
 * compared before the dashboards are flipped to this source. The matrix mirrors
 * `getServiceConversionMatrix` (same shape) but reads actuals from closed_won
 * pipelines instead of LeadPulseDailyClose.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { toPrismaDate } from "./lead-pulse-dates";
import { monthBounds, pct, type ServiceMatrix, type ServiceMatrixCell } from "./lead-pulse-metrics";

export type CrmBdeFunnel = {
  userId: string;
  displayName: string;
  role: string; // 'l1' | 'l2'
  leadsAssigned: number;
  enrolled: number;
  lost: number;
  conversionPct: number | null;
};

/** Per active L1/L2 BDE: leads assigned, enrollments, lost, conversion% for the month. */
export async function getCrmFunnelByBde(year: number, month: number): Promise<CrmBdeFunnel[]> {
  const { start, end } = monthBounds(year, month);
  // assignedAt is a full DateTime → use [monthStart, nextMonthStart) in UTC.
  const mStart = new Date(Date.UTC(year, month - 1, 1));
  const mEnd = new Date(Date.UTC(year, month, 1));

  const roles = await prisma.leadPulseRole.findMany({
    where: { active: true, role: { in: ["l1", "l2"] } },
    select: { userId: true, displayName: true, role: true },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
  });
  const ids = roles.map((r) => r.userId);
  if (!ids.length) return [];

  // "Leads assigned" must count only DELIBERATE in-app assignments, never the
  // bulk-import carryover. The importer stamps every imported lead's assignedAt
  // to the batch's import time, which would otherwise dump thousands of leads
  // onto the import month. A lead therefore counts only when it has no import
  // batch, OR its assignedAt is meaningfully later than the batch was created
  // (= a genuine later re-assignment). Raw SQL because Prisma can't compare a
  // column to a related column. `lost` is the same set narrowed to lost-kind.
  const [rows, enrolled] = await Promise.all([
    prisma.$queryRaw<Array<{ userId: string; assigned: bigint; lost: bigint }>>(Prisma.sql`
      SELECT l."assignedToId" AS "userId",
             COUNT(*) AS assigned,
             COUNT(*) FILTER (WHERE st.kind = 'lost') AS lost
      FROM "Lead" l
      LEFT JOIN "LeadImportBatch" b ON l."importBatchId" = b.id
      JOIN "CrmLeadStatus" st ON l."statusId" = st.id
      WHERE l."assignedToId" IN (${Prisma.join(ids)})
        AND l."assignedAt" >= ${mStart} AND l."assignedAt" < ${mEnd}
        AND (l."importBatchId" IS NULL OR l."assignedAt" > b."createdAt" + interval '10 minutes')
      GROUP BY l."assignedToId"
    `),
    prisma.leadPulsePipeline.groupBy({
      by: ["userId"],
      where: { userId: { in: ids }, status: "closed_won", closedDate: { gte: toPrismaDate(start), lte: toPrismaDate(end) } },
      _count: true,
    }),
  ]);

  const aMap = new Map(rows.map((r) => [r.userId, Number(r.assigned)]));
  const lMap = new Map(rows.map((r) => [r.userId, Number(r.lost)]));
  const eMap = new Map(enrolled.map((e) => [e.userId, e._count]));

  return roles.map((r) => {
    const leadsAssigned = aMap.get(r.userId) ?? 0;
    const en = eMap.get(r.userId) ?? 0;
    return {
      userId: r.userId,
      displayName: r.displayName,
      role: r.role,
      leadsAssigned,
      enrolled: en,
      lost: lMap.get(r.userId) ?? 0,
      conversionPct: pct(en, leadsAssigned),
    };
  });
}

/**
 * CRM twin of `getServiceConversionMatrix`: same targets, but `actual` is the
 * weighted count of closed_won pipelines per (L2 BDE, ServiceGroup) this month.
 */
export async function getCrmServiceMatrix(year: number, month: number): Promise<ServiceMatrix> {
  const { start, end } = monthBounds(year, month);
  const roles = await prisma.leadPulseRole.findMany({
    where: { role: "l2", active: true },
    select: { userId: true, displayName: true },
    orderBy: [{ displayName: "asc" }],
  });

  const allGroups = await prisma.serviceGroup.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
  const targets = await prisma.leadPulseTarget.findMany({ where: { year, month, groupId: { not: null } } });
  const groupMap = new Map<string, { id: string; name: string }>();
  for (const g of allGroups) groupMap.set(g.id, g);
  for (const t of targets) {
    if (t.groupId && !groupMap.has(t.groupId)) {
      const g = await prisma.serviceGroup.findUnique({ where: { id: t.groupId }, select: { id: true, name: true } });
      if (g) groupMap.set(g.id, g);
    }
  }
  const groups = Array.from(groupMap.values());

  const services = await prisma.service.findMany({ select: { id: true, name: true, groupId: true, weight: true } });
  const serviceById = new Map(services.map((s) => [s.id, s]));

  const cells = new Map<string, ServiceMatrixCell>();
  for (const r of roles) for (const g of groups) cells.set(`${r.userId}|${g.id}`, { target: 0, actual: 0, partyNames: [] });
  for (const t of targets) {
    if (!t.groupId) continue;
    const key = `${t.userId}|${t.groupId}`;
    const c = cells.get(key);
    if (c) c.target = t.target;
    else cells.set(key, { target: t.target, actual: 0, partyNames: [] });
  }

  // Actuals = closed_won pipelines (CRM enrollments) this month.
  const closes = await prisma.leadPulsePipeline.findMany({
    where: { userId: { in: roles.map((r) => r.userId) }, status: "closed_won", closedDate: { gte: toPrismaDate(start), lte: toPrismaDate(end) } },
    select: { userId: true, serviceId: true },
  });
  const breakdown = new Map<string, Map<string, number>>();
  for (const c of closes) {
    const svc = serviceById.get(c.serviceId);
    if (!svc || !svc.groupId) continue;
    const key = `${c.userId}|${svc.groupId}`;
    const cell = cells.get(key);
    if (!cell) continue;
    cell.actual += svc.weight ?? 1;
    const bm = breakdown.get(key) ?? new Map<string, number>();
    bm.set(svc.name, (bm.get(svc.name) ?? 0) + 1);
    breakdown.set(key, bm);
  }
  for (const [key, c] of cells) {
    c.actual = Math.round(c.actual * 10) / 10;
    const bm = breakdown.get(key);
    if (bm) {
      c.partyNames = Array.from(bm.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, n]) => `${name} × ${n}`);
    }
  }

  return { bdes: roles.map((r) => ({ userId: r.userId, displayName: r.displayName })), services: groups, cells };
}
