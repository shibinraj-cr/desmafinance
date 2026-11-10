import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { todayIst } from "@/lib/lead-pulse-dates";
import { getIncentiveMonth } from "@/lib/crm-incentive-data";
import { isIncentiveMonthClosed, quarterMonths, quarterOf } from "@/lib/crm-incentive";
import { ClosedMonthNote, MonthForm, SheetTabs, SupervisorOnly, monthLabel, previousMonth, sheetMonth } from "../_sheet";
import { TeamsSheet, type Person, type TargetPair } from "./client";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Teams" tab of the L2 target sheet: teams, each month's members, and each
 * team's monthly and quarterly target + pool. Supervisor-only. Everyone's
 * enrolments count toward the team target; the pool is shared among members
 * who reached their own minimum (see `crm-incentive.ts`).
 */
export default async function TeamsSetupPage({
  searchParams,
}: {
  searchParams: { year?: string; month?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) return <SupervisorOnly />;

  const { year, month } = sheetMonth(searchParams);
  const quarter = quarterOf(month);
  const prev = previousMonth(year, month);
  const [standing, teams, memberships, prevMemberships, targets, prevTargets] = await Promise.all([
    getIncentiveMonth(year, month),
    prisma.leadPulseTeam.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, active: true } }),
    prisma.leadPulseTeamMember.findMany({ where: { year, month }, select: { teamId: true, userId: true } }),
    prisma.leadPulseTeamMember.findMany({ where: prev, select: { teamId: true, userId: true } }),
    prisma.leadPulseTeamTarget.findMany({
      where: { year, OR: [{ periodType: "month", period: month }, { periodType: "quarter", period: quarter }] },
      select: { teamId: true, periodType: true, target: true, pool: true },
    }),
    prisma.leadPulseTeamTarget.findMany({
      where: { year: prev.year, periodType: "month", period: prev.month },
      select: { teamId: true, target: true, pool: true },
    }),
  ]);

  // Everyone the editor can show: the active L2 roster, plus anyone already in
  // a team this month who has since left (they stay, their enrolments count).
  const people: Record<string, Person> = {};
  for (const b of standing.bdes) {
    people[b.userId] = { name: b.name, active: true, enrolled: b.facts.enrolled, minimum: b.minimum };
  }
  for (const t of standing.teams) {
    for (const m of t.members) {
      if (people[m.userId]) continue;
      const share = t.month?.members.find((x) => x.userId === m.userId);
      people[m.userId] = { name: m.name, active: false, enrolled: share?.enrolled ?? 0, minimum: share?.minimum ?? null };
    }
  }

  const group = (rows: Array<{ teamId: string; userId: string }>) => {
    const out: Record<string, string[]> = {};
    for (const r of rows) (out[r.teamId] ??= []).push(r.userId);
    for (const ids of Object.values(out)) ids.sort((a, b) => (people[a]?.name ?? "").localeCompare(people[b]?.name ?? ""));
    return out;
  };

  const pairs: Record<string, { month: TargetPair | null; quarter: TargetPair | null }> = {};
  for (const t of targets) {
    const cur = (pairs[t.teamId] ??= { month: null, quarter: null });
    cur[t.periodType === "quarter" ? "quarter" : "month"] = { target: t.target, pool: t.pool };
  }

  const progress: Record<string, { month: number | null; quarter: number | null }> = {};
  for (const t of standing.teams) {
    progress[t.teamId] = { month: t.month?.teamTotal ?? null, quarter: t.quarter?.teamTotal ?? null };
  }

  const closed = isIncentiveMonthClosed(year, month, todayIst());
  const label = monthLabel(year, month);
  const qm = quarterMonths(quarter);
  const quarterLabel = `${MONTHS[qm[0] - 1]}–${MONTHS[qm[2] - 1]}`;
  const activeTeams = teams.filter((t) => t.active).length;

  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight">L2 Targets &amp; Incentive</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            {label} · {activeTeams} team{activeTeams === 1 ? "" : "s"} · quarter {quarterLabel}
          </p>
        </div>
        <SheetTabs active="teams" year={year} month={month} />
      </header>

      <MonthForm action="/marketing/lead-pulse/targets/teams" year={year} month={month} />

      {closed && <ClosedMonthNote label={label} canEdit={access.desfinAdmin} />}

      <TeamsSheet
        key={`${year}-${month}`}
        year={year}
        month={month}
        monthName={label.split(" ")[0]}
        prevName={monthLabel(prev.year, prev.month).split(" ")[0]}
        quarterLabel={quarterLabel}
        readOnly={closed && !access.desfinAdmin}
        teams={teams}
        people={people}
        members={group(memberships)}
        targets={pairs}
        progress={progress}
        prev={{
          members: group(prevMemberships),
          targets: Object.fromEntries(prevTargets.map((t) => [t.teamId, { target: t.target, pool: t.pool }])),
        }}
      />
    </div>
  );
}
