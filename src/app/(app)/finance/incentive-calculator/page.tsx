import { redirect } from "next/navigation";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { currentPeriodLabel, serializePlan, type IncentivePlanData } from "@/lib/incentive";
import { IncentiveCalculator } from "./client";

export const dynamic = "force-dynamic";

const PAGE = "/finance/incentive-calculator";

export default async function IncentiveCalculatorPage() {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, PAGE)) redirect("/finance/overview");

  const period = currentPeriodLabel(new Date());

  const [plan, periodRows] = await Promise.all([
    prisma.incentivePlan.findUnique({
      where: { period },
      include: { bdes: { orderBy: { sortIndex: "asc" } } },
    }),
    prisma.incentivePlan.findMany({
      select: { period: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const initialPlan: IncentivePlanData | null = plan ? serializePlan(plan) : null;
  const periods = periodRows.map((r) => r.period);

  return (
    <IncentiveCalculator
      initialPeriod={period}
      initialPlan={initialPlan}
      initialPeriods={periods}
    />
  );
}
