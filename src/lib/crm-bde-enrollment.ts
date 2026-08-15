/**
 * BDE Enrollment — the CRM's money-facing sibling of the Team Activity
 * dashboard (`crm-team.ts`). Where Team Activity answers "is each BDE
 * working their leads?" (people/process, SLA hygiene), this answers "what is
 * each BDE converting, against what target, and what's it worth?" — a single
 * calendar month, admin-only.
 *
 * Reuses rather than re-derives:
 *   - {@link getTeamActivity} for SLA/hygiene counts (slaBreaches, abandoned,
 *     stuck, noTask, openReinquiry, firstResponseBreached) and tasks
 *     completed/on-time — same thresholds, same attention engine, so the two
 *     dashboards can never disagree on what counts as a flagged lead.
 *   - {@link getCrmFunnelByBde} for leads-assigned/enrolled/conversion.
 *   - {@link getCrmFunnelBySource} for the source-conversion table.
 *
 * New here: leads *created* (self-sourced, not assigned by admin), enrolled
 * ₹ value and open pipeline ₹ value (from LeadPulsePipeline), monthly target
 * (LeadPulseTarget, summed across services/groups), overdue-task counts, a
 * pipeline-by-expected-close bucketing, and per-BDE current-stage mix for the
 * detail drawer.
 */
import { prisma } from "./prisma";
import { getAssignableBdes } from "./crm-leads";
import { getCrmFunnelByBde, getCrmFunnelBySource } from "./lead-pulse-crm-metrics";
import { getTeamActivity, wholeTeamScope, ABANDONED_DAYS, STUCK_DAYS, FIRST_RESPONSE_SLA_HOURS, startOfLocalDay } from "./crm-team";
import { monthBounds } from "./lead-pulse-metrics";
import { toPrismaDate, todayIst, fromPrismaDate } from "./lead-pulse-dates";
import { inr } from "./format";

// ── Month helpers ────────────────────────────────────────────────────────────

export type MonthOption = { value: string; label: string };

function currentYearMonth(): { year: number; month: number } {
  const ymd = todayIst();
  return { year: Number(ymd.slice(0, 4)), month: Number(ymd.slice(5, 7)) };
}

/** The last `count` calendar months (oldest→newest), ending at the current IST month. */
export function recentMonthOptions(count = 6): MonthOption[] {
  const { year, month } = currentYearMonth();
  const out: MonthOption[] = [];
  for (let i = count - 1; i >= 0; i--) {
    let y = year;
    let m = month - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    out.push({
      value: `${y}-${String(m).padStart(2, "0")}`,
      label: new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    });
  }
  return out;
}

/** Parse a `YYYY-MM` value; falls back to the current IST month when malformed. */
export function parseMonthValue(v: string | undefined): { year: number; month: number; value: string } {
  const m = v ? /^(\d{4})-(\d{2})$/.exec(v) : null;
  if (!m) {
    const c = currentYearMonth();
    return { ...c, value: `${c.year}-${String(c.month).padStart(2, "0")}` };
  }
  return { year: Number(m[1]), month: Number(m[2]), value: v! };
}

function monthProgress(year: number, month: number): { daysInMonth: number; elapsedDays: number; share: number } {
  const { year: curY, month: curM } = currentYearMonth();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isFuture = year > curY || (year === curY && month > curM);
  const isCurrent = year === curY && month === curM;
  const elapsedDays = isFuture ? 0 : isCurrent ? Number(todayIst().slice(8, 10)) : daysInMonth;
  return { daysInMonth, elapsedDays, share: daysInMonth > 0 ? elapsedDays / daysInMonth : 0 };
}

// ── Shapes ────────────────────────────────────────────────────────────────────

export type PipelineDeal = {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  service: string;
  value: number;
  meta: string;
};

export type PipelineBucket = {
  key: "slipped" | "this" | "next" | "later";
  label: string;
  tone: "danger" | "warning" | "neutral";
  value: number;
  count: number;
  deals: PipelineDeal[];
  moreCount: number;
};

export type SourceRow = {
  sourceId: string;
  name: string;
  leads: number;
  enrolled: number;
  convPct: number | null;
  value: number;
};

