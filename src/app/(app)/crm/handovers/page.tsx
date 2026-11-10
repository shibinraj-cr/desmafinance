import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getAssignableBdes } from "@/lib/crm-leads";
import { listParam } from "@/lib/filter-params";
import { todayIst } from "@/lib/lead-pulse-dates";
import { resolveReportDay } from "@/lib/crm-daily-report";
import { handoverListWhere } from "@/lib/crm-handover";
import { getHandoverAccess, listHandovers } from "@/lib/crm-handover-data";
import { HandoverTable } from "@/components/crm/LeadReportActions";
import { HandoverFilters, HandoverForms } from "./client";

export const dynamic = "force-dynamic";

type SP = { [k: string]: string | string[] | undefined };

/**
 * Lead Handovers — the Marketing Admin logs leads given to a BDE outside
 * DesGro (one at a time or as a pasted list) and follows them up; a BDE sees
 * their own. Default view: handovers given on the day plus any still open.
 */
export default async function HandoversPage({ searchParams }: { searchParams: SP }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getHandoverAccess(userId, perms);
  if (!access.viewScope) redirect("/crm/my-day");

  const date = resolveReportDay(typeof searchParams.date === "string" ? searchParams.date : undefined);
  const withOpen = searchParams.open !== "0";
  const filters = {
    date,
    withOpen,
    statuses: listParam(searchParams.status),
    channels: listParam(searchParams.channel),
    bdeIds: listParam(searchParams.bde),
  };
  const [rows, bdes] = await Promise.all([
    listHandovers(handoverListWhere(access, userId, filters)!),
    getAssignableBdes(),
  ]);

  return (
    <>
      <TopBar title="Lead Handovers" subtitle="Leads given to a BDE outside DesGro — created in the CRM by the cutoff" />
      <div className="p-margin space-y-lg">
        {access.canManage && <HandoverForms bdes={bdes.map((b) => ({ userId: b.userId, displayName: b.displayName }))} />}
        <Section title={`Handovers (${rows.length})`}>
          <HandoverFilters
            today={todayIst()}
            date={date}
            withOpen={withOpen}
            statuses={filters.statuses}
            channel={filters.channels[0] ?? ""}
            bde={filters.bdeIds[0] ?? ""}
            bdes={access.viewScope === "all" ? bdes.map((b) => ({ userId: b.userId, displayName: b.displayName })) : []}
          />
          <div className="mt-md">
            <HandoverTable rows={rows} viewerId={userId} canManage={access.canManage} readOnly={false} showBde={access.viewScope === "all"} />
          </div>
        </Section>
      </div>
    </>
  );
}
