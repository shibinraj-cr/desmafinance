import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { getAssignableBdes } from "@/lib/crm-leads";
import {
  resolveTeamScope,
  getAttentionQueue,
  getOverdueTaskQueue,
  getReinquiryQueue,
  getFirstResponseGapQueue,
  startOfLocalDay,
  SLA_THRESHOLD_DAYS,
  ABANDONED_DAYS,
  STUCK_DAYS,
  FIRST_RESPONSE_SLA_HOURS,
  type AttentionIssue,
  type AttentionQueueRow,
  type QueueRow,
} from "@/lib/crm-team";
import { QueueFilters } from "./filters";
import { QueueAssignCell } from "./assign-cell";

export const dynamic = "force-dynamic";

type SP = { [k: string]: string | string[] | undefined };

function str(sp: SP, k: string): string | undefined {
  const v = sp[k];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDays(days: number): string {
  return `${Math.floor(days)}d`;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const ISSUE_VALUES: AttentionIssue[] = ["sla", "no-task", "stuck", "abandoned"];
/** The three drill-downs that aren't Lead-attention-flag buckets — see crm-team.ts's QueueRow producers. */
const TASK_ISSUE_VALUES = ["overdue-task", "reinquiry", "first-response"] as const;
type TaskIssue = (typeof TASK_ISSUE_VALUES)[number];
type PageIssue = AttentionIssue | TaskIssue;

function parseIssue(v: string | undefined): PageIssue | null {
  if (v && (ISSUE_VALUES as string[]).includes(v)) return v as AttentionIssue;
  if (v && (TASK_ISSUE_VALUES as readonly string[]).includes(v)) return v as TaskIssue;
  return null;
}

function isTaskIssue(issue: PageIssue | null): issue is TaskIssue {
  return issue !== null && (TASK_ISSUE_VALUES as readonly string[]).includes(issue);
}

function rowHasIssue(r: AttentionQueueRow, issue: AttentionIssue): boolean {
  switch (issue) {
    case "sla":
      return r.slaBreached;
    case "no-task":
      return r.noNextStep;
    case "stuck":
      return r.stuck;
    case "abandoned":
      return r.abandoned;
  }
}

function StatusPill({ label, color }: { label: string; color: string | null }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-xs py-[1px] text-[11px] font-semibold"
      style={{ backgroundColor: color ? `${color}1a` : "rgba(0,0,0,0.05)", color: color ?? "inherit" }}
    >
      {label}
    </span>
  );
}

function IssueBadge({ label, tone }: { label: string; tone: "danger" | "warning" | "info" }) {
  const cls =
    tone === "danger"
      ? "bg-error/10 text-error"
      : tone === "warning"
        ? "bg-amber-500/10 text-amber-700"
        : "bg-primary/10 text-primary";
  return (
    <span className={`inline-flex items-center rounded px-[6px] py-[1px] text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

/** Summary chip: count for one bucket, linking to that issue filter. */
function CountChip({ label, value, href, active, tone }: { label: string; value: number; href: string; active: boolean; tone: "danger" | "warning" | "info" | "neutral" }) {
  const toneRing =
    tone === "danger"
      ? "text-error"
      : tone === "warning"
        ? "text-amber-700"
        : tone === "info"
          ? "text-primary"
          : "text-on-surface";
  return (
    <Link
      href={href}
      className={
        "flex min-w-[120px] flex-col rounded-xl border px-lg py-md transition " +
        (active
          ? "border-primary bg-primary/5"
          : "border-outline-variant bg-surface-container-lowest hover:border-primary/50")
      }
    >
      <span className={`text-h2 font-bold tabular-nums ${toneRing}`}>{value}</span>
      <span className="text-caption text-on-surface-variant">{label}</span>
    </Link>
  );
}

export default async function AttentionQueuePage({ searchParams }: { searchParams: SP }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) {
    return (
      <>
        <TopBar title="Follow-up queue" subtitle="CRM" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            You don&apos;t have access to the CRM. Ask an administrator to grant you the CRM pages.
          </div>
        </div>
      </>
    );
  }

  const scope = resolveTeamScope(access);
  const showConsultant = scope.canViewWholeTeam;

  // Consultant roster for the dropdowns (narrowed to self for a plain BDE) — also the reassign target list.
  const roster = (await getAssignableBdes()).filter((b) => !scope.restrictToUserId || b.userId === scope.restrictToUserId);
  const rosterIds = new Set(roster.map((b) => b.userId));
  const bdeOptions = roster.map((b) => ({ userId: b.userId, displayName: b.displayName }));

  const requestedConsultant = str(searchParams, "consultant");
  const consultantId = requestedConsultant && rosterIds.has(requestedConsultant) ? requestedConsultant : null;
  const issue = parseIssue(str(searchParams, "issue"));

  const now = new Date();
  const [{ rows: allRows, counts }, overdueTaskRows, reinquiryRows, firstResponseRows] = await Promise.all([
    getAttentionQueue({ scope, consultantId, now }),
    getOverdueTaskQueue({ scope, consultantId, now }),
    getReinquiryQueue({ scope, consultantId, now }),
    getFirstResponseGapQueue({ scope, consultantId, now }),
  ]);
  const rows = issue && !isTaskIssue(issue) ? allRows.filter((r) => rowHasIssue(r, issue)) : allRows;
  const taskRowsByIssue: Record<TaskIssue, QueueRow[]> = {
    "overdue-task": overdueTaskRows,
    reinquiry: reinquiryRows,
    "first-response": firstResponseRows,
  };
  const activeTaskRows = isTaskIssue(issue) ? taskRowsByIssue[issue] : [];

  const consultantName = consultantId ? roster.find((b) => b.userId === consultantId)?.displayName ?? null : null;
  const todayStart = startOfLocalDay(now).getTime();

  // Build a queue href preserving the consultant filter but setting the issue.
  const issueHref = (v: PageIssue | null) => {
    const params = new URLSearchParams();
    if (consultantId) params.set("consultant", consultantId);
    if (v) params.set("issue", v);
    const qs = params.toString();
    return qs ? `/crm/team/queue?${qs}` : "/crm/team/queue";
  };

  const subtitle = showConsultant
    ? consultantName
      ? `${consultantName} · leads needing attention`
      : "Whole team · leads needing attention"
    : "My leads needing attention";

  return (
    <>
      <TopBar title="Follow-up queue" subtitle={subtitle} />
      <div className="p-margin space-y-lg">
        <div className="flex flex-wrap items-center justify-between gap-base">
          <QueueFilters consultants={roster} showConsultant={showConsultant} />
          <Link href="/crm/team" className="text-label-sm font-semibold text-primary hover:underline">
            ← Back to Activity
          </Link>
        </div>

        {/* Bucket summary — click a chip to filter to that issue. */}
        <div className="flex flex-wrap gap-gutter">
          <CountChip label="Total flagged" value={counts.total} href={issueHref(null)} active={issue === null} tone="neutral" />
          <CountChip label="SLA breaches" value={counts.sla} href={issueHref("sla")} active={issue === "sla"} tone="danger" />
          <CountChip label="No next step" value={counts.noTask} href={issueHref("no-task")} active={issue === "no-task"} tone="info" />
          <CountChip label="Stuck in stage" value={counts.stuck} href={issueHref("stuck")} active={issue === "stuck"} tone="warning" />
          <CountChip label="Abandoned" value={counts.abandoned} href={issueHref("abandoned")} active={issue === "abandoned"} tone="danger" />
          <CountChip label="Overdue tasks" value={overdueTaskRows.length} href={issueHref("overdue-task")} active={issue === "overdue-task"} tone="danger" />
          <CountChip label="First-response gaps" value={firstResponseRows.length} href={issueHref("first-response")} active={issue === "first-response"} tone="danger" />
          <CountChip label="Re-inquiry follow-ups" value={reinquiryRows.length} href={issueHref("reinquiry")} active={issue === "reinquiry"} tone="info" />
        </div>

        {isTaskIssue(issue) ? (
          <Section
            title={`${activeTaskRows.length} shown`}
            action={
              <span className="text-caption text-on-surface-variant">
                {issue === "overdue-task" && "Open tasks whose due date has passed"}
                {issue === "reinquiry" && "Open re-inquiry follow-up tasks"}
                {issue === "first-response" && `Assigned, never contacted, past ${FIRST_RESPONSE_SLA_HOURS}h`}
              </span>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-label-sm">
                <thead>
                  <tr className="border-b border-outline-variant text-left text-caption uppercase tracking-wider text-on-surface-variant">
                    <th className="py-sm pr-sm font-semibold">Lead</th>
                    <th className="px-sm py-sm font-semibold">Status</th>
                    {showConsultant && <th className="px-sm py-sm font-semibold">Consultant</th>}
                    <th className="pl-sm py-sm text-right font-semibold">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTaskRows.length === 0 ? (
                    <tr>
                      <td colSpan={showConsultant ? 4 : 3} className="py-lg text-center text-on-surface-variant">
                        Nothing here — all clear.
                      </td>
                    </tr>
                  ) : (
                    activeTaskRows.map((r) => (
                      <tr key={r.id} className="border-b border-outline-variant/60 hover:bg-surface-container-low">
                        <td className="py-sm pr-sm">
                          <Link href={`/crm/leads/${r.id}`} className="font-medium text-on-surface hover:underline">
                            {r.name}
                          </Link>
                        </td>
                        <td className="px-sm py-sm">
                          <StatusPill label={r.statusLabel} color={r.statusColor} />
                        </td>
                        {showConsultant && (
                          <td className="px-sm py-sm">
                            {access.canAssign ? (
                              <QueueAssignCell leadId={r.id} assigneeId={r.assigneeId} bdes={bdeOptions} />
                            ) : (
                              <span className="text-on-surface-variant">{r.assigneeName ?? "Unassigned"}</span>
                            )}
                          </td>
                        )}
                        <td className="pl-sm py-sm text-right tabular-nums font-semibold text-error">
                          {fmtDays(r.ageDays)}
                          <span className="ml-xs font-normal text-caption text-on-surface-variant">{r.ageLabel}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        ) : (
          <Section
            title={issue ? `${rows.length} shown` : `${rows.length} lead${rows.length === 1 ? "" : "s"} need attention`}
            action={
              <span className="text-caption text-on-surface-variant">
                SLA {Object.values(SLA_THRESHOLD_DAYS).filter((d, i, a) => a.indexOf(d) === i).sort((a, b) => a - b).join("/")}d by
                stage · abandoned &gt;{ABANDONED_DAYS}d · stuck &gt;{STUCK_DAYS}d
              </span>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-label-sm">
                <thead>
                  <tr className="border-b border-outline-variant text-left text-caption uppercase tracking-wider text-on-surface-variant">
                    <th className="py-sm pr-sm font-semibold">Lead</th>
                    <th className="px-sm py-sm font-semibold">Status</th>
                    {showConsultant && <th className="px-sm py-sm font-semibold">Consultant</th>}
                    <th className="px-sm py-sm font-semibold">Issues</th>
                    <th className="px-sm py-sm text-right font-semibold">Idle</th>
                    <th className="px-sm py-sm text-right font-semibold">In stage</th>
                    <th className="pl-sm py-sm text-right font-semibold">Next task</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={showConsultant ? 7 : 6} className="py-lg text-center text-on-surface-variant">
                        Nothing here — all clear.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => {
                      const overdue = r.nextTaskDueAt !== null && r.nextTaskDueAt.getTime() < todayStart;
                      return (
                        <tr key={r.id} className="border-b border-outline-variant/60 hover:bg-surface-container-low">
                          <td className="py-sm pr-sm">
                            <Link href={`/crm/leads/${r.id}`} className="font-medium text-on-surface hover:underline">
                              {r.name}
                            </Link>
                          </td>
                          <td className="px-sm py-sm">
                            <StatusPill label={r.statusLabel} color={r.statusColor} />
                          </td>
                          {showConsultant && (
                            <td className="px-sm py-sm">
                              {access.canAssign ? (
                                <QueueAssignCell leadId={r.id} assigneeId={r.assigneeId} bdes={bdeOptions} />
                              ) : (
                                <span className="text-on-surface-variant">{r.assigneeName ?? "Unassigned"}</span>
                              )}
                            </td>
                          )}
                          <td className="px-sm py-sm">
                            <div className="flex flex-wrap gap-[4px]">
                              {r.slaBreached && <IssueBadge label="SLA" tone="danger" />}
                              {r.noNextStep && <IssueBadge label="No step" tone="info" />}
                              {r.stuck && <IssueBadge label="Stuck" tone="warning" />}
                              {r.abandoned && <IssueBadge label="Abandoned" tone="danger" />}
                            </div>
                          </td>
                          <td
                            className={`px-sm py-sm text-right tabular-nums ${r.slaBreached || r.abandoned ? "font-semibold text-error" : "text-on-surface-variant"}`}
                            title="Days since the lead was last touched"
                          >
                            {fmtDays(r.daysSinceTouch)}
                          </td>
                          <td
                            className={`px-sm py-sm text-right tabular-nums ${r.stuck ? "font-semibold text-amber-700" : "text-on-surface-variant"}`}
                            title="Days in the current status"
                          >
                            {fmtDays(r.daysInStage)}
                          </td>
                          <td className="pl-sm py-sm text-right tabular-nums">
                            {r.noNextStep ? (
                              <span className="text-error font-semibold">none</span>
                            ) : (
                              <span className={overdue ? "text-error font-semibold" : "text-on-surface-variant"}>
                                {fmtDate(r.nextTaskDueAt)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
