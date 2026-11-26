import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TEAM_PERFORMANCE_PAGES, canViewTeamPerformancePage } from "@/lib/team-performance-rbac";

export const dynamic = "force-dynamic";

/** /performance → the first Team Performance page this user may open. */
export default async function PerformanceIndex() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  const first = TEAM_PERFORMANCE_PAGES.find((h) => canViewTeamPerformancePage(perms, h));
  redirect(first ?? "/performance/overview");
}
