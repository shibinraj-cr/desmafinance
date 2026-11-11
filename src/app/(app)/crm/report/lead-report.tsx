/**
 * The team daily lead report — the top of the manager's roll-up on /crm/report:
 * team tiles, one row per BDE (click through to their My Day, read-only), the
 * leads missed at the cutoff and the handovers that need someone to act.
 */
import Link from "next/link";
import { Section } from "@/components/Cards";
import { Chip, HandoverStatusChip, ReportTiles, istDayTime, istTime, tableNum, tableTd, tableTh } from "@/components/crm/LeadReportParts";
import { handoverChannel } from "@/lib/crm-handover";
import type { TeamLeadReport } from "@/lib/crm-lead-report-data";

function Warn({ n }: { n: number }) {
  return n > 0 ? <Chip tone="orange">{n}</Chip> : <span className="text-on-surface-variant">0</span>;
}

export function TeamLeadReportView({ team, isToday }: { team: TeamLeadReport; isToday: boolean }) {
  const submitted = team.rows.filter((r) => r.submission?.locked).length;
  const cutoffPassed = !!team.cutoff && (!isToday || Date.now() >= new Date(team.cutoff).getTime());
  const needAction = team.handovers.filter(
    (h) => h.status === "overdue" || h.status === "rejected" || h.status === "duplicate",
  );
  const t = team.totals;
  const foot = `${tableTd} border-b-0 font-semibold`;

  return (
    <div className="space-y-lg">
      <div className="flex flex-wrap items-center justify-between gap-base">
        <h2 className="text-h3 text-on-surface">Daily lead report</h2>
        <div className="flex flex-wrap items-center gap-base">
          <span className="inline-flex items-center rounded-full bg-surface-container-high px-md py-xs text-label-sm font-semibold text-on-surface">
            {team.cutoff ? (cutoffPassed ? `Cutoff passed · ${istTime(team.cutoff)}` : `Cutoff ${istTime(team.cutoff)}`) : "No cutoff on this day"}
          </span>
          <a
            href={`/api/crm/lead-report/team/export?date=${team.day}`}
            className="inline-flex h-9 items-center gap-xs rounded-lg border border-outline-variant px-md text-label-sm font-semibold text-on-surface hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">
              download
            </span>
            Export Excel
          </a>
        </div>
      </div>

      <ReportTiles
        totals={t}
        handovers={team.handoverTotals}
        cutoffLabel={team.cutoff ? istTime(team.cutoff) : null}
        submitted={`${submitted} / ${team.rows.length}`}
      />
      {team.rows.some((r) => r.olderRule) && (
        <p className="text-caption font-semibold text-on-surface-variant">Leads assigned before the daily lead report went live are judged by the older rule: any call, note, WhatsApp or stage change by the cutoff counts as contacted.</p>
      )}

      <Section title="By BDE">
        <p className="-mt-sm mb-sm text-caption text-on-surface-variant">Click a name for their sources and lead list.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                <th className={tableTh}>BDE</th>
                <th className={`${tableTh} text-right`}>Received</th>
                <th className={`${tableTh} text-right`}>Contacted</th>
                <th className={`${tableTh} text-right`}>Pending</th>
                <th className={`${tableTh} text-right`}>Missed</th>
                <th className={`${tableTh} text-right`}>Handovers</th>
                <th className={`${tableTh} text-right`}>Created</th>
                <th className={`${tableTh} text-right`}>Overdue</th>
                <th className={tableTh}>Report</th>
              </tr>
            </thead>
            <tbody>
              {team.rows.map((r) => (
                <tr key={r.userId} className="hover:bg-surface-container-low">
                  <td className={`${tableTd} font-semibold`}>
                    <Link href={`/crm/my-day?bde=${r.userId}&date=${team.day}`} className="hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className={`${tableTd} ${tableNum}`}>
                    {r.totals.received}
                    {r.totals.carriedIn ? <span className="text-on-surface-variant"> +{r.totals.carriedIn}</span> : null}
                  </td>
                  <td className={`${tableTd} ${tableNum} text-green-800`}>{r.totals.contacted}</td>
                  <td className={`${tableTd} ${tableNum} ${r.totals.pending ? "font-semibold text-blue-700" : ""}`}>{r.totals.pending}</td>
                  <td className={`${tableTd} ${tableNum}`}>
                    <Warn n={r.totals.missed} />
                  </td>
                  <td className={`${tableTd} ${tableNum}`}>{r.handovers.given}</td>
                  <td className={`${tableTd} ${tableNum}`}>{r.handovers.created}</td>
                  <td className={`${tableTd} ${tableNum}`}>
                    <Warn n={r.handovers.overdue} />
                  </td>
                  <td className={tableTd}>
                    {r.submission?.locked ? (
                      <Chip tone="green">{r.submission.status === "reviewed" ? "Reviewed" : "Generated"}</Chip>
                    ) : (
                      <Chip tone="grey">Not generated yet</Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className={foot}>Team</td>
                <td className={`${foot} ${tableNum}`}>{t.received}</td>
                <td className={`${foot} ${tableNum} text-green-800`}>{t.contacted}</td>
                <td className={`${foot} ${tableNum} ${t.pending ? "text-blue-700" : ""}`}>{t.pending}</td>
                <td className={`${foot} ${tableNum} ${t.missed ? "text-orange-800" : ""}`}>{t.missed}</td>
                <td className={`${foot} ${tableNum}`}>{team.handoverTotals.given}</td>
                <td className={`${foot} ${tableNum}`}>{team.handoverTotals.created}</td>
                <td className={`${foot} ${tableNum} ${team.handoverTotals.overdue ? "text-orange-800" : ""}`}>{team.handoverTotals.overdue}</td>
                <td className={foot}>
                  {submitted} / {team.rows.length}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-2">
        <Section title={`Missed leads (${team.missed.length})`}>
          <p className="-mt-sm mb-sm text-caption text-on-surface-variant">
            {team.cutoff ? `Not contacted by ${istTime(team.cutoff)}.` : "Not contacted by their cutoff."}
          </p>
          {team.missed.length === 0 ? (
            <p className="py-md text-center text-label-sm text-on-surface-variant">No missed leads.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={tableTh}>Lead</th>
                    <th className={tableTh}>Source</th>
                    <th className={tableTh}>BDE</th>
                    <th className={tableTh}>Assigned</th>
                    <th className={tableTh}>Now</th>
                  </tr>
                </thead>
                <tbody>
                  {team.missed.map((m) => (
                    <tr key={m.assignmentId}>
                      <td className={`${tableTd} font-medium`}>
                        <Link href={`/crm/leads/${m.leadId}`} className="hover:underline">
                          {m.candidateName}
                        </Link>
                      </td>
                      <td className={tableTd}>{m.sourceLabel}</td>
                      <td className={tableTd}>{m.bdeName}</td>
                      <td className={`${tableTd} whitespace-nowrap`}>{istDayTime(m.assignedAt)}</td>
                      <td className={tableTd}>
                        {m.contactedLateAt ? (
                          <Chip tone="grey">Contacted late {istTime(m.contactedLateAt)}</Chip>
                        ) : (
                          <Chip tone="orange">Not contacted</Chip>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title={`Handovers needing action (${needAction.length})`}>
          <p className="-mt-sm mb-sm text-caption text-on-surface-variant">
            Overdue, rejected or already a lead.{" "}
            <Link href={`/crm/handovers?date=${team.day}`} className="font-semibold text-accent hover:underline">
              All handovers →
            </Link>
          </p>
          {needAction.length === 0 ? (
            <p className="py-md text-center text-label-sm text-on-surface-variant">Nothing to act on.</p>
          ) : (
            <ul className="space-y-sm">
              {needAction.map((h) => (
                <li
                  key={h.id}
                  className={`rounded-lg border p-md ${h.status === "overdue" ? "border-orange-300 bg-orange-50/40" : "border-outline-variant"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-sm">
                    <span className="font-semibold text-on-surface">
                      {h.leadName ?? h.phone} · {handoverChannel(h.channel)?.label ?? h.channel}
                    </span>
                    <HandoverStatusChip status={h.status} isLate={h.isLate} />
                  </div>
                  <p className="mt-xs text-caption text-on-surface-variant">
                    Given to {h.assignedBde.name} {istDayTime(h.createdAt)}
                    {h.status === "overdue" && " · not created in the CRM"}
                    {h.status === "rejected" && h.rejectNote && ` · ${h.rejectNote}`}
                    {h.status === "duplicate" && h.linkedLead && (
                      <>
                        {" · already a lead"}
                        {h.linkedLead.ownerName ? `, owner ${h.linkedLead.ownerName}` : ", unassigned"} ·{" "}
                        <Link href={`/crm/leads/${h.linkedLead.id}`} className="font-semibold text-accent hover:underline">
                          open lead
                        </Link>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
