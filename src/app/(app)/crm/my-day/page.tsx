import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { firstLeadId, formatWait, getMyDay, type MyDayLead } from "@/lib/crm-my-day";

export const dynamic = "force-dynamic";

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

export default async function MyDayPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) redirect("/");

  const now = new Date();
  const day = await getMyDay(userId, now);
  const first = firstLeadId(day);
  const total = day.waitingTotal + day.uncontactedTotal + day.tasksOverdue + day.tasksToday + day.qualityTotal;

  return (
    <>
      <TopBar title="My Day" subtitle="Who to contact next, in order" />
      <div className="p-margin space-y-lg">
        <div className="flex flex-wrap items-center justify-between gap-base">
          <p className="text-body-md text-on-surface-variant">
            {total === 0
              ? "Nothing waiting on you right now."
              : `${total} thing${total === 1 ? "" : "s"} waiting on you — top to bottom is the order to do them.`}
          </p>
          {first && (
            <Link
              href={`/crm/leads/${first}`}
              className="inline-flex h-10 items-center gap-xs rounded-lg bg-primary px-lg text-label-sm font-bold text-on-primary hover:opacity-90"
            >
              Start with the first <Icon name="arrow_forward" />
            </Link>
          )}
        </div>

        <Section title={`1 · Waiting for your reply on WhatsApp (${day.waitingTotal})`}>
          {day.waiting.length === 0 ? (
            <Empty text="No candidate is waiting for a reply." />
          ) : (
            day.waiting.map((w) => (
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

        <Section title={`2 · New leads not contacted yet (${day.uncontactedTotal})`}>
          {day.uncontacted.length === 0 ? (
            <Empty text="Every new lead has been contacted." />
          ) : (
            <LeadRows rows={day.uncontacted} label="assigned" now={now} />
          )}
        </Section>

        <Section title={`3 · Tasks — ${day.tasksOverdue} overdue, ${day.tasksToday} due today`}>
          {day.tasks.length === 0 ? (
            <Empty text="No tasks overdue or due today." />
          ) : (
            day.tasks.map((t) => (
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

        <Section title={`4 · Quality ratings due (${day.qualityTotal})`}>
          {day.quality.length === 0 ? (
            <Empty text="No ratings due." />
          ) : (
            <LeadRows rows={day.quality} label="due" now={now} />
          )}
        </Section>
      </div>
    </>
  );
}
