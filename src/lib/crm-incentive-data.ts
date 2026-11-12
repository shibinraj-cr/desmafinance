/**
 * Data side of the BDE incentive (`crm-incentive.ts` is the pure engine): reads
 * the month's settings from the Lead Pulse target sheet and each L2 BDE's
 * facts from the CRM, and returns every L2 BDE's standing plus every team's
 * pools. One call serves the whole team because a member's pool share depends
 * on everyone else's enrolments; `getIncentiveStanding` narrows it to one BDE.
 *
 * Facts, per BDE per month:
 *   - enrolled   — closed_won pipelines they own, closedDate in the month,
 *                  summed by service weight (same as the L2 targets matrix);
 *   - fastCloses — of those, Enroll clicked within 48h of the last assignment
 *                  before it (from LeadActivity ENROLLED / ASSIGNED / REASSIGNED);
 *   - referrals  — of those, source Candidate Referral on a lead they created.
 */
import { prisma } from "./prisma";
import { monthBounds } from "./lead-pulse-metrics";
import { toPrismaDate } from "./lead-pulse-dates";
import { getMonthlyTargetByBde } from "./lead-pulse-crm-metrics";
import { CANDIDATE_REFERRAL_SOURCE_CODE } from "./crm-rbac";
import {
  NO_BONUSES,
  computeBdePay,
  computeTeamPool,
  fillQuarterMemberships,
  isFastClose,
  milestones,
  quarterMembers,
  quarterMonths,
  quarterOf,
  slabsFromRow,
  type BdeMonthFacts,
  type BdePay,
  type Milestone,
  type MonthBonuses,
  type QuarterMonthFact,
  type Slab,
  type TeamPool,
  type TeamShare,
} from "./crm-incentive";

export type TeamPoolForMember = Omit<TeamPool, "members"> & { me: TeamShare | null };

export type BdeStanding = {
  userId: string;
  name: string;
  target: number;
  minimum: number | null;
  slabs: Slab[];
  /** False when Marketing Admin has saved no incentive row for this BDE this month. */
  configured: boolean;
  facts: BdeMonthFacts;
  pay: BdePay;
  milestones: Milestone[];
  team: { teamId: string; name: string; month: TeamPoolForMember | null; quarter: TeamPoolForMember | null } | null;
};

export type TeamStanding = {
  teamId: string;
  name: string;
  members: Array<{ userId: string; name: string }>;
  month: TeamPool | null;
  quarter: TeamPool | null;
};

export type IncentiveMonth = {
  year: number;
  month: number;
  quarter: number;
  /** Months of the quarter counted so far — up to and including `month`. */
  quarterMonthsSoFar: number[];
  bonuses: MonthBonuses;
  bdes: BdeStanding[];
  teams: TeamStanding[];
};

