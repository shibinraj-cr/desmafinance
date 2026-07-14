import { Section } from "@/components/Cards";
import type { AttendanceScoreTrend } from "@/lib/hr-attendance-score-data";
import type { AttScoreBand } from "@/lib/hr-attendance-score";

/**
 * Employee-facing attendance score card for the home page: a monthly-score
 * trend graph plus the four-parameter feedback (Presence / Punctuality /
 * Full-day / Discipline) for the most recent scored month. Presentational and
 * server-rendered — the graph is inline SVG with native <title> tooltips.
 */

const BAND_CHIP: Record<AttScoreBand, string> = {
  excellent: "bg-green-100 text-green-800",
  solid: "bg-blue-100 text-blue-800",
  developing: "bg-amber-100 text-amber-800",
  attention: "bg-red-100 text-red-800",
};

const BAND_LABEL: Record<AttScoreBand, string> = {
  excellent: "Excellent",
  solid: "Solid",
  developing: "Developing",
  attention: "Needs attention",
};

// Band hues for the bars (vivid enough to read on both light and dark surfaces).
const BAND_HEX: Record<AttScoreBand, string> = {
  excellent: "#22a155",
  solid: "#3b6fe0",
  developing: "#e0930f",
  attention: "#e0483f",
};

function fillTone(ratio: number): string {
  if (ratio >= 0.8) return "bg-green-500";
  if (ratio >= 0.65) return "bg-blue-500";
  if (ratio >= 0.5) return "bg-amber-500";
  return "bg-red-500";
}

/** Inline SVG bar graph of monthly scores, coloured by band, with threshold guides. */
function TrendGraph({ months }: { months: AttendanceScoreTrend["months"] }) {
  const W = 360;
  const H = 168;
  const left = 26;
  const right = W - 8;
  const top = 14;
  const baseline = H - 26;
  const plotW = right - left;
  const slot = plotW / months.length;
  const barW = Math.min(30, slot * 0.62);
  const yFor = (v: number) => baseline - (v / 100) * (baseline - top);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto text-on-surface-variant"
      role="img"
      aria-label="Monthly attendance score trend"
    >
      {/* y ticks + band threshold guides */}
      {[0, 50, 65, 80, 100].map((t) => (
        <g key={t}>
          <line
            x1={left}
            x2={right}
            y1={yFor(t)}
            y2={yFor(t)}
            stroke="currentColor"
            strokeOpacity={t === 0 ? 0.35 : 0.12}
            strokeWidth={1}
            strokeDasharray={t === 0 ? undefined : "3 3"}
          />
          <text x={left - 4} y={yFor(t) + 3} textAnchor="end" fontSize="8" fill="currentColor" fillOpacity={0.6}>
            {t}
          </text>
        </g>
      ))}
      {months.map((m, i) => {
        const cx = left + slot * i + slot / 2;
        const x = cx - barW / 2;
        if (m.value == null || m.band == null) {
          // No publishable score this month — a faint hollow marker.
          return (
            <g key={m.cycleMonth}>
              <title>{`${m.label} — ${m.scored ? "" : "no score"} (insufficient / no attendance)`}</title>
              <line x1={cx} x2={cx} y1={baseline - 6} y2={baseline} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1} />
              <text x={cx} y={baseline - 9} textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity={0.4}>
                —
              </text>
              <text x={cx} y={baseline + 14} textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity={0.7}>
                {m.label}
              </text>
            </g>
          );
        }
        const y = yFor(m.value);
        const h = baseline - y;
        return (
          <g key={m.cycleMonth}>
            <title>{`${m.label} — ${m.value} (${BAND_LABEL[m.band]})`}</title>
            <rect x={x} y={y} width={barW} height={h} rx={3} fill={BAND_HEX[m.band]} />
            <text x={cx} y={y - 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor">
              {m.value}
            </text>
            <text x={cx} y={baseline + 14} textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity={0.7}>
              {m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function AttendanceScoreTrendCard({ trend }: { trend: AttendanceScoreTrend }) {
  const { months, latest } = trend;
  const anyScored = months.some((m) => m.scored);

  if (!anyScored || !latest || !latest.components) {
    return (
      <Section title="Attendance score">
        <p className="py-base text-center text-on-surface-variant text-label-sm">
          Your attendance score will appear here once you have about a month of attendance on record.
        </p>
      </Section>
    );
  }

  const band = latest.band!;
  return (
    <Section title="Attendance score">
      <div className="flex flex-wrap items-center gap-md mb-md">
        <div className={`flex flex-col items-center justify-center rounded-xl px-lg py-sm ${BAND_CHIP[band]}`}>
          <span className="text-h1 font-extrabold leading-none tabular-nums">{latest.value}</span>
          <span className="text-caption uppercase tracking-wide mt-xs">{BAND_LABEL[band]}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-caption text-on-surface-variant uppercase tracking-wider">Latest · {latest.label}</p>
          <p className="text-label-sm text-on-surface">{latest.narrative}</p>
        </div>
      </div>

      <div className="rounded-lg bg-surface-container/50 p-sm mb-md">
        <TrendGraph months={months} />
        <p className="text-caption text-on-surface-variant text-center mt-xs">Monthly score — last {months.length} cycles</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
        {latest.components.map((c) => {
          const ratio = c.max > 0 ? c.earned / c.max : 0;
          return (
            <div key={c.key} className="min-w-0">
              <div className="flex items-baseline justify-between gap-xs">
                <span className="text-label-sm font-semibold text-on-surface">{c.label}</span>
                <span className="text-label-sm font-bold tabular-nums">
                  {c.neutral ? "—" : c.earned}
                  <span className="text-on-surface-variant font-normal">/{c.max}</span>
                </span>
              </div>
              <div className="mt-[3px] h-[7px] rounded-full bg-surface-container overflow-hidden">
                <div className={`h-full rounded-full ${fillTone(ratio)}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
              </div>
              <p className="text-caption text-on-surface-variant mt-xs">{c.insight}</p>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
