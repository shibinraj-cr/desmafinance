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
import { getSetting } from "./app-settings";
import { toPrismaDate } from "./lead-pulse-dates";
import {
  monthBounds,
  pct,
  getServiceConversionMatrix,
  type ServiceMatrix,
  type ServiceMatrixCell,
  type Matrix,
  type MatrixBdeRow,
  type MatrixCell,
} from "./lead-pulse-metrics";

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
  // Leads the CRM has flagged as duplicates (email/phone collision → `duplicate`
  // status) are excluded so a re-assigned duplicate is never double-counted.
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
        AND st.code <> 'duplicate'
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

// ── Metrics source flag ──────────────────────────────────────────────────────
// Which data source the live Lead Pulse dashboards read from. Defaults to the
// daily entry; a supervisor flips it to "crm" once every close is entered as a
// CRM enrollment (validated on /marketing/lead-pulse/crm-metrics). Reversible.
export const METRICS_SOURCE_KEY = "lead_pulse_metrics_source";
export type MetricsSource = "daily_entry" | "crm";

export async function getMetricsSource(): Promise<MetricsSource> {
  const v = await getSetting(METRICS_SOURCE_KEY);
  return v === "crm" ? "crm" : "daily_entry";
}

/**
 * The service-conversion matrix from whichever source is active. Both branches
 * return the identical `ServiceMatrix` shape, so consumers (Targets page,
 * TargetAchievementCard) need no change — only this resolver in place of a
 * direct `getServiceConversionMatrix` call.
 */
export async function resolveServiceMatrix(year: number, month: number): Promise<ServiceMatrix> {
  const source = await getMetricsSource();
  return source === "crm" ? getCrmServiceMatrix(year, month) : getServiceConversionMatrix(year, month);
}

/** Total CRM enrollments (closed_won pipelines) this month across all L2 BDEs. */
export async function getCrmEnrolledTotal(year: number, month: number): Promise<number> {
  const funnel = await getCrmFunnelByBde(year, month);
  return funnel.reduce((sum, b) => sum + b.enrolled, 0);
}

// ── Simplified CRM funnel (Phase 2b) ─────────────────────────────────────────
// Leads assigned (deliberate, import carryover excluded) → enrollments (won) →
// conversion, for arbitrary date ranges. Powers the dashboard / monthly report /
// BDE performance pages when the metrics source is "crm".

/** assignedAt is a DateTime → half-open [start 00:00, end+1day 00:00) in UTC. */
function assignRange(start: string, end: string): { gte: Date; lt: Date } {
  const gte = new Date(`${start}T00:00:00.000Z`);
  const lt = new Date(new Date(`${end}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
  return { gte, lt };
}
// SQL fragment: a lead counts as deliberately assigned (not bulk-import carryover).
const DELIBERATE = Prisma.sql`(l."importBatchId" IS NULL OR l."assignedAt" > b."createdAt" + interval '10 minutes')`;
// SQL fragment: exclude leads the CRM has flagged as duplicates (email/phone
// collision → `duplicate` status) so a re-assigned duplicate is never
// double-counted in "leads assigned". Requires a `CrmLeadStatus st` join.
const NOT_DUPLICATE = Prisma.sql`st.code <> 'duplicate'`;

export type CrmFunnel = { leadsAssigned: number; enrolled: number; conversionPct: number | null };

/** Team-wide (or per-user / per-source) CRM funnel for a date range. */
export async function getCrmFunnel(opts: {
  start: string;
  end: string;
  userId?: string | null;
  sourceId?: string | null;
}): Promise<CrmFunnel> {
  const { gte, lt } = assignRange(opts.start, opts.end);
  const userCond = opts.userId ? Prisma.sql`AND l."assignedToId" = ${opts.userId}` : Prisma.empty;
  const srcCond = opts.sourceId ? Prisma.sql`AND l."sourceId" = ${opts.sourceId}` : Prisma.empty;
  const [leadRows, enrolled] = await Promise.all([
    prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS n
      FROM "Lead" l
      LEFT JOIN "LeadImportBatch" b ON l."importBatchId" = b.id
      JOIN "CrmLeadStatus" st ON l."statusId" = st.id
      WHERE l."assignedToId" IS NOT NULL
        AND l."assignedAt" >= ${gte} AND l."assignedAt" < ${lt}
        ${userCond} ${srcCond} AND ${DELIBERATE} AND ${NOT_DUPLICATE}
    `),
    prisma.leadPulsePipeline.count({
      where: {
        status: "closed_won",
        closedDate: { gte: toPrismaDate(opts.start), lte: toPrismaDate(opts.end) },
        ...(opts.userId ? { userId: opts.userId } : {}),
        ...(opts.sourceId ? { sourceId: opts.sourceId } : {}),
      },
    }),
  ]);
  const leadsAssigned = Number(leadRows[0]?.n ?? 0);
  return { leadsAssigned, enrolled, conversionPct: pct(enrolled, leadsAssigned) };
}

