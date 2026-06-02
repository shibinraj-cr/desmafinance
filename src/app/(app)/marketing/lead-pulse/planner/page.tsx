import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { getPlannerBaseline } from "@/lib/lead-pulse-metrics";
import { isAiEnabled } from "@/lib/anthropic";
import { todayIst } from "@/lib/lead-pulse-dates";
import { PlannerClient } from "./client";

export const dynamic = "force-dynamic";

export default async function GrowthPlannerPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
    return (
      <div className="px-[24px] py-[40px] max-w-2xl mx-auto">
        <div
          className="rounded-[12px] p-[24px] border"
          style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
        >
          <p style={{ color: "var(--lp-on-surface-variant)" }}>
            Only supervisors and admins can use the Growth Planner.
          </p>
        </div>
      </div>
    );
  }

  const today = todayIst();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const baseline = await getPlannerBaseline(year, month);

  return <PlannerClient baseline={baseline} aiEnabled={isAiEnabled()} />;
}
