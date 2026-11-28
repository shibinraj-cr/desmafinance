import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { DateFilter } from "@/components/DateFilter";
import { ScoreMeter } from "@/components/PerformanceCharts";
import { EmptyNote, PerformanceNoAccess, numCls, tdCls, thCls } from "@/components/PerformanceUi";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canViewTeamPerformancePage, TP_SUPPORT } from "@/lib/team-performance-rbac";
import { getDailyRows, getStaffSummary, resolveRange } from "@/lib/team-performance";
import { fromPrismaDate } from "@/lib/lead-pulse-dates";

export const dynamic = "force-dynamic";

const f1 = (x: number | null) => (x == null ? "–" : x.toFixed(1));

export default async function CandidateSupportPage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!canViewTeamPerformancePage(perms, TP_SUPPORT)) return <PerformanceNoAccess title="Candidate Support" />;

  const range = resolveRange(searchParams);
  const [summary, daily] = await Promise.all([getStaffSummary(range), getDailyRows(range)]);

  return (
    <>
      <TopBar title="Candidate Support" subtitle={`After-hours WhatsApp · ${range.label}`} action={<DateFilter />} />
      <div className="p-margin space-y-lg">
        <Section title="Scorecard">
          {summary.rows.length === 0 ? (
            <EmptyNote>No WhatsApp scores for this period yet.</EmptyNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={thCls}>Staff</th>
                    <th className={thCls + numCls}>First replies</th>
                    <th className={thCls + numCls}>Share</th>
                    <th className={thCls + numCls}>Typical reply</th>
                    <th className={thCls}>Quality /10</th>
                    <th className={thCls + numCls}>Accuracy</th>
                    <th className={thCls + numCls}>Complete</th>
                    <th className={thCls + numCls}>Tone</th>
                    <th className={thCls + numCls}>Next step</th>
                    <th className={thCls + numCls}>Promises kept</th>
                    <th className={thCls + numCls}>Sun/holiday</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((r) => (
                    <tr key={r.staff}>
                      <td className={tdCls + " font-semibold"}>{r.staff}</td>
                      <td className={tdCls + numCls}>{r.queries}</td>
                      <td className={tdCls + numCls}>{r.sharePct}%</td>
                      <td className={tdCls + numCls}>
                        <span className={r.typicalReplyMin != null && r.typicalReplyMin > 60 ? "px-base py-[2px] rounded bg-error-container text-on-error-container" : ""}>
                          {r.typicalReplyMin == null ? "–" : `~${Math.round(r.typicalReplyMin)} min`}
                        </span>
                      </td>
                      <td className={tdCls}><ScoreMeter value={r.quality} /></td>
                      <td className={tdCls + numCls}>{f1(r.accuracy)}</td>
                      <td className={tdCls + numCls}>{f1(r.completeness)}</td>
                      <td className={tdCls + numCls}>{f1(r.tone)}</td>
                      <td className={tdCls + numCls}>{f1(r.nextStep)}</td>
                      <td className={tdCls + numCls}>
                        {r.keptPct == null ? "–" : `${r.keptPct}%`}
                        <span className="text-caption text-on-surface-variant"> ({r.closuresDone}/{r.closuresNeeded})</span>
                      </td>
                      <td className={tdCls + numCls}>{r.offDaysActive} / {r.offDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-caption text-on-surface-variant mt-md">
            Quality is scored on written replies; voice notes count as answered but are not scored yet.
          </p>
        </Section>

        <Section title="Daily log">
          {daily.length === 0 ? (
            <EmptyNote>No rows.</EmptyNote>
          ) : (
            <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-surface-container-lowest">
                  <tr>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Staff</th>
                    <th className={thCls + numCls}>Answered</th>
                    <th className={thCls + numCls}>Median min</th>
                    <th className={thCls + numCls}>Acc</th>
                    <th className={thCls + numCls}>Comp</th>
                    <th className={thCls + numCls}>Tone</th>
                    <th className={thCls + numCls}>Next</th>
                    <th className={thCls + numCls}>Closures</th>
                    <th className={thCls}>Source</th>
                    <th className={thCls}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {daily
                    .filter((r) => r.queriesAnswered > 0 || r.notes)
                    .map((r) => (
                      <tr key={r.id}>
                        <td className={tdCls}>{fromPrismaDate(r.date)}</td>
                        <td className={tdCls + " font-semibold"}>{r.staff}</td>
                        <td className={tdCls + numCls}>{r.queriesAnswered}</td>
                        <td className={tdCls + numCls}>{f1(r.medianResponseMin)}</td>
                        <td className={tdCls + numCls}>{f1(r.avgAccuracy)}</td>
                        <td className={tdCls + numCls}>{f1(r.avgCompleteness)}</td>
                        <td className={tdCls + numCls}>{f1(r.avgTone)}</td>
                        <td className={tdCls + numCls}>{f1(r.avgNextStep)}</td>
                        <td className={tdCls + numCls}>{r.closuresDone}/{r.closuresNeeded}</td>
                        <td className={tdCls}>{r.source}</td>
                        <td className={tdCls + " whitespace-normal min-w-[280px] text-caption"}>{r.notes}</td>
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