export type CrmServiceEnrollment = {
  serviceId: string;
  serviceName: string;
  groupName: string | null;
  enrolled: number;
};

/**
 * Per-service enrollment counts for a date range: closed_won pipelines
 * (CRM enrollments) grouped by the individual Service the candidate
 * enrolled in — team-wide, or scoped to one BDE. Unlike `getCrmServiceMatrix`
 * this collapses the BDE dimension and keys by individual Service (not
 * ServiceGroup), so the counts sum to the same team enrollment total shown
 * by `getCrmFunnel`. Ordered by count desc, then service name.
 */
export async function getCrmEnrollmentsByService(opts: {
  start: string;
  end: string;
  userId?: string | null;
}): Promise<CrmServiceEnrollment[]> {
  const grouped = await prisma.leadPulsePipeline.groupBy({
    by: ["serviceId"],
    where: {
      status: "closed_won",
      closedDate: { gte: toPrismaDate(opts.start), lte: toPrismaDate(opts.end) },
      ...(opts.userId ? { userId: opts.userId } : {}),
    },
    _count: true,
  });
  if (!grouped.length) return [];
  const services = await prisma.service.findMany({
    where: { id: { in: grouped.map((g) => g.serviceId) } },
    select: { id: true, name: true, group: { select: { name: true } } },
  });
  const svcMap = new Map(services.map((s) => [s.id, s]));
  return grouped
    .map((g) => {
      const svc = svcMap.get(g.serviceId);
      return {
        serviceId: g.serviceId,
        serviceName: svc?.name ?? "Unknown service",
        groupName: svc?.group?.name ?? null,
        enrolled: g._count,
      };
    })
    .sort((a, b) => b.enrolled - a.enrolled || a.serviceName.localeCompare(b.serviceName));
}

export type CrmSourceFunnel = {
  sourceId: string;
  sourceCode: string;
  sourceLabel: string;
  leadsAssigned: number;
  enrolled: number;
  conversionPct: number | null;
};

/** Per-source CRM funnel (team-wide, or for one BDE). */
export async function getCrmFunnelBySource(opts: {
  start: string;
  end: string;
  userId?: string | null;
}): Promise<CrmSourceFunnel[]> {
  const { gte, lt } = assignRange(opts.start, opts.end);
  const userCond = opts.userId ? Prisma.sql`AND l."assignedToId" = ${opts.userId}` : Prisma.empty;
  const [sources, leadRows, enrolledRows] = await Promise.all([
    prisma.leadPulseSource.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
      select: { id: true, code: true, label: true },
    }),
    prisma.$queryRaw<Array<{ sourceId: string | null; n: bigint }>>(Prisma.sql`
      SELECT l."sourceId" AS "sourceId", COUNT(*) AS n
      FROM "Lead" l
      LEFT JOIN "LeadImportBatch" b ON l."importBatchId" = b.id
      JOIN "CrmLeadStatus" st ON l."statusId" = st.id
      WHERE l."assignedToId" IS NOT NULL
        AND l."assignedAt" >= ${gte} AND l."assignedAt" < ${lt}
        ${userCond} AND ${DELIBERATE} AND ${NOT_DUPLICATE}
      GROUP BY l."sourceId"
    `),
    prisma.leadPulsePipeline.groupBy({
      by: ["sourceId"],
      where: {
        status: "closed_won",
        closedDate: { gte: toPrismaDate(opts.start), lte: toPrismaDate(opts.end) },
        ...(opts.userId ? { userId: opts.userId } : {}),
      },
      _count: true,
    }),
  ]);
  const lMap = new Map(leadRows.map((r) => [r.sourceId, Number(r.n)]));
  const eMap = new Map(enrolledRows.map((e) => [e.sourceId, e._count]));
  return sources.map((s) => {
    const leadsAssigned = lMap.get(s.id) ?? 0;
    const enrolled = eMap.get(s.id) ?? 0;
    return { sourceId: s.id, sourceCode: s.code, sourceLabel: s.label, leadsAssigned, enrolled, conversionPct: pct(enrolled, leadsAssigned) };
  });
}

/**
 * CRM twin of `getMonthlyMatrix` — returns the identical `Matrix` shape so the
 * monthly-report `PerformanceMatrix` renders unchanged. `cell.leads` = leads
 * assigned, `cell.won` = enrollments. (L1 BDEs have won = 0 — enrollments only
 * attribute to L2 pipeline owners.)
 */
