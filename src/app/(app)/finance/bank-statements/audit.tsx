"use client";

import { Fragment, useState } from "react";
import { Section } from "@/components/Cards";
import { StatusChip, api, day, td, th, time, when } from "./_ui";

type RunRow = {
  id: string;
  trigger: string;
  status: string;
  phase: string | null;
  fromDate: string | null;
  toDate: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  gmailMessagesFound: number;
  statementsProcessed: number;
  statementsFailed: number;
  transactionsCreated: number;
  transactionsSkipped: number;
  transactionsFailed: number;
  errorSummary: string | null;
  initiatedBy: string | null;
};
type Ev = { id: string; level: string; step: string; message: string; createdAt: string; user?: string | null };

export function AuditView({ runs, events }: { runs: RunRow[]; events: Ev[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [runEvents, setRunEvents] = useState<Record<string, Ev[]>>({});

  const toggle = async (id: string) => {
    setOpen(open === id ? null : id);
    if (!runEvents[id]) {
      try {
        const r = await api<{ events: Ev[] }>(`/api/finance/bank-automation/runs/${id}`, "GET");
        setRunEvents((m) => ({ ...m, [id]: r.events }));
      } catch {
        setRunEvents((m) => ({ ...m, [id]: [] }));
      }
    }
  };

  return (
    <div className="space-y-lg">
      <Section title="Automation runs">
        {runs.length === 0 ? (
          <p className="py-lg text-center text-on-surface-variant">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-lg">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container text-on-surface-variant text-caption uppercase tracking-wide">
                <tr>
                  <th className={th}>Started</th>
                  <th className={th}>Trigger</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right hidden md:table-cell`}>E-mails</th>
                  <th className={`${th} text-right hidden md:table-cell`}>Statements</th>
                  <th className={`${th} text-right`}>Created</th>
                  <th className={`${th} text-right hidden md:table-cell`}>Skipped</th>
                  <th className={`${th} text-right hidden md:table-cell`}>Held / failed</th>
                  <th className={`${th} hidden lg:table-cell`}>By</th>
                  <th className={`${th} hidden lg:table-cell`}>Completed</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {runs.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="hover:bg-surface-container-low">
                      <td className={`${td} whitespace-nowrap`}>{when(r.startedAt ?? r.createdAt)}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        {r.trigger.toLowerCase()}
                        {r.trigger === "BACKFILL" && <div className="text-caption text-on-surface-variant">{day(r.fromDate)} → {day(r.toDate)}</div>}
                      </td>
                      <td className={td}>
                        <StatusChip status={r.status} title={r.errorSummary ?? undefined} />
                        {r.phase && <div className="text-caption text-on-surface-variant mt-[2px] max-w-[280px]">{r.phase}</div>}
                      </td>
                      <td className={`${td} text-right hidden md:table-cell`}>{r.gmailMessagesFound}</td>
                      <td className={`${td} text-right hidden md:table-cell`}>
                        {r.statementsProcessed}
                        {r.statementsFailed ? <span className="text-error"> / {r.statementsFailed} failed</span> : null}
                      </td>
                      <td className={`${td} text-right`}>{r.transactionsCreated}</td>
                      <td className={`${td} text-right hidden md:table-cell`}>{r.transactionsSkipped}</td>
                      <td className={`${td} text-right hidden md:table-cell`}>{r.transactionsFailed}</td>
                      <td className={`${td} hidden lg:table-cell`}>{r.initiatedBy ?? (r.trigger === "SCHEDULED" ? "Scheduler" : "—")}</td>
                      <td className={`${td} whitespace-nowrap hidden lg:table-cell`}>{when(r.completedAt)}</td>
                      <td className={`${td} text-right`}>
                        <button type="button" className="text-primary font-semibold hover:underline" onClick={() => toggle(r.id)}>
                          {open === r.id ? "Hide" : "Log"}
                        </button>
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr>
                        <td colSpan={11} className="px-md pb-md bg-surface-container-low">
                          <EventList events={runEvents[r.id]} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Configuration & reconciliation activity">
        <EventList events={events} showUser />
      </Section>
    </div>
  );
}

function EventList({ events, showUser }: { events: Ev[] | undefined; showUser?: boolean }) {
  if (!events) return <p className="py-sm text-on-surface-variant">Loading…</p>;
  if (events.length === 0) return <p className="py-sm text-on-surface-variant">Nothing recorded.</p>;
  return (
    <ol className="space-y-[2px] pt-sm">
      {events.map((e) => (
        <li key={e.id} className={`flex gap-sm text-body-md ${e.level === "error" ? "text-red-700" : e.level === "warn" ? "text-amber-800" : ""}`}>
          <span className="text-data-mono text-caption text-on-surface-variant w-[120px] flex-shrink-0">
            {showUser ? when(e.createdAt) : time(e.createdAt)}
          </span>
          <span className="break-words flex-1">{e.message}</span>
          {showUser && e.user && <span className="text-caption text-on-surface-variant">{e.user}</span>}
        </li>
      ))}
    </ol>
  );
}
