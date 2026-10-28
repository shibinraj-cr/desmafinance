import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage, CRM_LEAD_QUALITY_PAGE } from "@/lib/rbac";
import { listParam } from "@/lib/filter-params";
import { todayIst } from "@/lib/lead-pulse-dates";
import { resolvePeriod } from "@/lib/sales-analysis";
import { loadCrmLeadQualityReport } from "@/lib/crm-lead-quality-report-data";
import { CrmLeadQualityView } from "./client";

export const dynamic = "force-dynamic";

type SP = { [k: string]: string | string[] | undefined };

export default async function CrmLeadQualityPage({ searchParams }: { searchParams: SP }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  // Admins and the Marketing Admin (by role name); anyone else needs the page granted.
  if (!canSeePage(perms, CRM_LEAD_QUALITY_PAGE)) {
    return (
      <>
        <TopBar title="Lead Quality" subtitle="CRM" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              This report is for Admins and the Marketing Admin. Ask an administrator if you need access.
            </div>
          </Section>
        </div>
      </>
    );
  }

  const one = (k: string) => {
    const v = searchParams[k];
    return Array.isArray(v) ? v[0] : v;
  };
  // This month unless the URL says otherwise — the working view is "how is it going now".
  const range = resolvePeriod(one("period") ?? "mtd", todayIst(), { from: one("from"), to: one("to") });
  const filters = {
    source: listParam(searchParams.source),
    campaign: listParam(searchParams.campaign),
    service: listParam(searchParams.service),
    bde: listParam(searchParams.bde),
  };
  const report = await loadCrmLeadQualityReport({ range, filters });

  return (
    <>
      <TopBar title="Lead Quality" subtitle="Campaign quality, reasons and rating discipline · CRM" />
      <CrmLeadQualityView report={report} range={range} filters={filters} />
    </>
  );
}
