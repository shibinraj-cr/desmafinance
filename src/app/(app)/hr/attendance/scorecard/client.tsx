"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";
import type { AttendanceScore, AttScoreBand, AttScoreComponent } from "@/lib/hr-attendance-score";
import type { MonthlyAttendanceScore } from "@/lib/hr-attendance-score-data";

const BAND_CHIP: Record<AttScoreBand, string> = {
  excellent: "bg-green-100 text-green-800",
  solid: "bg-blue-100 text-blue-800",
  developing: "bg-amber-100 text-amber-800",
  attention: "bg-red-100 text-red-800",
};

const PARAM_KEYS = ["presence", "punctuality", "completion", "discipline"] as const;

/** Colour a component bar by how full it is, so weak segments read red at a glance. */
function fillTone(ratio: number): string {
  if (ratio >= 0.8) return "bg-green-500";
  if (ratio >= 0.65) return "bg-blue-500";
  if (ratio >= 0.5) return "bg-amber-500";
  return "bg-red-500";
}

/** The clicked parameter, with enough context to title the calculation modal. */
type ModalCtx = { empName: string; periodLabel: string; component: AttScoreComponent };

function ComponentBar({ component, onClick }: { component: AttScoreComponent; onClick?: () => void }) {
  const { earned, max, neutral, label } = component;
  const ratio = max > 0 ? earned / max : 0;
  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-xs">
        <span className="text-[10px] text-on-surface-variant">{label}</span>
        <span className="text-[10px] font-semibold tabular-nums text-on-surface">
          {neutral ? "—" : earned}
          <span className="text-on-surface-variant">/{max}</span>
        </span>
      </div>
      <div className="mt-[2px] h-[5px] rounded-full bg-surface-container overflow-hidden">
        {neutral ? (
          <div className="h-full w-full bg-outline-variant/40" />
        ) : (
          <div className={"h-full rounded-full " + fillTone(ratio)} style={{ width: `${Math.round(ratio * 100)}%` }} />
        )}
      </div>
    </>
  );
  if (!onClick) {
    return (
      <div className="min-w-[64px]" title={`${label}: ${component.detail}`}>
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label}: ${component.detail} — click for the calculation`}
      className="group min-w-[64px] w-full text-left rounded px-[3px] py-[2px] hover:bg-surface-container focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
    >
      {inner}
    </button>
  );
}

function ScoreBadge({ score, band, bandLabel, scored, emptyLabel }: { score: number; band: AttScoreBand; bandLabel: string; scored: boolean; emptyLabel: string }) {
  if (!scored) {
    return (
      <span className="inline-flex flex-col items-center rounded-lg px-sm py-xs bg-surface-container text-on-surface-variant min-w-[52px]">
        <span className="text-title-md font-bold leading-none">—</span>
        <span className="text-[9px] uppercase tracking-wide mt-[2px]">{emptyLabel}</span>
      </span>
    );
  }
  return (
    <span className={"inline-flex flex-col items-center rounded-lg px-sm py-xs min-w-[52px] " + BAND_CHIP[band]}>
      <span className="text-title-md font-bold leading-none tabular-nums">{score}</span>
      <span className="text-[9px] uppercase tracking-wide mt-[2px]">{bandLabel}</span>
    </span>
  );
}

/** A compact clickable parameter value inside the monthly breakdown. */
function MonthParamCell({ component, onClick }: { component: AttScoreComponent | null; onClick: () => void }) {
  if (!component) return <span className="text-on-surface-variant">—</span>;
  const ratio = component.max > 0 ? component.earned / component.max : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${component.label} — click for the calculation`}
      className="inline-flex items-center gap-xs rounded px-xs py-[1px] tabular-nums hover:bg-surface-container focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
    >
      <span className={"h-2 w-2 rounded-full shrink-0 " + fillTone(ratio)} />
      <span className="font-semibold">{component.neutral ? "—" : component.earned}</span>
      <span className="text-on-surface-variant">/{component.max}</span>
    </button>
  );
}