const ENROLL_TYPES = ["ENROLLED", "ASSIGNED", "REASSIGNED"];

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Each user's month facts; users with no enrolments are absent (treat as zero). */
export async function getBdeMonthFacts(year: number, month: number, userIds: string[]): Promise<Map<string, BdeMonthFacts>> {
  if (!userIds.length) return new Map();
  const { start, end } = monthBounds(year, month);
  const [pipelines, referralSource] = await Promise.all([
    prisma.leadPulsePipeline.findMany({
      where: { userId: { in: userIds }, status: "closed_won", closedDate: { gte: toPrismaDate(start), lte: toPrismaDate(end) } },
      select: {
        userId: true,
        sourceId: true,
        service: { select: { weight: true } },
        leadLink: { select: { id: true, createdById: true, assignedAt: true, createdAt: true } },
      },
    }),
    prisma.leadPulseSource.findUnique({ where: { code: CANDIDATE_REFERRAL_SOURCE_CODE }, select: { id: true } }),
  ]);

  const leadIds = pipelines.flatMap((p) => (p.leadLink ? [p.leadLink.id] : []));
  const activities = leadIds.length
    ? await prisma.leadActivity.findMany({
        where: { leadId: { in: leadIds }, type: { in: ENROLL_TYPES } },
        select: { leadId: true, type: true, occurredAt: true },
      })
    : [];
  const enrolledAt = new Map<string, Date>();
  const assignedAts = new Map<string, Date[]>();
  for (const a of activities) {
    if (a.type === "ENROLLED") {
      const cur = enrolledAt.get(a.leadId);
      if (!cur || a.occurredAt > cur) enrolledAt.set(a.leadId, a.occurredAt);
    } else {
      assignedAts.set(a.leadId, [...(assignedAts.get(a.leadId) ?? []), a.occurredAt]);
    }
  }

  const out = new Map<string, BdeMonthFacts>();
  for (const p of pipelines) {
    const f = out.get(p.userId) ?? { enrolled: 0, fastCloses: 0, referrals: 0 };
    f.enrolled = round1(f.enrolled + (p.service?.weight ?? 1));
    const lead = p.leadLink;
    if (lead) {
      const clickedAt = enrolledAt.get(lead.id);
      const assigned = [...(assignedAts.get(lead.id) ?? []), ...(lead.assignedAt ? [lead.assignedAt] : [])];
      if (clickedAt && isFastClose({ enrolledAt: clickedAt, assignedAts: assigned, leadCreatedAt: lead.createdAt })) f.fastCloses += 1;
      if (referralSource && p.sourceId === referralSource.id && lead.createdById === p.userId) f.referrals += 1;
    }
    out.set(p.userId, f);
  }
  return out;
}

const ZERO_FACTS: BdeMonthFacts = { enrolled: 0, fastCloses: 0, referrals: 0 };