export type BdeRow = {
  userId: string;
  name: string;
  role: string;
  assigned: number;
  created: number;
  enrolled: number;
  convAssigned: number | null;
  convCreated: number | null;
  target: number;
  targetToDate: number;
  ahead: boolean;
  enrolledValue: number;
  pipelineValue: number;
  pipelineCount: number;
  tasksCompleted: number;
  tasksOnTime: number;
  slaBreaches: number;
  abandoned: number;
  noTask: number;
  stuck: number;
  overdueTasks: number;
  openReinquiry: number;
  firstResponseBreached: number;
  flags: number;
};

export type StageMixEntry = { code: string; label: string; color: string | null; count: number };

export type ConsultantDetail = {
  userId: string;
  name: string;
  role: string;
  row: BdeRow;
  stageMix: StageMixEntry[];
  deals: PipelineDeal[];
  dealsMoreCount: number;
  narrative: string;
};

export type BdeEnrollmentData = {
  month: string;
  monthLabel: string;
  monthOptions: MonthOption[];
  daysInMonth: number;
  elapsedDays: number;
  bdeFilter: string;
  bdeOptions: Array<{ value: string; label: string }>;
  kpis: Array<{ label: string; value: string | number; hint: string; tone: "default" | "primary" | "danger" | "success" }>;
  team: {
    enrolled: number;
    target: number;
    actualWidthPct: number;
    paceMarkerPct: number;
    ahead: boolean;
    paceText: string;
    paceGap: number;
    projected: number;
    aheadCount: number;
    totalCount: number;
    avgTicket: number | null;
  };
  rows: BdeRow[];
  totals: {
    assigned: number;
    created: number;
    enrolled: number;
    convAssigned: number | null;
    convCreated: number | null;
    target: number;
    enrolledValue: number;
    pipelineValue: number;
    tasksCompleted: number;
    tasksOnTime: number;
    flags: number;
  };
  buckets: PipelineBucket[];
  pipelineNote: string;
  slaTiles: Array<{ key: string; label: string; rule: string; count: number; tone: "danger" | "warning" | "neutral" }>;
  slaWorst: Array<{ userId: string; name: string; count: number; widthPct: number }>;
  sources: SourceRow[];
  details: Record<string, ConsultantDetail>;
};

// ── Pure helpers ─────────────────────────────────────────────────────────────

function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = new Date(`${fromYmd}T00:00:00.000Z`).getTime();
  const b = new Date(`${toYmd}T00:00:00.000Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function dealMeta(ownerName: string, service: string, diffDays: number): string {
  const when = diffDays < 0 ? `${Math.abs(diffDays)}d overdue` : diffDays === 0 ? "today" : `in ${diffDays}d`;
  return `${ownerName} · ${service} · ${when}`;
}

function narrativeFor(row: BdeRow, monthLabel: string, daysLeft: number): string {
  const first = row.name.split(" ")[0];
  const paceWord = row.ahead ? "ahead of" : "behind";
  const conv = row.convAssigned === null ? "—" : `${row.convAssigned}%`;
  const daysLeftText = daysLeft > 0 ? ` with ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : "";
  return (
    `${first} is ${paceWord} pace at ${row.enrolled} of ${row.target} enrolments in ${monthLabel}${daysLeftText}, ` +
    `converting ${conv} of the ${row.assigned} leads given. Open pipeline is ${inr(row.pipelineValue)} across ` +
    `${row.pipelineCount} deal${row.pipelineCount === 1 ? "" : "s"}, and ${row.flags} lead${row.flags === 1 ? "" : "s"} ` +
    `${row.flags === 1 ? "is" : "are"} flagged for SLA or follow-up issues.`
  );
}

// ── Assembler ─────────────────────────────────────────────────────────────────