function CalcModal({ ctx, onClose }: { ctx: ModalCtx; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const c = ctx.component;
  const ratio = c.max > 0 ? c.earned / c.max : 0;
  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-md" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${c.label} calculation`}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-xl shadow-2xl max-w-md w-full max-h-[85vh] overflow-y-auto p-lg"
      >
        <div className="flex items-start justify-between gap-md">
          <div className="min-w-0">
            <h3 className="text-title-sm font-bold">{c.label}</h3>
            <p className="text-caption text-on-surface-variant truncate">
              {ctx.empName} · {ctx.periodLabel}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-on-surface-variant hover:text-on-surface leading-none">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="mt-md flex items-center gap-md">
          <span className="text-h1 font-extrabold tabular-nums leading-none">
            {c.neutral ? "—" : c.earned}
            <span className="text-on-surface-variant text-title-md font-normal">/{c.max}</span>
          </span>
          <div className="flex-1 h-[8px] rounded-full bg-surface-container overflow-hidden">
            {!c.neutral && <div className={"h-full rounded-full " + fillTone(ratio)} style={{ width: `${Math.round(ratio * 100)}%` }} />}
          </div>
        </div>

        <div className="mt-lg">
          <p className="text-caption uppercase tracking-wider text-on-surface-variant font-semibold mb-xs">How it&apos;s calculated</p>
          <p className="text-caption font-mono bg-surface-container rounded-lg p-sm leading-relaxed">{c.formula}</p>
          <ul className="mt-sm space-y-xs">
            {c.steps.map((st, i) => (
              <li key={i} className="flex justify-between gap-md text-label-sm border-b border-outline-variant/50 pb-xs last:border-0">
                <span className="text-on-surface-variant shrink-0">{st.label}</span>
                <span className="font-mono tabular-nums text-right">{st.value}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-lg rounded-lg bg-primary/5 border border-primary/15 p-sm">
          <p className="text-caption uppercase tracking-wider text-primary font-semibold mb-xs">Insight</p>
          <p className="text-label-sm text-on-surface">{c.insight}</p>
        </div>
      </div>
    </div>
  );
}

export function AttendanceScorecardClient({
  monthKey,
  prevMonth,
  nextMonth,
  windowLabel,
  cycleMonths,
  trendMonths,
  scores,
  flagged,
  monthlyByEmployee,
}: {
  monthKey: string;
  prevMonth: string;
  nextMonth: string;
  windowLabel: string;
  cycleMonths: string[];
  trendMonths: string[];
  scores: AttendanceScore[];
  flagged: AttendanceScore[];
  monthlyByEmployee: Record<string, MonthlyAttendanceScore[]>;
}) {
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(monthKey);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<ModalCtx | null>(null);

  function gotoMonth(m: string) {
    setSelectedMonth(m);
    router.push(`/hr/attendance/scorecard?month=${m}`);
  }

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const rollingLabel = `Rolling ${cycleMonths.length} cycles`;

  const scoredCount = scores.filter((s) => s.scored).length;
  const bandCounts = scores.reduce(
    (acc, s) => {
      if (s.scored) acc[s.band]++;
      return acc;
    },
    { excellent: 0, solid: 0, developing: 0, attention: 0 } as Record<AttScoreBand, number>,
  );

  return (
    <>
      <Section title="">
        <div className="flex flex-wrap items-center gap-sm">
          <button onClick={() => gotoMonth(prevMonth)} className="px-sm py-sm rounded border border-outline-variant" title={`Previous cycle (${prevMonth})`}>
            ←
          </button>
          <label className="flex items-center gap-xs text-label-sm">
            <span className="text-on-surface-variant">Cycle month</span>
            <input type="month" value={selectedMonth} onChange={(e) => gotoMonth(e.target.value)} className="px-sm py-sm rounded border border-outline-variant bg-surface" />
          </label>
          <button onClick={() => gotoMonth(nextMonth)} className="px-sm py-sm rounded border border-outline-variant" title={`Next cycle (${nextMonth})`}>
            →
          </button>
          <span className="text-label-sm text-on-surface-variant">
            Rolling {cycleMonths.length} cycles ({cycleMonths.join(", ")}) · {windowLabel}
          </span>
        </div>
        <div className="mt-md flex flex-wrap gap-sm">
          {(["excellent", "solid", "developing", "attention"] as AttScoreBand[]).map((b) => (
            <span key={b} className={"inline-flex items-center gap-xs rounded-full px-md py-xs text-label-sm font-semibold " + BAND_CHIP[b]}>
              <span className="tabular-nums">{bandCounts[b]}</span>
              <span className="capitalize font-normal">{b === "attention" ? "needs attention" : b}</span>
            </span>
          ))}
          <span className="inline-flex items-center gap-xs rounded-full px-md py-xs text-label-sm bg-surface-container text-on-surface-variant">
            {scoredCount} scored of {scores.length}
          </span>
        </div>
      </Section>

      {flagged.length > 0 && (
        <Section title={`Needs attention (${flagged.length})`}>
          <p className="text-caption text-on-surface-variant mb-md">Employees whose rolling score fell below 50 — the disciplinary follow-up list.</p>
          <ul className="space-y-sm">
            {flagged.map((s) => (
              <li key={s.employeeId} className="flex items-start gap-md rounded-lg border border-red-200 bg-red-50/50 p-sm">
                <span className="text-title-md font-bold tabular-nums text-red-800 min-w-[36px] text-center">{s.score}</span>
                <div className="min-w-0">
                  <div className="text-label-sm font-semibold text-on-surface">
                    {s.empCode} · {s.name}
                    {s.designation ? <span className="font-normal text-on-surface-variant"> · {s.designation}</span> : null}
                  </div>
                  <div className="text-caption text-on-surface-variant">{s.narrative}</div>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Scorecard">
        <div className="overflow-x-auto">
          <table className="w-full text-label-sm border-collapse">
            <thead>
              <tr className="text-left text-on-surface-variant border-b border-outline-variant">
                <th className="py-sm pr-sm w-8">#</th>
                <th className="py-sm pr-md">Employee</th>
                <th className="py-sm pr-md text-center">Score</th>
                <th className="py-sm pr-md">Presence</th>
                <th className="py-sm pr-md">Punctuality</th>
                <th className="py-sm pr-md">Full-day</th>
                <th className="py-sm pr-md">Discipline</th>
                <th className="py-sm pr-md">Read</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s, i) => {
                const byKey = Object.fromEntries(s.components.map((c) => [c.key, c])) as Record<string, AttScoreComponent>;
                const rostered = s.stats.workedDays + s.stats.absent;
                const emptyLabel = rostered > 0 ? "insufficient" : "no data";
                const isOpen = expanded.has(s.employeeId);
                const monthly = monthlyByEmployee[s.employeeId] ?? [];
                return (
                  <Fragment key={s.employeeId}>
                    <tr className="border-b border-outline-variant last:border-0 align-top">
                      <td className="py-sm pr-sm text-on-surface-variant tabular-nums">{s.scored ? i + 1 : "—"}</td>
                      <td className="py-sm pr-md">
                        <button
                          type="button"
                          onClick={() => toggleRow(s.employeeId)}
                          className="flex items-start gap-xs text-left group"
                          title="Show the month-by-month breakdown"
                        >
                          <span className="material-symbols-outlined text-on-surface-variant text-[18px] mt-[1px] transition-transform" style={{ transform: isOpen ? "rotate(90deg)" : "none" }}>
                            chevron_right
                          </span>
                          <span>
                            <span className="font-medium text-on-surface whitespace-nowrap group-hover:underline">
                              {s.empCode} · {s.name}
                            </span>
                            <span className="block text-caption text-on-surface-variant">
                              {s.designation ? `${s.designation} · ` : ""}
                              {s.stats.attendancePct !== null ? `${Math.round(s.stats.attendancePct * 100)}% attended · ${s.stats.workedDays} worked` : "no rostered days"}
                              {s.stats.alDays > 0 ? ` · ${s.stats.alDays} AL` : ""}
                              {s.stats.absent > 0 ? ` · ${s.stats.absent} absent` : ""}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="py-sm pr-md text-center">
                        <ScoreBadge score={s.score} band={s.band} bandLabel={s.bandLabel} scored={s.scored} emptyLabel={emptyLabel} />
                      </td>
                      {PARAM_KEYS.map((k) => (
                        <td key={k} className="py-sm pr-md">
                          <ComponentBar
                            component={byKey[k]}
                            onClick={() => setModal({ empName: `${s.empCode} · ${s.name}`, periodLabel: `${rollingLabel} (${cycleMonths.join(", ")})`, component: byKey[k] })}
                          />
                        </td>
                      ))}
                      <td className="py-sm pr-md text-caption text-on-surface-variant max-w-[240px]">{s.narrative}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-outline-variant bg-surface-container/30">
                        <td></td>
                        <td colSpan={7} className="py-sm pr-md">
                          <p className="text-caption text-on-surface-variant mb-xs">
                            Month-by-month · each cycle scored on its own. Click any parameter for its calculation and insight.
                          </p>
                          <div className="overflow-x-auto">
                            <table className="text-caption border-collapse">
                              <thead>
                                <tr className="text-on-surface-variant">
                                  <th className="text-left pr-md py-xs font-semibold">Month</th>
                                  <th className="text-center pr-md py-xs font-semibold">Score</th>
                                  <th className="text-left pr-md py-xs font-semibold">Presence</th>
                                  <th className="text-left pr-md py-xs font-semibold">Punctuality</th>
                                  <th className="text-left pr-md py-xs font-semibold">Full-day</th>
                                  <th className="text-left pr-md py-xs font-semibold">Discipline</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...monthly].reverse().map((m) => {
                                  const compByKey = m.components ? (Object.fromEntries(m.components.map((c) => [c.key, c])) as Record<string, AttScoreComponent>) : null;
                                  const periodLabel = `${m.label} ${m.cycleMonth.slice(0, 4)}`;
                                  return (
                                    <tr key={m.cycleMonth} className="border-t border-outline-variant/50">
                                      <td className="pr-md py-xs whitespace-nowrap font-medium text-on-surface">{periodLabel}</td>
                                      <td className="pr-md py-xs text-center">
                                        {m.scored && m.band ? (
                                          <span className={"inline-block rounded px-xs py-[1px] font-bold tabular-nums " + BAND_CHIP[m.band]}>{m.value}</span>
                                        ) : (
                                          <span className="text-on-surface-variant">{compByKey ? "insuff." : "—"}</span>
                                        )}
                                      </td>
                                      {PARAM_KEYS.map((k) => (
                                        <td key={k} className="pr-md py-xs">
                                          <MonthParamCell
                                            component={compByKey ? compByKey[k] : null}
                                            onClick={() => compByKey && setModal({ empName: `${s.empCode} · ${s.name}`, periodLabel, component: compByKey[k] })}
                                          />
                                        </td>
                                      ))}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {scores.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-lg text-center text-on-surface-variant">No active employees on the master.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-caption text-on-surface-variant mt-md">
          Score = <span className="font-bold">Presence 45</span> + <span className="font-bold">Punctuality 30</span> +{" "}
          <span className="font-bold">Full-day 15</span> + <span className="font-bold">Discipline 10</span>, over the last {cycleMonths.length} salary cycles.
          Click any parameter for its calculation and insight; click an employee to expand the {trendMonths.length}-month breakdown.
          Presence = attended ÷ rostered (half-days count half; authorised paid leave is excluded). Punctuality penalises days flagged AL
          (late beyond the grace + late-coming allowance); LCE days are free. Full-day penalises early departures. Discipline penalises
          missing punches and correction requests. Employees with fewer than 20 rostered days in a window show as{" "}
          <span className="font-semibold">insufficient</span> — not scored and never flagged. Bands: ≥80 excellent · ≥65 solid · ≥50 developing · &lt;50 needs attention.
        </p>
      </Section>

      {modal && <CalcModal ctx={modal} onClose={() => setModal(null)} />}
    </>
  );
}