/** Every active L2 BDE's standing and every team's pools for a month. */
export async function getIncentiveMonth(year: number, month: number): Promise<IncentiveMonth> {
  const quarter = quarterOf(month);
  const qMonths = quarterMonths(quarter).filter((m) => m <= month);

  const [roles, incentiveRows, bonusRow, memberships, teamTargets] = await Promise.all([
    prisma.leadPulseRole.findMany({
      where: { role: "l2", active: true },
      select: { userId: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
    prisma.leadPulseIncentive.findMany({ where: { year, month: { in: qMonths } } }),
    prisma.leadPulseIncentiveMonth.findUnique({ where: { year_month: { year, month } } }),
    prisma.leadPulseTeamMember.findMany({
      where: { year, month: { in: qMonths } },
      select: { teamId: true, userId: true, month: true, team: { select: { name: true } } },
    }),
    prisma.leadPulseTeamTarget.findMany({
      where: { year, OR: [{ periodType: "month", period: month }, { periodType: "quarter", period: quarter }] },
      select: { teamId: true, periodType: true, target: true, pool: true },
    }),
  ]);

  // Facts for the roster and for anyone who was in a team this quarter (a
  // leaver's enrolments still count toward their team).
  const factUserIds = [...new Set([...roles.map((r) => r.userId), ...memberships.map((m) => m.userId)])];
  const factsByMonth = new Map<number, Map<string, BdeMonthFacts>>();
  await Promise.all(
    qMonths.map(async (m) => {
      factsByMonth.set(m, await getBdeMonthFacts(year, m, factUserIds));
    }),
  );
  const factsFor = (m: number, userId: string) => factsByMonth.get(m)?.get(userId) ?? ZERO_FACTS;
  const targets = await getMonthlyTargetByBde(year, month, roles.map((r) => r.userId));

  const incentiveFor = (m: number, userId: string) => incentiveRows.find((r) => r.month === m && r.userId === userId) ?? null;
  const minimumFor = (m: number, userId: string) => incentiveFor(m, userId)?.minimum ?? 0;
  const bonuses: MonthBonuses = bonusRow
    ? { targetBonus: bonusRow.targetBonus, fastCloseBonus: bonusRow.fastCloseBonus, referralBonus: bonusRow.referralBonus }
    : NO_BONUSES;

  // Names for team members who are no longer on the active L2 roster.
  const nameById = new Map(roles.map((r) => [r.userId, r.displayName]));
  const missing = factUserIds.filter((id) => !nameById.has(id));
  if (missing.length) {
    const [others, users] = await Promise.all([
      prisma.leadPulseRole.findMany({ where: { userId: { in: missing } }, select: { userId: true, displayName: true } }),
      prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, username: true } }),
    ]);
    for (const u of users) nameById.set(u.id, u.username);
    for (const o of others) nameById.set(o.userId, o.displayName);
  }

  // ── Teams ──
  const teamIds = [...new Set([...memberships.map((m) => m.teamId), ...teamTargets.map((t) => t.teamId)])];
  const teamRows = teamIds.length
    ? await prisma.leadPulseTeam.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } })
    : [];
  // A month before teams were first set up this quarter counts with the team as later set up.
  const quarterFacts: QuarterMonthFact[] = fillQuarterMemberships(memberships, qMonths).map((m) => ({
    month: m.month,
    teamId: m.teamId,
    userId: m.userId,
    enrolled: factsFor(m.month, m.userId).enrolled,
    minimum: minimumFor(m.month, m.userId),
  }));
  const teams: TeamStanding[] = teamRows
    .map((t) => {
      const monthMembers = memberships.filter((m) => m.teamId === t.id && m.month === month);
      const monthTarget = teamTargets.find((x) => x.teamId === t.id && x.periodType === "month");
      const quarterTarget = teamTargets.find((x) => x.teamId === t.id && x.periodType === "quarter");
      return {
        teamId: t.id,
        name: t.name,
        members: monthMembers.map((m) => ({ userId: m.userId, name: nameById.get(m.userId) ?? "Unknown user" })),
        month: monthTarget
          ? computeTeamPool({
              target: monthTarget.target,
              pool: monthTarget.pool,
              members: monthMembers.map((m) => ({
                userId: m.userId,
                enrolled: factsFor(month, m.userId).enrolled,
                minimum: minimumFor(month, m.userId),
              })),
            })
          : null,
        quarter: quarterTarget
          ? computeTeamPool({ target: quarterTarget.target, pool: quarterTarget.pool, members: quarterMembers(quarterFacts, t.id) })
          : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const forMember = (pool: TeamPool | null, userId: string): TeamPoolForMember | null => {
    if (!pool) return null;
    const { members, ...rest } = pool;
    return { ...rest, me: members.find((m) => m.userId === userId) ?? null };
  };

  // ── BDEs ──
  const bdes: BdeStanding[] = roles.map((r) => {
    const row = incentiveFor(month, r.userId);
    const slabs = row ? slabsFromRow(row) : [];
    const minimum = row?.minimum ?? null;
    const target = targets.get(r.userId) ?? 0;
    const facts = factsFor(month, r.userId);
    const input = { ...facts, target, slabs, bonuses };
    const membership = memberships.find((m) => m.userId === r.userId && m.month === month);
    const team = membership ? teams.find((t) => t.teamId === membership.teamId) : undefined;
    return {
      userId: r.userId,
      name: r.displayName,
      target,
      minimum,
      slabs,
      configured: row !== null,
      facts,
      pay: computeBdePay(input),
      milestones: milestones({ ...input, minimum }),
      team: team
        ? { teamId: team.teamId, name: team.name, month: forMember(team.month, r.userId), quarter: forMember(team.quarter, r.userId) }
        : null,
    };
  });

  return { year, month, quarter, quarterMonthsSoFar: qMonths, bonuses, bdes, teams };
}

/** One L2 BDE's standing for a month, or null when they are not an active L2. */
export async function getIncentiveStanding(userId: string, year: number, month: number): Promise<BdeStanding | null> {
  const all = await getIncentiveMonth(year, month);
  return all.bdes.find((b) => b.userId === userId) ?? null;
}
