import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { todayIst } from "@/lib/lead-pulse-dates";
import { getIncentiveMonth } from "@/lib/crm-incentive-data";
import { isIncentiveMonthClosed, slabInputs } from "@/lib/crm-incentive";
import { ClosedMonthNote, MonthForm, SheetTabs, SupervisorOnly, monthLabel, previousMonth, sheetMonth } from "../_sheet";
import { IncentiveSheet } from "./client";

export const dynamic = "force-dynamic";

/**
 * "Minimum & slabs" tab of the L2 target sheet: per L2 BDE per month a minimum
 * (expected, pays nothing) and up to four all-units slabs, plus the month's
 * bonuses. Supervisor-only. The engine is `crm-incentive.ts`; this page reads
 * the same standing the My Day card and the 9 AM brief will, so "so far" here
 * matches what BDEs are told.
 */
export default async function IncentiveSetupPage({
  searchParams,
}: {
  searchParams: { year?: string; month?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) return <SupervisorOnly />;

  const { year, month } = sheetMonth(searchParams);
  const prev = previousMonth(year, month);
  const [standing, prevRows, prevBonus] = await Promise.all([
    getIncentiveMonth(year, month),
    prisma.leadPulseIncentive.findMany({ where: { year: prev.year, month: prev.month } }),
    prisma.leadPulseIncentiveMonth.findUnique({ where: { year_month: prev } }),
  ]);
  const closed = isIncentiveMonthClosed(year, month, todayIst());
  const label = monthLabel(year, month);

  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight">L2 Targets &amp; Incentive</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            {label} · {standing.bdes.length} active L2 BDE{standing.bdes.length === 1 ? "" : "s"} · set every month
          </p>
        </div>
        <SheetTabs active="incentive" year={year} month={month} />
      </header>

      <MonthForm action="/marketing/lead-pulse/targets/incentive" year={year} month={month} />

      {closed && <ClosedMonthNote label={label} canEdit={access.desfinAdmin} />}

      {standing.bdes.length === 0 ? (
        <div
          className="rounded-[12px] p-[24px] border text-center"
          style={{
            backgroundColor: "var(--lp-surface-container)",
            borderColor: "var(--lp-outline-variant)",
            color: "var(--lp-on-surface-variant)",
          }}
        >
          No active L2 BDEs found. Add one via Team Roster.
        </div>
      ) : (
        <IncentiveSheet
          key={`${year}-${month}`}
          year={year}
          month={month}
          monthName={monthLabel(year, month).split(" ")[0]}
          prevName={monthLabel(prev.year, prev.month).split(" ")[0]}
          readOnly={closed && !access.desfinAdmin}
          bonuses={standing.bonuses}
          rows={standing.bdes.map((b) => ({
            userId: b.userId,
            name: b.name,
            team: b.team?.name ?? null,
            target: b.target,
            facts: b.facts,
            minimum: b.minimum,
            slabs: b.slabs,
          }))}
          prev={{
            bonuses: prevBonus
              ? { targetBonus: prevBonus.targetBonus, fastCloseBonus: prevBonus.fastCloseBonus, referralBonus: prevBonus.referralBonus }
              : null,
            rows: prevRows.map((r) => ({ userId: r.userId, minimum: r.minimum, slabs: slabInputs(r) })),
          }}
        />
      )}
    </div>
  );
}
