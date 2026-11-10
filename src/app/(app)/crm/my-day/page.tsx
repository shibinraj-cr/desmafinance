import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getAssignableBdes } from "@/lib/crm-leads";
import { resolveReportDay } from "@/lib/crm-daily-report";
import { firstLeadId, formatWait, getMyDay, type MyDayLead } from "@/lib/crm-my-day";
import { bdeName, getLeadReportAccess, getLeadReportView } from "@/lib/crm-lead-report-data";
import { canEditNarrative } from "@/lib/crm-daily-report";
import { ReportTiles, SourceTable, istDayTime, istTime } from "@/components/crm/LeadReportParts";
import { ContactQueue, CutoffPill, HandoverTable, ShareBox } from "@/components/crm/LeadReportActions";
import { DayNav, ReportForm } from "../report/client";

export const dynamic = "force-dynamic";

type SP = { [k: string]: string | string[] | undefined };

function str(sp: SP, k: string): string | undefined {
  const v = sp[k];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

const rowCls = "flex flex-wrap items-center justify-between gap-sm border-b border-outline-variant/60 py-sm last:border-0";
const btnCls =
  "inline-flex h-8 items-center gap-xs rounded-md border border-outline-variant px-sm text-label-sm font-semibold text-on-surface hover:bg-surface-container-low";

function Icon({ name }: { name: string }) {
  return (
    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
      {name}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-md text-center text-label-sm text-on-surface-variant">{text}</p>;
}

function LeadName({ id, name }: { id: string | null; name: string }) {
  return id ? (
    <Link href={`/crm/leads/${id}`} className="font-medium text-primary hover:underline">
      {name}
    </Link>
  ) : (
    <span className="font-medium text-on-surface">{name}</span>
  );
}

function CallButton({ phone }: { phone: string | null }) {
  return phone ? (
    <a href={`tel:${phone}`} className={btnCls}>
      <Icon name="call" /> Call
    </a>
  ) : null;
}

function LeadRows({ rows, label, now }: { rows: MyDayLead[]; label: string; now: Date }) {
  return (
    <>
      {rows.map((l) => (
        <div key={l.leadId} className={rowCls}>
          <div className="min-w-0">
            <LeadName id={l.leadId} name={l.candidateName} />
            <div className="text-caption text-on-surface-variant">
              {label} {formatWait(new Date(l.since), now)} ago{l.detail ? ` · ${l.detail}` : ""}
            </div>
          </div>
          <div className="flex gap-xs">
            <CallButton phone={l.phone} />
            <Link href={`/crm/leads/${l.leadId}`} className={btnCls}>
              <Icon name="open_in_new" /> Open
            </Link>
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * My Day — a BDE's leads for the day against the cutoff (the daily lead
 * report), the rest of their work in the order to do it, and the day's report
 * — generated automatically at the cutoff, with optional remarks.
 * Managers and the Marketing Admin open any BDE's day read-only with ?bde=.
 */
export default async function MyDayPage({ searchParams }: { searchParams: SP }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadReportAccess(userId, perms);
  if (!access.crm.canViewLeads) redirect("/");

  const now = new Date();
  const day = resolveReportDay(str(searchParams, "date"));
  const requested = str(searchParams, "bde");
  const viewingOther = !!requested && requested !== userId && access.canViewOthers;
  const target = viewingOther ? requested! : access.crm.isBde ? userId : null;
  const targetName = target
    ? target === userId
      ? (access.crm.bdeDisplayName ?? (await bdeName(userId)))
      : await bdeName(target)
    : null;

  const [view, work, bdes] = await Promise.all([
    target && targetName ? getLeadReportView({ userId: target, name: targetName, day, now }) : Promise.resolve(null),
    viewingOther ? Promise.resolve(null) : getMyDay(userId, now),
    access.canViewOthers ? getAssignableBdes() : Promise.resolve([]),
  ]);
  const isToday = view ? view.day === view.today : true;
  const cutoffLabel = view?.cutoff ? istTime(view.cutoff) : null;
  const first = view?.queue?.[0]?.leadId ?? (work ? firstLeadId(work) : null);
  const submission = view?.submission ?? null;
  const generated = !!submission && submission.locked;
  const reportStatus = generated
    ? `Generated automatically ${istDayTime(submission!.submittedAt)}.` +
      (submission!.status === "reviewed" && submission!.reviewedByName ? ` Reviewed by ${submission!.reviewedByName}.` : "")
    : isToday && cutoffLabel
      ? `Generated automatically at ${cutoffLabel} — there's nothing to submit.`
      : isToday
        ? "No cutoff today, so no report is generated — today's leads count on the next working day."
        : "No report was generated for this day.";

  return (
    <>
      <TopBar
        title={viewingOther && targetName ? `My Day — ${targetName}` : "My Day"}
        subtitle={viewingOther ? "Read-only view of a BDE's day" : "Your leads against today's cutoff, then the rest of your work"}
      />
      <div className="p-margin space-y-lg">
        <div className="flex flex-wrap items-center justify-between gap-base">
          <DayNav day={day} bde={viewingOther ? requested! : null} bdes={bdes} showBde={access.canViewOthers} allLabel="Me" />
          <div className="flex flex-wrap items-center gap-base">
            {view && isToday && <CutoffPill cutoff={view.cutoff} />}
            {!viewingOther && isToday && first && (
              <Link
                href={`/crm/leads/${first}`}
                className="inline-flex h-10 items-center gap-xs rounded-lg bg-primary px-lg text-label-sm font-bold text-on-primary hover:opacity-90"
              >
                Start with the first <Icon name="arrow_forward" />
              </Link>
            )}
          </div>
        </div>

        {view && (
          <>
            <ReportTiles totals={view.report.totals} handovers={view.report.handovers} cutoffLabel={cutoffLabel} />
            {!view.live && (
              <p className="text-caption text-on-surface-variant">
                Showing the numbers as they were when the report was generated at the cutoff.
              </p>
            )}

            <div className="grid grid-cols-1 gap-gutter xl:grid-cols-5">
              <Section title="Assigned leads by source" className="xl:col-span-3">
                <p className="-mt-sm mb-sm text-caption text-on-surface-variant">
                  Filled in from the CRM. Contacted = a call and a note, or a WhatsApp and a stage or Status change.
                </p>
                <SourceTable sources={view.report.sources} totals={view.report.totals} />
              </Section>
              {view.queue && (
                <Section
                  title={cutoffLabel ? `Contact before ${cutoffLabel} (${view.queue.length})` : `Leads to contact (${view.queue.length})`}
                  className="xl:col-span-2"
                >
                  <ContactQueue rows={view.queue} readOnly={viewingOther} />
                </Section>
              )}
            </div>

            <Section title={viewingOther ? "Handovers from marketing" : "My handovers from marketing"}>
              <p className="-mt-sm mb-sm text-caption text-on-surface-variant">
                Leads given outside DesGro. Create each one in the CRM before the cutoff — a lead you create with the same number links
                itself.
              </p>
              <HandoverTable rows={view.handovers} viewerId={userId} canManage={false} readOnly={viewingOther} showBde={false} />
            </Section>
          </>
        )}

        {work && isToday && (
          <>
            <Section title={`Waiting for your reply on WhatsApp (${work.waitingTotal})`}>
              {work.waiting.length === 0 ? (
                <Empty text="No candidate is waiting for a reply." />
              ) : (
                work.waiting.map((w) => (
                  <div key={w.conversationId} className={rowCls}>
                    <div className="min-w-0">
                      <LeadName id={w.leadId} name={w.candidateName} />
                      <div className="text-caption text-on-surface-variant">
                        {w.waitingSince ? `waiting ${formatWait(new Date(w.waitingSince), now)}` : "waiting"}
                        {" · "}
                        {w.windowHoursLeft === null ? (
                          <span className="font-semibold text-error">reply window closed — send a template</span>
                        ) : (
                          <span className={w.windowHoursLeft < 4 ? "font-semibold text-amber-700" : ""}>
                            {w.windowHoursLeft}h left to reply freely
                          </span>
                        )}
                      </div>
                    </div>
                    <Link href={`/crm/inbox?conversation=${w.conversationId}`} className={btnCls}>
                      <Icon name="chat" /> Reply
                    </Link>
                  </div>
                ))
              )}
            </Section>

            {/* Without the lead report (not a BDE), the old uncontacted list still has a place. */}
            {!view && (
              <Section title={`New leads not contacted yet (${work.uncontactedTotal})`}>
                {work.uncontacted.length === 0 ? (
                  <Empty text="Every new lead has been contacted." />
                ) : (
                  <LeadRows rows={work.uncontacted} label="assigned" now={now} />
                )}
              </Section>
            )}

            <Section title={`Tasks — ${work.tasksOverdue} overdue, ${work.tasksToday} due today`}>
              {work.tasks.length === 0 ? (
                <Empty text="No tasks overdue or due today." />
              ) : (
                work.tasks.map((t) => (
                  <div key={t.taskId} className={rowCls}>
                    <div className="min-w-0">
                      <LeadName id={t.leadId} name={t.candidateName} />
                      <div className="text-caption text-on-surface-variant">
                        {t.subject} ·{" "}
                        <span className={t.overdue ? "font-semibold text-error" : ""}>
                          {t.overdue ? `overdue ${formatWait(new Date(t.dueAt), now)}` : "due today"}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-xs">
                      <CallButton phone={t.phone} />
                      <Link href={`/crm/leads/${t.leadId}`} className={btnCls}>
                        <Icon name="open_in_new" /> Open
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </Section>

            <Section title={`Quality ratings due (${work.qualityTotal})`}>
              {work.quality.length === 0 ? <Empty text="No ratings due." /> : <LeadRows rows={work.quality} label="due" now={now} />}
            </Section>
          </>
        )}

        {view && (
          <Section title="Day report">
            <div className="grid grid-cols-1 gap-gutter lg:grid-cols-5">
              <div className="space-y-md lg:col-span-3">
                <p className="text-body-md text-on-surface">{reportStatus}</p>
                {!viewingOther && canEditNarrative(submission, true) ? (
                  <ReportForm
                    day={view.day}
                    initial={{
                      summary: submission?.summary ?? "",
                      blockers: submission?.blockers ?? "",
                      planNext: submission?.planNext ?? "",
                    }}
                  />
                ) : submission && (submission.summary || submission.blockers || submission.planNext) ? (
                  <div className="space-y-xs text-label-sm text-on-surface-variant">
                    {submission.summary && <p className="whitespace-pre-wrap">{submission.summary}</p>}
                    {submission.blockers && <p className="whitespace-pre-wrap">Blockers: {submission.blockers}</p>}
                    {submission.planNext && <p className="whitespace-pre-wrap">Next: {submission.planNext}</p>}
                  </div>
                ) : null}
              </div>
              <div className="lg:col-span-2">
                <ShareBox text={view.shareText} />
              </div>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
