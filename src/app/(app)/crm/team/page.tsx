import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { KpiCard, Section } from "@/components/Cards";
import { DateFilter } from "@/components/DateFilter";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { parsePeriod, rangeFor, periodLabel } from "@/lib/period";
import {
  resolveTeamScope,
  getTeamActivity,
  SLA_THRESHOLD_DAYS,
  ABANDONED_DAYS,
  STUCK_DAYS,
  type TeamLeadRef,
  type TeamBdeRow,
} from "@/lib/crm-team";

export const dynamic = "force-dynamic";

type SP = { [k: string]: string | string[] | undefined };

function str(sp: SP, k: string): string | undefined {
  const v = sp[k];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function pctText(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function fmtDays(days: number): string {
  return `${Math.floor(days)}d`;
}

function fmtHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return "<1h";
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

function StatusPill({ label, color }: { label: string; color: string | null }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-xs py-[1px] text-[11px] font-semibold"
      style={{
        backgroundColor: color ? `${color}1a` : "rgba(0,0,0,0.05)",
        color: color ?? "inherit",
      }}
    >
      {label}
    </span>
  );
}

/** A compact "needs attention" list with lead links and ages. */
function AttentionList({
  title,
  hint,
  rows,
  total,
  ageLabel,
  showAssignee,
  tone = "danger",
}: {
  title: string;
  hint: string;
  rows: TeamLeadRef[];
  total: number;
  ageLabel: string;
  showAssignee: boolean;
  tone?: "danger" | "warning";
}) {
  const dot = tone === "danger" ? "bg-error" : "bg-amber-500";
  return (
    <Section
      title={title}
      className="lg:col-span-6"
      action={<span className="text-label-sm font-semibold text-on-surface-variant">{total}</span>}
    >
      <p className="-mt-md mb-md text-caption text-on-surface-variant">{hint}</p>
      {rows.length === 0 ? (
        <p className="py-md text-center text-on-surface-variant text-label-sm">Nothing here — all clear.</p>
      ) : (
        <ul className="divide-y divide-outline-variant">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-sm py-xs">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
              <Link
                href={`/crm/leads/${r.id}`}
                className="min-w-0 flex-1 truncate text-label-sm text-on-surface hover:underline"
              >
                {r.name}
              </Link>
              <StatusPill label={r.statusLabel} color={r.statusColor} />
              {showAssignee && (
                <span className="w-28 shrink-0 truncate text-caption text-on-surface-variant">
                  {r.assigneeName ?? "Unassigned"}
                </span>
              )}
              <span className="w-10 shrink-0 text-right text-label-sm font-semibold tabular-nums text-on-surface-variant">
                {fmtDays(r.ageDays)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {total > rows.length && (
        <p className="mt-md text-caption text-on-surface-variant">
          Showing the {rows.length} most stale of {total}. Open a lead to act. ({ageLabel})
        </p>
      )}
    </Section>
  );
}

function num(n: number): string {
  return String(n);
}

export default async function TeamActivityPage({ searchParams }: { searchParams: SP }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) {
    return (
      <>
        <TopBar title="Team Activity" subtitle="CRM" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            You don&apos;t have access to the CRM. Ask an administrator to grant you the CRM pages.
          </div>
        </div>
      </>
    );
  }

  const scope = resolveTeamScope(access);
  const period = parsePeriod({
    period: str(searchParams, "period"),
    from: str(searchParams, "from"),
    to: str(searchParams, "to"),
  });
  const range = rangeFor(period);
  const now = new Date();

  const data = await getTeamActivity({ scope, range, now });
  const t = data.totals;
  const rangeText = periodLabel(period);

  // BDE table sorted worst-first by total attention pressure, then by name.
  const pressure = (r: TeamBdeRow) => r.slaBreaches + r.abandoned + r.stuck + r.noTask + r.firstResponseBreached;
  const rows = [...data.bdeRows].sort((a, b) => pressure(b) - pressure(a) || a.displayName.localeCompare(b.displayName));

  return (
    <>
      <TopBar
        title="Team Activity"
        subtitle={scope.teamWide ? "Team-wide CRM activity & follow-up health" : "My CRM activity & follow-up health"}
      />
      <div className="p-margin space-y-lg">
        <div className="flex flex-wrap items-center justify-between gap-base">
          <p className="text-label-sm text-on-surface-variant">
            Activity for <span className="font-semibold text-on-surface">{rangeText}</span>. Attention buckets are live
            (now).
          </p>
          <DateFilter />
        </div>

        {/* Daily pulse */}
        <section className="grid grid-cols-2 gap-gutter md:grid-cols-3 lg:grid-cols-5">
          <KpiCard
            label="New leads today"
            value={num(t.newLeadsToday)}
            hint="Last 14 days trend"
            tone="primary"
            sparkline={data.newLeadTrend}
          />
          <KpiCard label="New leads" value={num(t.newLeadsRange)} hint={rangeText} />
          <KpiCard label="Leads assigned" value={num(t.assignedRange)} hint={rangeText} />
          <KpiCard label="Contacts logged" value={num(t.contacts)} hint={`Calls + email + WhatsApp · ${rangeText}`} />
          <KpiCard
            label="Tasks completed"
            value={num(t.tasksCompleted)}
            hint={`${pctText(t.tasksOnTime, t.tasksCompleted)} on time · ${rangeText}`}
            tone="success"
          />
        </section>

        {/* Attention strip */}
        <section className="grid grid-cols-2 gap-gutter md:grid-cols-3 lg:grid-cols-6">
          <KpiCard
            label="SLA breaches"
            value={num(t.slaBreaches)}
            hint="Untouched past stage SLA"
            tone={t.slaBreaches > 0 ? "danger" : "default"}
          />
          <KpiCard
            label="Abandoned"
            value={num(t.abandoned)}
            hint={`Untouched > ${ABANDONED_DAYS}d`}
            tone={t.abandoned > 0 ? "danger" : "default"}
          />
          <KpiCard
            label="No next step"
            value={num(t.noTask)}
            hint="Active leads, no open task"
            tone={t.noTask > 0 ? "primary" : "default"}
          />
          <KpiCard
            label="Stuck"
            value={num(t.stuck)}
            hint={`Same status > ${STUCK_DAYS}d`}
            tone={t.stuck > 0 ? "primary" : "default"}
          />
          <KpiCard
            label="First-response gaps"
            value={num(t.firstResponseBreached)}
            hint={`${t.firstResponsePending} not yet contacted`}
            tone={t.firstResponseBreached > 0 ? "danger" : "default"}
          />
          <KpiCard
            label="Re-inquiry follow-ups"
            value={num(t.openReinquiry)}
            hint="Open re-inquiry tasks"
            tone={t.openReinquiry > 0 ? "primary" : "default"}
          />
        </section>

        {scope.teamWide && t.unassignedActive > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-lg py-md text-label-sm text-amber-900">
            <Link href="/crm/leads?assignee=unassigned" className="font-semibold underline">
              {t.unassignedActive} active lead{t.unassignedActive === 1 ? "" : "s"} unassigned
            </Link>{" "}
            — no consultant owns them yet.
          </div>
        )}

        {/* BDE performance table */}
        <Section
          title={scope.teamWide ? "Consultant performance" : "My numbers"}
          action={<span className="text-caption text-on-surface-variant">Conversion = this month · activity = {rangeText}</span>}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-label-sm">
              <thead>
                <tr className="border-b border-outline-variant text-left text-caption uppercase tracking-wider text-on-surface-variant">
                  <th className="py-sm pr-sm font-semibold">Consultant</th>
                  <th className="px-sm py-sm text-right font-semibold">Assigned (mo)</th>
                  <th className="px-sm py-sm text-right font-semibold">Enrolled</th>
                  <th className="px-sm py-sm text-right font-semibold">Conv.</th>
                  <th className="px-sm py-sm text-right font-semibold">Contacts</th>
                  <th className="px-sm py-sm text-right font-semibold">Tasks ✓</th>
                  <th className="px-sm py-sm text-right font-semibold">1st resp.</th>
                  <th className="px-sm py-sm text-right font-semibold">SLA</th>
                  <th className="px-sm py-sm text-right font-semibold">Abandon</th>
                  <th className="px-sm py-sm text-right font-semibold">No task</th>
                  <th className="px-sm py-sm text-right font-semibold">Stuck</th>
                  <th className="pl-sm py-sm text-right font-semibold">Re-inq.</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-lg text-center text-on-surface-variant">
                      No active consultants.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.userId} className="border-b border-outline-variant/60 hover:bg-surface-container-low">
                      <td className="py-sm pr-sm">
                        <Link href={`/crm/leads?assignee=${r.userId}`} className="font-medium text-on-surface hover:underline">
                          {r.displayName}
                        </Link>
                        <span className="ml-xs text-caption uppercase text-on-surface-variant">{r.role}</span>
                      </td>
                      <td className="px-sm py-sm text-right tabular-nums">{r.assignedMonth}</td>
                      <td className="px-sm py-sm text-right tabular-nums">{r.enrolledMonth}</td>
                      <td className="px-sm py-sm text-right tabular-nums">
                        {r.conversionPct === null ? "—" : `${r.conversionPct}%`}
                      </td>
                      <td className="px-sm py-sm text-right tabular-nums" title={`${r.calls} calls · ${r.emails} emails · ${r.whatsapp} WhatsApp`}>
                        {r.contacts}
                      </td>
                      <td className="px-sm py-sm text-right tabular-nums">
                        {r.tasksCompleted}
                        <span className="ml-xs text-caption text-on-surface-variant">
                          {pctText(r.tasksOnTime, r.tasksCompleted)}
                        </span>
                      </td>
                      <td className="px-sm py-sm text-right tabular-nums" title={`${r.firstResponsePending} not yet contacted`}>
                        {fmtHours(r.firstResponseMedianHours)}
                      </td>
                      <td className={`px-sm py-sm text-right tabular-nums ${r.slaBreaches > 0 ? "font-semibold text-error" : ""}`}>
                        {r.slaBreaches}
                      </td>
                      <td className={`px-sm py-sm text-right tabular-nums ${r.abandoned > 0 ? "font-semibold text-error" : ""}`}>
                        {r.abandoned}
                      </td>
                      <td className="px-sm py-sm text-right tabular-nums">{r.noTask}</td>
                      <td className="px-sm py-sm text-right tabular-nums">{r.stuck}</td>
                      <td className="pl-sm py-sm text-right tabular-nums">{r.openReinquiry}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Attention lists */}
        <section className="grid grid-cols-1 gap-gutter lg:grid-cols-12">
          <AttentionList
            title="SLA breaches"
            hint={`Active leads untouched past their stage SLA (${Object.entries(SLA_THRESHOLD_DAYS)
              .map(([, d]) => d)
              .filter((d, i, a) => a.indexOf(d) === i)
              .sort((a, b) => a - b)
              .join("/")}d by stage).`}
            rows={data.attention.slaBreaches}
            total={t.slaBreaches}
            ageLabel="days since last touch"
            showAssignee={scope.teamWide}
            tone="danger"
          />
          <AttentionList
            title="Abandoned leads"
            hint={`Active leads with no touch in over ${ABANDONED_DAYS} days.`}
            rows={data.attention.abandoned}
            total={t.abandoned}
            ageLabel="days since last touch"
            showAssignee={scope.teamWide}
            tone="danger"
          />
          <AttentionList
            title="No next step"
            hint="Active leads with no open task — nothing scheduled to move them forward."
            rows={data.attention.noTask}
            total={t.noTask}
            ageLabel="days since last touch"
            showAssignee={scope.teamWide}
            tone="warning"
          />
          <AttentionList
            title="Stuck in stage"
            hint={`Active leads in the same status for over ${STUCK_DAYS} days.`}
            rows={data.attention.stuck}
            total={t.stuck}
            ageLabel="days in current status"
            showAssignee={scope.teamWide}
            tone="warning"
          />
        </section>
      </div>
    </>
  );
}