export async function getBdeEnrollmentData(opts: {
  monthValue: string;
  bdeFilter: string;
  selfUserId: string;
}): Promise<BdeEnrollmentData> {
  const { year, month, value: monthVal } = parseMonthValue(opts.monthValue);
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const { daysInMonth, elapsedDays, share } = monthProgress(year, month);
  const now = new Date();
  const todayYmd = todayIst();

  const roster = await getAssignableBdes();
  const ids = roster.map((b) => b.userId);
  const bdeFilter = opts.bdeFilter !== "all" && ids.includes(opts.bdeFilter) ? opts.bdeFilter : "all";

  const mb = monthBounds(year, month); // date-only YYYY-MM-DD bounds, for @db.Date columns
  const monthStartUTC = new Date(Date.UTC(year, month - 1, 1));
  const monthEndUTC = new Date(Date.UTC(year, month, 1)); // exclusive

  const [
    funnel,
    activity,
    createdGroups,
    enrolledValueGroups,
    openDeals,
    targetGroups,
    overdueGroups,
    statuses,
    stageGroups,
  ] = await Promise.all([
    getCrmFunnelByBde(year, month),
    getTeamActivity({ scope: wholeTeamScope(opts.selfUserId), range: { from: monthStartUTC, to: monthEndUTC }, now }),
    ids.length
      ? prisma.lead.groupBy({
          by: ["createdById"],
          where: { createdById: { in: ids }, createdAt: { gte: monthStartUTC, lt: monthEndUTC } },
          _count: { _all: true },
        })
      : Promise.resolve([] as Array<{ createdById: string | null; _count: { _all: number } }>),
    ids.length
      ? prisma.leadPulsePipeline.groupBy({
          by: ["userId"],
          where: { userId: { in: ids }, status: "closed_won", closedDate: { gte: toPrismaDate(mb.start), lte: toPrismaDate(mb.end) } },
          _sum: { expectedFirstInstallment: true },
        })
      : Promise.resolve([] as Array<{ userId: string; _sum: { expectedFirstInstallment: unknown } }>),
    ids.length
      ? prisma.leadPulsePipeline.findMany({
          where: { userId: { in: ids }, status: "open" },
          select: {
            id: true,
            userId: true,
            candidateName: true,
            expectedCloseDate: true,
            expectedFirstInstallment: true,
            service: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.leadPulseTarget.groupBy({ by: ["userId"], where: { year, month, userId: { in: ids } }, _sum: { target: true } })
      : Promise.resolve([] as Array<{ userId: string; _sum: { target: number | null } }>),
    ids.length
      ? prisma.crmTask.groupBy({
          by: ["assignedToId"],
          where: { status: "open", dueAt: { lt: startOfLocalDay(now) }, assignedToId: { in: ids } },
          _count: { _all: true },
        })
      : Promise.resolve([] as Array<{ assignedToId: string | null; _count: { _all: number } }>),
    prisma.crmLeadStatus.findMany({ where: { kind: "active" }, orderBy: { displayOrder: "asc" }, select: { id: true, code: true, label: true, color: true } }),
    ids.length
      ? prisma.lead.groupBy({
          by: ["assignedToId", "statusId"],
          where: { assignedToId: { in: ids }, status: { kind: "active" } },
          _count: { _all: true },
        })
      : Promise.resolve([] as Array<{ assignedToId: string | null; statusId: string; _count: { _all: number } }>),
  ]);

  const funnelById = new Map(funnel.map((f) => [f.userId, f]));
  const activityById = new Map(activity.bdeRows.map((r) => [r.userId, r]));
  const createdById = new Map(createdGroups.map((g) => [g.createdById, g._count._all]));
  const enrolledValueById = new Map(enrolledValueGroups.map((g) => [g.userId, Number(g._sum.expectedFirstInstallment ?? 0)]));
  const targetById = new Map(targetGroups.map((g) => [g.userId, g._sum.target ?? 0]));
  const overdueById = new Map(overdueGroups.map((g) => [g.assignedToId, g._count._all]));
  const nameById = new Map(roster.map((b) => [b.userId, b.displayName]));
  const statusById = new Map(statuses.map((s) => [s.id, s]));

  // Deals (open pipeline) — bucketed by expected close date relative to today.
  const allDeals: PipelineDeal[] = openDeals.map((d) => {
    const closeYmd = fromPrismaDate(d.expectedCloseDate);
    const diff = daysBetween(todayYmd, closeYmd);
    const ownerName = nameById.get(d.userId) ?? "Unassigned";
    return {
      id: d.id,
      ownerId: d.userId,
      ownerName,
      name: d.candidateName,
      service: d.service?.name ?? "—",
      value: Number(d.expectedFirstInstallment),
      meta: dealMeta(ownerName, d.service?.name ?? "—", diff),
    };
  });
  const dealDiff = new Map(openDeals.map((d) => [d.id, daysBetween(todayYmd, fromPrismaDate(d.expectedCloseDate))]));

  const pipelineByOwner = new Map<string, { value: number; count: number }>();
  for (const d of allDeals) {
    const cur = pipelineByOwner.get(d.ownerId) ?? { value: 0, count: 0 };
    cur.value += d.value;
    cur.count += 1;
    pipelineByOwner.set(d.ownerId, cur);
  }

  // Current active-stage mix, per BDE (for the detail drawer).
  const stageMixByOwner = new Map<string, Map<string, number>>();
  for (const g of stageGroups) {
    if (!g.assignedToId) continue;
    const m = stageMixByOwner.get(g.assignedToId) ?? new Map<string, number>();
    m.set(g.statusId, g._count._all);
    stageMixByOwner.set(g.assignedToId, m);
  }

  // ── Build one row per roster member ──
  const daysLeft = Math.max(0, daysInMonth - elapsedDays);
  const allRows: BdeRow[] = roster.map((b) => {
    const f = funnelById.get(b.userId);
    const a = activityById.get(b.userId);
    const assigned = f?.leadsAssigned ?? 0;
    const enrolled = f?.enrolled ?? 0;
    const created = createdById.get(b.userId) ?? 0;
    const target = targetById.get(b.userId) ?? 0;
    const targetToDate = target * share;
    const pipeline = pipelineByOwner.get(b.userId) ?? { value: 0, count: 0 };
    const slaBreaches = a?.slaBreaches ?? 0;
    const abandoned = a?.abandoned ?? 0;
    const noTask = a?.noTask ?? 0;
    const stuck = a?.stuck ?? 0;
    const overdueTasks = overdueById.get(b.userId) ?? 0;
    const firstResponseBreached = a?.firstResponseBreached ?? 0;
    return {
      userId: b.userId,
      name: b.displayName,
      role: b.role,
      assigned,
      created,
      enrolled,
      convAssigned: pct(enrolled, assigned),
      convCreated: pct(enrolled, created),
      target,
      targetToDate,
      ahead: enrolled >= targetToDate,
      enrolledValue: enrolledValueById.get(b.userId) ?? 0,
      pipelineValue: pipeline.value,
      pipelineCount: pipeline.count,
      tasksCompleted: a?.tasksCompleted ?? 0,
      tasksOnTime: a?.tasksOnTime ?? 0,
      slaBreaches,
      abandoned,
      noTask,
      stuck,
      overdueTasks,
      openReinquiry: a?.openReinquiry ?? 0,
      firstResponseBreached,
      flags: slaBreaches + firstResponseBreached + abandoned + stuck + noTask + overdueTasks,
    };
  });
  const rowById = new Map(allRows.map((r) => [r.userId, r]));

  const rows = (bdeFilter === "all" ? allRows : allRows.filter((r) => r.userId === bdeFilter)).sort(
    (a, b) => b.enrolled - a.enrolled || b.enrolledValue - a.enrolledValue,
  );
  const scopedIds = new Set(rows.map((r) => r.userId));

  // ── Totals over the scoped rows ──
  const sum = (pick: (r: BdeRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const tAssigned = sum((r) => r.assigned);
  const tCreated = sum((r) => r.created);
  const tEnrolled = sum((r) => r.enrolled);
  const tTarget = sum((r) => r.target);
  const tEnrolledValue = sum((r) => r.enrolledValue);
  const tPipelineValue = sum((r) => r.pipelineValue);
  const tTasksCompleted = sum((r) => r.tasksCompleted);
  const tTasksOnTime = sum((r) => r.tasksOnTime);
  const tFlags = sum((r) => r.flags);
  const targetToDate = tTarget * share;
  const projected = share > 0 ? Math.round(tEnrolled / share) : 0;
  const paceGap = Math.round(tEnrolled - targetToDate);

  // ── Pipeline buckets (scoped) ──
  const scopedDeals = allDeals.filter((d) => scopedIds.has(d.ownerId));
  const bucketDefs: Array<{ key: PipelineBucket["key"]; label: string; tone: PipelineBucket["tone"] }> = [
    { key: "slipped", label: "Slipped", tone: "danger" },
    { key: "this", label: "This week", tone: "danger" },
    { key: "next", label: "Next week", tone: "warning" },
    { key: "later", label: "Later this month", tone: "neutral" },
  ];
  const buckets: PipelineBucket[] = bucketDefs.map((def) => {
    const list = scopedDeals
      .filter((d) => {
        const diff = dealDiff.get(d.id) ?? 0;
        if (def.key === "slipped") return diff < 0;
        if (def.key === "this") return diff >= 0 && diff <= 6;
        if (def.key === "next") return diff >= 7 && diff <= 13;
        return diff >= 14;
      })
      .sort((a, b) => (dealDiff.get(a.id) ?? 0) - (dealDiff.get(b.id) ?? 0));
    const shown = list.slice(0, 4);
    return {
      key: def.key,
      label: def.label,
      tone: def.tone,
      value: list.reduce((s, d) => s + d.value, 0),
      count: list.length,
      deals: shown,
      moreCount: Math.max(0, list.length - shown.length),
    };
  });
  // Reorder to match the mockup's reading order: this/next/later/slipped.
  const orderedBuckets = ["this", "next", "later", "slipped"].map((k) => buckets.find((b) => b.key === k)!);

  // ── SLA tiles (scoped) ──
  const slaSum = (pick: (r: BdeRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const slaTiles: BdeEnrollmentData["slaTiles"] = [
    { key: "sla", label: "Stage SLA breaches", rule: "past stage SLA (1–3d)", count: slaSum((r) => r.slaBreaches), tone: "danger" },
    { key: "firstResponse", label: "First-response gaps", rule: `no contact within ${FIRST_RESPONSE_SLA_HOURS}h`, count: slaSum((r) => r.firstResponseBreached), tone: "danger" },
    { key: "abandoned", label: "Abandoned", rule: `untouched > ${ABANDONED_DAYS} days`, count: slaSum((r) => r.abandoned), tone: "danger" },
    { key: "stuck", label: "Stuck in stage", rule: `same status > ${STUCK_DAYS} days`, count: slaSum((r) => r.stuck), tone: "warning" },
    { key: "noTask", label: "No next step", rule: "active lead, no open task", count: slaSum((r) => r.noTask), tone: "warning" },
    { key: "overdueTasks", label: "Overdue tasks", rule: "due date passed", count: slaSum((r) => r.overdueTasks), tone: "danger" },
    { key: "reinquiry", label: "Re-inquiry follow-ups", rule: "open re-inquiry tasks", count: slaSum((r) => r.openReinquiry), tone: "neutral" },
  ];
  const maxFlags = Math.max(1, ...rows.map((r) => r.flags));
  const slaWorst = [...rows]
    .sort((a, b) => b.flags - a.flags)
    .slice(0, 5)
    .filter((r) => r.flags > 0)
    .map((r) => ({ userId: r.userId, name: r.name, count: r.flags, widthPct: Math.round((r.flags / maxFlags) * 100) }));

  // ── Source-wise conversion (scoped) ──
  const [funnelBySource, sourceValueGroups] = await Promise.all([
    getCrmFunnelBySource({ start: mb.start, end: mb.end, userId: bdeFilter !== "all" ? bdeFilter : undefined }),
    prisma.leadPulsePipeline.groupBy({
      by: ["sourceId"],
      where: {
        status: "closed_won",
        closedDate: { gte: toPrismaDate(mb.start), lte: toPrismaDate(mb.end) },
        ...(bdeFilter !== "all" ? { userId: bdeFilter } : { userId: { in: ids } }),
      },
      _sum: { expectedFirstInstallment: true },
    }),
  ]);
  const sourceValueById = new Map(sourceValueGroups.map((g) => [g.sourceId, Number(g._sum.expectedFirstInstallment ?? 0)]));
  const sources: SourceRow[] = funnelBySource
    .map((s) => ({
      sourceId: s.sourceId,
      name: s.sourceLabel,
      leads: s.leadsAssigned,
      enrolled: s.enrolled,
      convPct: s.conversionPct,
      value: sourceValueById.get(s.sourceId) ?? 0,
    }))
    .filter((s) => s.leads > 0 || s.enrolled > 0)
    .sort((a, b) => b.enrolled - a.enrolled || b.leads - a.leads);

  // ── Detail drawer payload, for every roster member (independent of bdeFilter) ──
  const details: Record<string, ConsultantDetail> = {};
  for (const b of roster) {
    const row = rowById.get(b.userId);
    if (!row) continue;
    const mix = stageMixByOwner.get(b.userId) ?? new Map<string, number>();
    const stageMix: StageMixEntry[] = statuses.map((s) => ({ code: s.code, label: s.label, color: s.color, count: mix.get(s.id) ?? 0 }));
    const myDeals = allDeals
      .filter((d) => d.ownerId === b.userId)
      .sort((a, b2) => (dealDiff.get(a.id) ?? 0) - (dealDiff.get(b2.id) ?? 0));
    details[b.userId] = {
      userId: b.userId,
      name: b.displayName,
      role: b.role,
      row,
      stageMix,
      deals: myDeals.slice(0, 6),
      dealsMoreCount: Math.max(0, myDeals.length - 6),
      narrative: narrativeFor(row, monthLabel, daysLeft),
    };
  }
  void statusById; // retained for potential future colour lookups; stageMix already carries color

  // ── KPI strip ──
  const kpis: BdeEnrollmentData["kpis"] = [
    { label: "Leads given", value: String(tAssigned), hint: `assigned to BDEs · ${monthLabel}`, tone: "default" },
    { label: "Leads created", value: String(tCreated), hint: "self-sourced, BDE-owned", tone: "default" },
    {
      label: "Enrolments",
      value: String(tEnrolled),
      hint: `target ${tTarget} · ${paceGap >= 0 ? "+" : ""}${paceGap} vs pace`,
      tone: "success",
    },
    { label: "Conv. / given", value: pct(tEnrolled, tAssigned) === null ? "—" : `${pct(tEnrolled, tAssigned)}%`, hint: `${tEnrolled} of ${tAssigned} leads given`, tone: "primary" },
    { label: "Enrolled value", value: inr(tEnrolledValue), hint: `pipeline ${inr(tPipelineValue)} open`, tone: "default" },
    { label: "Tasks on time", value: `${tTasksCompleted ? Math.round((tTasksOnTime / tTasksCompleted) * 100) : 0}%`, hint: `${tTasksCompleted} completed · ${monthLabel}`, tone: "default" },
  ];

  return {
    month: monthVal,
    monthLabel,
    monthOptions: recentMonthOptions(6),
    daysInMonth,
    elapsedDays,
    bdeFilter,
    bdeOptions: [{ value: "all", label: "All BDEs" }, ...roster.map((b) => ({ value: b.userId, label: `${b.displayName} · ${b.role.toUpperCase()}` }))],
    kpis,
    team: {
      enrolled: tEnrolled,
      target: tTarget,
      actualWidthPct: Math.min(100, Math.round((tEnrolled / Math.max(1, tTarget)) * 100)),
      paceMarkerPct: Math.min(100, Math.round(share * 100)),
      ahead: tEnrolled >= targetToDate,
      paceText: `Marker shows where the month should be: ${Math.round(share * 100)}% elapsed, ${Math.round(targetToDate)} enrolments due to date.`,
      paceGap,
      projected,
      aheadCount: rows.filter((r) => r.ahead).length,
      totalCount: rows.length,
      avgTicket: tEnrolled ? tEnrolledValue / tEnrolled : null,
    },
    rows,
    totals: {
      assigned: tAssigned,
      created: tCreated,
      enrolled: tEnrolled,
      convAssigned: pct(tEnrolled, tAssigned),
      convCreated: pct(tEnrolled, tCreated),
      target: tTarget,
      enrolledValue: tEnrolledValue,
      pipelineValue: tPipelineValue,
      tasksCompleted: tTasksCompleted,
      tasksOnTime: tTasksOnTime,
      flags: tFlags,
    },
    buckets: orderedBuckets,
    pipelineNote: `${scopedDeals.length} open deal${scopedDeals.length === 1 ? "" : "s"} · ${inr(scopedDeals.reduce((s, d) => s + d.value, 0))} weighted at full value`,
    slaTiles,
    slaWorst,
    sources,
    details,
  };
}
