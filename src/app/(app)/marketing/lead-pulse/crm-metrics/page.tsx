import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import {
  getServiceConversionMatrix,
  getFunnelTotals,
  monthBounds,
  pct,
} from "@/lib/lead-pulse-metrics";
import { getCrmFunnelByBde, getCrmServiceMatrix, getMetricsSource } from "@/lib/lead-pulse-crm-metrics";
import { todayIst } from "@/lib/lead-pulse-dates";
import { CrmMetricsCompare } from "./client";

export const dynamic = "force-dynamic";

/**
 * CRM-sourced metrics, shown side-by-side with the daily-entry numbers so the
 * team can validate before the dashboards are flipped to the CRM source.
 * Supervisor-only. Phase 1 of the daily-entry → CRM cutover.
 */
export default async function CrmMetricsPage({
  searchParams,
}: {
  searchParams: { year?: string; month?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
    return (
      <div className="px-[24px] py-[40px] max-w-2xl mx-auto">
        <div className="rounded-[12px] p-[24px] border" style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}>
          <p style={{ color: "var(--lp-on-surface-variant)" }}>Only supervisors and admins can view the CRM metrics comparison.</p>
        </div>
      </div>
    );
  }

  const today = todayIst();
  const year = searchParams.year ? Number(searchParams.year) : Number(today.slice(0, 4));
  const month = searchParams.month ? Number(searchParams.month) : Number(today.slice(5, 7));
  const { start, end } = monthBounds(year, month);

  const [crmFunnel, crmMatrix, dailyMatrix] = await Promise.all([
    getCrmFunnelByBde(year, month),
    getCrmServiceMatrix(year, month),
    getServiceConversionMatrix(year, month),
  ]);
  const source = await getMetricsSource();

  // Daily-entry per-BDE leads/won (pick the role-appropriate side of the funnel).
  const dailyFunnels = await Promise.all(
    crmFunnel.map(async (b) => {
      const f = await getFunnelTotals({ start, end, userId: b.userId });
      const leads = b.role === "l2" ? f.l2Leads : f.l1Leads;
      const won = b.role === "l2" ? f.l2Won : f.l1Won;
      return { userId: b.userId, leads, won, conversionPct: pct(won, leads) };
    }),
  );
  const dailyByUser = new Map(dailyFunnels.map((d) => [d.userId, d]));

  const funnelRows = crmFunnel.map((b) => {
    const d = dailyByUser.get(b.userId);
    return {
      displayName: b.displayName,
      role: b.role,
      dailyLeads: d?.leads ?? 0,
      dailyWon: d?.won ?? 0,
      dailyConv: d?.conversionPct ?? null,
      crmLeads: b.leadsAssigned,
      crmWon: b.enrolled,
      crmConv: b.conversionPct,
      crmLost: b.lost,
    };
  });

  // Merge the two matrices into per-cell { target, dailyActual, crmActual }.
  const matrixRows = crmMatrix.bdes.map((bde) => ({
    displayName: bde.displayName,
    cells: crmMatrix.services.map((g) => {
      const key = `${bde.userId}|${g.id}`;
      const crmCell = crmMatrix.cells.get(key);
      const dailyCell = dailyMatrix.cells.get(key);
      return {
        groupName: g.name,
        target: crmCell?.target ?? dailyCell?.target ?? 0,
        dailyActual: dailyCell?.actual ?? 0,
        crmActual: crmCell?.actual ?? 0,
      };
    }),
  }));

  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <CrmMetricsCompare
      year={year}
      month={month}
      monthLabel={monthLabel}
      source={source}
      funnelRows={funnelRows}
      services={crmMatrix.services}
      matrixRows={matrixRows}
    />
  );
}
