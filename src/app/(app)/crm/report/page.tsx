import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { KpiCard, Section } from "@/components/Cards";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { getAssignableBdes } from "@/lib/crm-leads";
import { formatActiveTime } from "@/lib/usage-tracking";
import { formatIstShort, todayIst } from "@/lib/lead-pulse-dates";
import {
  resolveReportDay,
  resolveReportScope,
  getDailyReportView,
  getTeamRollup,
  canReviewReports,
  isReviewed,
  type ReportStatus,
  type ReportTaskItem,
} from "@/lib/crm-daily-report";
import { DayNav, ReportForm, ReviewPanel } from "./client";

export const dynamic = "force-dynamic";

type SP = { [k: string]: string | string[] | undefined };

function str(sp: SP, k: string): string | undefined {
  const v = sp[k];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(n: number): string {
  return String(n);
}

/** HH:MM in IST for a stored ISO timestamp. */
function istTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

/** "Wed, Jul 30" in IST for a stored ISO timestamp. */
function istDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

function StatusBadge({ status }: { status: ReportStatus }) {
  const map: Record<ReportStatus, { label: string; cls: string }> = {
    none: { label: "Not submitted", cls: "bg-surface-container-high text-on-surface-variant" },
    submitted: { label: "Submitted", cls: "bg-amber-50 text-amber-900" },
    reviewed: { label: "Reviewed", cls: "bg-green-50 text-green-700" },
  };
  const s = map[status];
  return <span className={`inline-flex items-center rounded-full px-sm py-[2px] text-[11px] font-bold ${s.cls}`}>{s.label}</span>;
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

function LeadLink({ id, name }: { id: string; name: string }) {
  return (
    <Link href={`/crm/leads/${id}`} className="font-medium text-on-surface hover:underline">
      {name}
    </Link>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="py-md text-center text-label-sm text-on-surface-variant">{text}</p>;
}

/** A compact task list used for completed / created / open. */
function TaskList({ tasks, when }: { tasks: ReportTaskItem[]; when: "completedAt" | "dueAt" | "createdAt" }) {
  if (tasks.length === 0) return <EmptyRow text="Nothing here." />;
  return (
    <ul className="divide-y divide-outline-variant">
      {tasks.map((t) => {
        const ts = when === "completedAt" ? t.completedAt : t.dueAt;
        return (
          <li key={t.id} className="flex items-center gap-sm py-xs">
            <span className="min-w-0 flex-1 truncate text-label-sm text-on-surface">
              {t.subject} <span className="text-on-surface-variant">· </span>
              <LeadLink id={t.leadId} name={t.leadName} />
            </span>
            <span className="shrink-0 text-caption tabular-nums text-on-surface-variant">
              {ts ? (when === "dueAt" ? istDate(ts) : istTime(ts)) : "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default async function DailyReportPage({ searchParams }: { searchParams: SP }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) {
    return (
      <>
        <TopBar title="Daily Report" subtitle="CRM" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            You don&apos;t have access to the CRM. Ask an administrator to grant you the CRM pages.
          </div>
        </div>
      </>
    );
  }

  const dayStr = resolveReportDay(str(searchParams, "date"));
  const scope = resolveReportScope(access, str(searchParams, "bde"));
  const isToday = dayStr === todayIst();

  // Roster for the manager's BDE selector (and to resolve display names).
  const roster = scope.canViewOthers ? await getAssignableBdes() : [];
  const bdeOptions = roster.map((b) => ({ userId: b.userId, displayName: b.displayName }));

  const nav = (
    <DayNav day={dayStr} bde={scope.targetUserId} bdes={bdeOptions} showBde={scope.canViewOthers} />
  );

  // ── Manager team roll-up ───────────────────────────────────────────────────
  if (scope.rollup) {
    const rows = await getTeamRollup({ dayStr });
    const submitted = rows.filter((r) => r.status !== "none").length;
    return (
      <>
        <TopBar title="Daily Report" subtitle="Team roll-up" />
        <div className="p-margin space-y-lg">
          <div className="flex flex-wrap items-center justify-between gap-base">
            {nav}
            <p className="text-label-sm text-on-surface-variant">
              <span className="font-semibold text-on-surface">{submitted}</span> of {rows.length} reported ·{" "}
              {formatIstShort(dayStr)}
            </p>
          </div>
          <Section title="Who has reported">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-label-sm">
                <thead>
                  <tr className="border-b border-outline-variant text-left text-caption uppercase tracking-wider text-on-surface-variant">
                    <th className="py-sm pr-sm font-semibold">BDE</th>
                    <th className="px-sm py-sm font-semibold">Status</th>
                    <th className="px-sm py-sm text-right font-semibold">Leads</th>
                    <th className="px-sm py-sm text-right font-semibold">Contacts</th>
                    <th className="px-sm py-sm text-right font-semibold">Tasks ✓</th>
                    <th className="px-sm py-sm text-right font-semibold">Notes</th>
                    <th className="px-sm py-sm font-semibold">Submitted</th>
                    <th className="pl-sm py-sm text-right font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.userId} className="border-b border-outline-variant/60 hover:bg-surface-container-low">
                      <td className="py-sm pr-sm font-medium text-on-surface">
                        {r.displayName}
                        <span className="ml-xs text-caption uppercase text-on-surface-variant">{r.role}</span>
                      </td>
                      <td className="px-sm py-sm"><StatusBadge status={r.status} /></td>
                      <td className="px-sm py-sm text-right tabular-nums">{r.leadsTouched ?? "—"}</td>
                      <td className="px-sm py-sm text-right tabular-nums">{r.contacts ?? "—"}</td>
                      <td className="px-sm py-sm text-right tabular-nums">{r.tasksCompleted ?? "—"}</td>
                      <td className="px-sm py-sm text-right tabular-nums">{r.notesAdded ?? "—"}</td>
                      <td className="px-sm py-sm text-caption text-on-surface-variant">
                        {r.submittedAt ? istTime(r.submittedAt) : "—"}
                      </td>
                      <td className="pl-sm py-sm text-right">
                        <Link href={`/crm/report?date=${dayStr}&bde=${r.userId}`} className="font-semibold text-primary hover:underline">
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      </>
    );
  }

  // ── Single BDE's day ────────────────────────────────────────────────────────
  const targetUserId = scope.targetUserId!;
  const isOwner = targetUserId === userId;
  const displayName =
    roster.find((b) => b.userId === targetUserId)?.displayName ??
    (isOwner ? access.bdeDisplayName ?? "Me" : "BDE");

  const view = await getDailyReportView({ userId: targetUserId, displayName, dayStr });
  const m = view.metrics;
  const d = view.details;
  const report = view.report;
  const reviewed = isReviewed(report);
  const canEdit = isOwner && access.isBde && !reviewed;
  const canReview = canReviewReports(access) && !isOwner && !!report;

  return (
    <>
      <TopBar
        title="Daily Report"
        subtitle={isOwner ? (isToday ? "Today" : formatIstShort(dayStr)) : `${displayName} · ${formatIstShort(dayStr)}`}
      />
      <div className="p-margin space-y-lg">
        <div className="flex flex-wrap items-center justify-between gap-base">
          <div className="flex flex-wrap items-center gap-base">
            {scope.canViewOthers && (
              <Link href={`/crm/report?date=${dayStr}`} className="text-label-sm font-semibold text-primary hover:underline">
                ← Team
              </Link>
            )}
            {nav}
          </div>
          <div className="flex items-center gap-base">
            {report ? <StatusBadge status={report.status} /> : <StatusBadge status="none" />}
            {view.live && <span className="text-caption text-on-surface-variant">Live preview — not yet submitted</span>}
          </div>
        </div>

        {/* KPI summary */}
        <section className="grid grid-cols-2 gap-gutter md:grid-cols-4 lg:grid-cols-4">
          <KpiCard label="Leads touched" value={num(m.leadsTouched)} tone="primary" hint="Distinct active leads worked" />
          <KpiCard
            label="Contacts logged"
            value={num(m.contacts)}
            hint={`${m.calls} calls · ${m.emails} email · ${m.whatsapp} WhatsApp`}
          />
          <KpiCard label="Notes added" value={num(m.notesAdded)} />
          <KpiCard label="Tasks completed" value={num(m.tasksCompleted)} tone="success" hint={`${m.tasksCreated} created`} />
          <KpiCard label="New leads assigned" value={num(m.newLeadsAssigned)} />
          <KpiCard label="Enrolments" value={num(m.enrollments)} tone={m.enrollments > 0 ? "success" : "default"} />
          <KpiCard label="Open tasks due" value={num(m.tasksOpen)} tone={m.tasksOpen > 0 ? "primary" : "default"} hint="Today or overdue" />
          <KpiCard label="Active CRM time" value={formatActiveTime(m.activeSeconds)} hint="Focused & interacting" />
        </section>

        {/* Narrative + review */}
        <div className="grid grid-cols-1 gap-gutter lg:grid-cols-2">
          <Section title={isOwner ? "Your report" : `${displayName}'s report`}>
            {canEdit ? (
              <ReportForm
                day={dayStr}
                initial={{
                  summary: report?.summary ?? "",
                  blockers: report?.blockers ?? "",
                  planNext: report?.planNext ?? "",
                }}
                submitted={!!report}
              />
            ) : report ? (
              <div className="space-y-md">
                <Narrative label="Summary" body={report.summary} />
                {report.blockers && <Narrative label="Blockers / help needed" body={report.blockers} />}
                {report.planNext && <Narrative label="Plan for next day" body={report.planNext} />}
                <p className="text-caption text-on-surface-variant">
                  Submitted {istDate(report.submittedAt)} at {istTime(report.submittedAt)}.
                  {report.reviewedByName && report.reviewedAt && (
                    <>
                      {" "}Reviewed by <span className="font-semibold">{report.reviewedByName}</span> on {istDate(report.reviewedAt)}.
                    </>
                  )}
                </p>
                {report.reviewerNote && (
                  <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md text-label-sm text-on-surface">
                    <span className="font-semibold">Reviewer note: </span>
                    {report.reviewerNote}
                  </div>
                )}
              </div>
            ) : (
              <EmptyRow text={isOwner ? "You haven't submitted a report for this day yet." : "No report submitted for this day."} />
            )}
          </Section>

          {canReview && report && (
            <Section title="Review">
              {reviewed ? (
                <p className="text-label-sm text-on-surface-variant">
                  Reviewed by <span className="font-semibold">{report.reviewedByName}</span>
                  {report.reviewedAt && <> on {istDate(report.reviewedAt)}</>}.
                </p>
              ) : (
                <ReviewPanel reportId={report.id} />
              )}
            </Section>
          )}
        </div>

        {/* Detail lists */}
        <div className="grid grid-cols-1 gap-gutter lg:grid-cols-2">
          <Section title={`Notes added (${d.notes.length})`}>
            {d.notes.length === 0 ? (
              <EmptyRow text="No notes added this day." />
            ) : (
              <ul className="divide-y divide-outline-variant">
                {d.notes.map((n) => (
                  <li key={n.id} className="py-sm">
                    <div className="flex items-center justify-between gap-sm">
                      <LeadLink id={n.leadId} name={n.leadName} />
                      <span className="shrink-0 text-caption tabular-nums text-on-surface-variant">{istTime(n.createdAt)}</span>
                    </div>
                    <p className="mt-xs whitespace-pre-wrap text-label-sm text-on-surface-variant">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Contacts logged (${d.comms.length})`}>
            {d.comms.length === 0 ? (
              <EmptyRow text="No calls, emails or WhatsApp logged this day." />
            ) : (
              <ul className="divide-y divide-outline-variant">
                {d.comms.map((c) => (
                  <li key={c.id} className="flex items-center gap-sm py-xs">
                    <span className="w-20 shrink-0 text-caption font-semibold uppercase text-on-surface-variant">
                      {commLabel(c.type)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-label-sm text-on-surface">
                      <LeadLink id={c.leadId} name={c.leadName} />
                      {c.summary && <span className="text-on-surface-variant"> · {c.summary}</span>}
                    </span>
                    <span className="shrink-0 text-caption tabular-nums text-on-surface-variant">{istTime(c.occurredAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Tasks completed (${d.tasksCompleted.length})`}>
            <TaskList tasks={d.tasksCompleted} when="completedAt" />
          </Section>

          <Section title={`Tasks created (${d.tasksCreated.length})`}>
            <TaskList tasks={d.tasksCreated} when="createdAt" />
          </Section>

          <Section title={`Open tasks — today or overdue (${d.tasksOpen.length})`}>
            <TaskList tasks={d.tasksOpen} when="dueAt" />
          </Section>

          <Section title={`Leads touched (${d.leadsTouched.length})`}>
            {d.leadsTouched.length === 0 ? (
              <EmptyRow text="No leads worked this day." />
            ) : (
              <ul className="divide-y divide-outline-variant">
                {d.leadsTouched.map((l) => (
                  <li key={l.id} className="flex items-center gap-sm py-xs">
                    <span className="min-w-0 flex-1 truncate">
                      <LeadLink id={l.id} name={l.name} />
                    </span>
                    <StatusPill label={l.statusLabel} color={l.statusColor} />
                    <span className="w-16 shrink-0 text-right text-caption tabular-nums text-on-surface-variant">
                      {l.touches} {l.touches === 1 ? "touch" : "touches"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

function Narrative({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <p className="mb-xs text-label-sm font-semibold text-on-surface">{label}</p>
      <p className="whitespace-pre-wrap text-label-sm text-on-surface-variant">{body}</p>
    </div>
  );
}

function commLabel(type: string): string {
  switch (type) {
    case "CALL_LOGGED":
      return "Call";
    case "EMAIL_SENT":
      return "Email";
    case "WHATSAPP_SENT":
      return "WhatsApp";
    default:
      return type;
  }
}
