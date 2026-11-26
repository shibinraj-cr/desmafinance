import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { DateFilter } from "@/components/DateFilter";
import { EmptyNote, PerformanceNoAccess, tdCls, thCls } from "@/components/PerformanceUi";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canViewTeamPerformancePage, TP_UNANSWERED } from "@/lib/team-performance-rbac";
import { getUnanswered, resolveRange } from "@/lib/team-performance";
import { fromPrismaDate } from "@/lib/lead-pulse-dates";

export const dynamic = "force-dynamic";

export default async function UnansweredPage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!canViewTeamPerformancePage(perms, TP_UNANSWERED)) return <PerformanceNoAccess title="Unanswered Queries" />;

  const range = resolveRange(searchParams);
  const rows = await getUnanswered(range);
  const neverAnswered = rows.filter((r) => /no staff reply/i.test(r.status)).length;

  return (
    <>
      <TopBar title="Unanswered Queries" subtitle={`No staff reply by 9 AM · ${range.label}`} action={<DateFilter />} />
      <div className="p-margin space-y-lg">
        <Section title={`${rows.length} queries${neverAnswered ? ` · ${neverAnswered} never answered` : ""}`}>
          {rows.length === 0 ? (
            <EmptyNote>Every candidate query got a reply by 9 AM.</EmptyNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={thCls}>Report day</th>
                    <th className={thCls}>Group</th>
                    <th className={thCls}>Asked</th>
                    <th className={thCls}>Query</th>
                    <th className={thCls}>What happened</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className={tdCls}>{fromPrismaDate(r.date)}</td>
                      <td className={tdCls + " font-semibold"}>{r.groupName}</td>
                      <td className={tdCls}>{r.queryAt}</td>
                      <td className={tdCls + " whitespace-normal min-w-[240px]"}>{r.summary}</td>
                      <td className={tdCls + " whitespace-normal min-w-[220px] " + (/no staff reply/i.test(r.status) ? "text-error font-semibold" : "text-on-surface-variant")}>
                        {r.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