export async function getCrmMonthlyMatrix(opts: {
  year: number;
  month: number;
  sourceCode?: string | null;
  region?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}): Promise<Matrix> {
  const fb = monthBounds(opts.year, opts.month);
  const start = opts.startDate || fb.start;
  const end = opts.endDate || fb.end;
  const { gte, lt } = assignRange(start, end);

  const sources = await prisma.leadPulseSource.findMany({
    where: { active: true, ...(opts.sourceCode ? { code: opts.sourceCode } : {}) },
    orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
  });
  const roleRows = await prisma.leadPulseRole.findMany({
    where: { role: { in: ["l1", "l2"] }, ...(opts.region ? { regionFocus: { has: opts.region } } : {}) },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
  });
  const userIds = roleRows.map((r) => r.userId);
  const sourceCodeCond = opts.sourceCode ? Prisma.sql`AND s.code = ${opts.sourceCode}` : Prisma.empty;

  const [leadRows, enrolledRows] = userIds.length
    ? await Promise.all([
        prisma.$queryRaw<Array<{ userId: string; sourceId: string | null; n: bigint }>>(Prisma.sql`
          SELECT l."assignedToId" AS "userId", l."sourceId" AS "sourceId", COUNT(*) AS n
          FROM "Lead" l
          LEFT JOIN "LeadImportBatch" b ON l."importBatchId" = b.id
          LEFT JOIN "LeadPulseSource" s ON l."sourceId" = s.id
          JOIN "CrmLeadStatus" st ON l."statusId" = st.id
          WHERE l."assignedToId" IN (${Prisma.join(userIds)})
            AND l."assignedAt" >= ${gte} AND l."assignedAt" < ${lt}
            ${sourceCodeCond} AND ${DELIBERATE} AND ${NOT_DUPLICATE}
          GROUP BY l."assignedToId", l."sourceId"
        `),
        prisma.leadPulsePipeline.groupBy({
          by: ["userId", "sourceId"],
          where: {
            userId: { in: userIds },
            status: "closed_won",
            closedDate: { gte: toPrismaDate(start), lte: toPrismaDate(end) },
            ...(opts.sourceCode ? { source: { code: opts.sourceCode } } : {}),
          },
          _count: true,
        }),
      ])
    : [[], []];

  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const newCell = (): MatrixCell => ({ leads: 0, won: 0, conversionPct: null });
  const rowByUser = new Map<string, MatrixBdeRow>();
  for (const r of roleRows) {
    const perSource = new Map<string, MatrixCell>();
    for (const s of sources) perSource.set(s.code, newCell());
    rowByUser.set(r.userId, { userId: r.userId, displayName: r.displayName, role: r.role as "l1" | "l2", perSource, total: newCell() });
  }
  for (const lr of leadRows) {
    const row = rowByUser.get(lr.userId);
    const src = lr.sourceId ? sourceById.get(lr.sourceId) : undefined;
    if (!row || !src) continue;
    const cell = row.perSource.get(src.code);
    if (cell) cell.leads += Number(lr.n);
  }
  for (const er of enrolledRows) {
    const row = rowByUser.get(er.userId);
    const src = er.sourceId ? sourceById.get(er.sourceId) : undefined;
    if (!row || !src) continue;
    const cell = row.perSource.get(src.code);
    if (cell) cell.won += er._count;
  }
  for (const row of rowByUser.values()) {
    let tl = 0;
    let tw = 0;
    for (const cell of row.perSource.values()) {
      cell.conversionPct = pct(cell.won, cell.leads);
      tl += cell.leads;
      tw += cell.won;
    }
    row.total = { leads: tl, won: tw, conversionPct: pct(tw, tl) };
  }
  const l1Rows = Array.from(rowByUser.values()).filter((r) => r.role === "l1");
  const l2Rows = Array.from(rowByUser.values()).filter((r) => r.role === "l2");
  function subtotal(rows: MatrixBdeRow[]): { perSource: Map<string, MatrixCell>; total: MatrixCell } {
    const perSource = new Map<string, MatrixCell>();
    for (const s of sources) perSource.set(s.code, newCell());
    let tl = 0;
    let tw = 0;
    for (const r of rows) {
      for (const [code, cell] of r.perSource) {
        const acc = perSource.get(code)!;
        acc.leads += cell.leads;
        acc.won += cell.won;
      }
      tl += r.total.leads;
      tw += r.total.won;
    }
    for (const cell of perSource.values()) cell.conversionPct = pct(cell.won, cell.leads);
    return { perSource, total: { leads: tl, won: tw, conversionPct: pct(tw, tl) } };
  }
  return {
    sources: sources.map((s) => ({ id: s.id, code: s.code, label: s.label })),
    l1Rows,
    l2Rows,
    l1Subtotal: subtotal(l1Rows),
    l2Subtotal: subtotal(l2Rows),
    globalTotal: subtotal([...l1Rows, ...l2Rows]),
  };
}
