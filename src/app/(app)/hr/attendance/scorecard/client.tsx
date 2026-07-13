"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";
import type { AttendanceScore, AttScoreBand } from "@/lib/hr-attendance-score";

const BAND_CHIP: Record<AttScoreBand, string> = {
  excellent: "bg-green-100 text-green-800",
  solid: "bg-blue-100 text-blue-800",
  developing: "bg-amber-100 text-amber-800",
  attention: "bg-red-100 text-red-800",
};

/** Colour a component bar by how full it is, so weak segments read red at a glance. */
function fillTone(ratio: number): string {
  if (ratio >= 0.8) return "bg-green-500";
  if (ratio >= 0.65) return "bg-blue-500";
  if (ratio >= 0.5) return "bg-amber-500";
  return "bg-red-500";
}

function ComponentBar({
  earned,
  max,
  neutral,
  detail,
  label,
}: {
  earned: number;
  max: number;
  neutral: boolean;
  detail: string;
  label: string;
}) {
  const ratio = max > 0 ? earned / max : 0;
  return (
    <div title={`${label}: ${detail}`} className="min-w-[64px]">
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
    </div>
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

export function AttendanceScorecardClient({
  monthKey,
  prevMonth,
  nextMonth,
  windowLabel,
  cycleMonths,
  scores,
  flagged,
}: {
  monthKey: string;
  prevMonth: string;
  nextMonth: string;
  windowLabel: string;
  cycleMonths: string[];
  scores: AttendanceScore[];
  flagged: AttendanceScore[];
}) {
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(monthKey);

  function gotoMonth(m: string) {
    setSelectedMonth(m);
    router.push(`/hr/attendance/scorecard?month=${m}`);
  }

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
          <button
            onClick={() => gotoMonth(prevMonth)}
            className="px-sm py-sm rounded border border-outline-variant"
            title={`Previous cycle (${prevMonth})`}
          >
            ←
          </button>
          <label className="flex items-center gap-xs text-label-sm">
            <span className="text-on-surface-variant">Cycle month</span>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => gotoMonth(e.target.value)}
              className="px-sm py-sm rounded border border-outline-variant bg-surface"
            />
          </label>
          <button
            onClick={() => gotoMonth(nextMonth)}
            className="px-sm py-sm rounded border border-outline-variant"
            title={`Next cycle (${nextMonth})`}
          >
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
          <p className="text-caption text-on-surface-variant mb-md">
            Employees whose rolling score fell below 50 — the disciplinary follow-up list.
          </p>
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
                const byKey = Object.fromEntries(s.components.map((c) => [c.key, c]));
                // Rostered = worked + absent. Some-but-too-few → "insufficient"; none → "no data".
                const rostered = s.stats.workedDays + s.stats.absent;
                const emptyLabel = rostered > 0 ? "insufficient" : "no data";
                return (
                  <tr key={s.employeeId} className="border-b border-outline-variant last:border-0 align-top">
                    <td className="py-sm pr-sm text-on-surface-variant tabular-nums">{s.scored ? i + 1 : "—"}</td>
                    <td className="py-sm pr-md">
                      <div className="font-medium text-on-surface whitespace-nowrap">
                        {s.empCode} · {s.name}
                      </div>
                      <div className="text-caption text-on-surface-variant">
                        {s.designation ? `${s.designation} · ` : ""}
                        {s.stats.attendancePct !== null
                          ? `${Math.round(s.stats.attendancePct * 100)}% attended · ${s.stats.workedDays} worked`
                          : "no rostered days"}
                        {s.stats.alDays > 0 ? ` · ${s.stats.alDays} AL` : ""}
                        {s.stats.absent > 0 ? ` · ${s.stats.absent} absent` : ""}
                      </div>
                    </td>
                    <td className="py-sm pr-md text-center">
                      <ScoreBadge score={s.score} band={s.band} bandLabel={s.bandLabel} scored={s.scored} emptyLabel={emptyLabel} />
                    </td>
                    {(["presence", "punctuality", "completion", "discipline"] as const).map((k) => {
                      const c = byKey[k];
                      return (
                        <td key={k} className="py-sm pr-md">
                          <ComponentBar earned={c.earned} max={c.max} neutral={c.neutral} detail={c.detail} label={c.label} />
                        </td>
                      );
                    })}
                    <td className="py-sm pr-md text-caption text-on-surface-variant max-w-[240px]">{s.narrative}</td>
                  </tr>
                );
              })}
              {scores.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-lg text-center text-on-surface-variant">
                    No active employees on the master.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-caption text-on-surface-variant mt-md">
          Score = <span className="font-bold">Presence 45</span> + <span className="font-bold">Punctuality 30</span> +{" "}
          <span className="font-bold">Full-day 15</span> + <span className="font-bold">Discipline 10</span>, over the last{" "}
          {cycleMonths.length} salary cycles. Presence = attended ÷ rostered (half-days count half; authorised paid leave is
          excluded). Punctuality penalises days flagged AL (late beyond the grace + late-coming allowance); LCE days are free.
          Full-day penalises early departures. Discipline penalises missing punches and correction requests. A component with no
          data earns its midpoint. Employees with fewer than 20 rostered days in the window show as{" "}
          <span className="font-semibold">insufficient</span> — not scored and never flagged, since a handful of days can&apos;t
          give a fair read. Bands: ≥80 excellent · ≥65 solid · ≥50 developing · &lt;50 needs attention.
        </p>
      </Section>
    </>
  );
}
