import { inr } from "@/lib/format";
import { deltaPct, type Pace, type PaceMetric } from "@/lib/pace";

export function PaceTracker({ pace }: { pace: Pace }) {
  const { asOfDay, thisMonthLabel, isFirstMonth, prevMonthLabel, priorMonthCount } =
    pace.revenue;

  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg">
      <div className="flex items-baseline justify-between mb-lg flex-wrap gap-base">
        <div>
          <h4 className="text-h3 text-on-surface">Pace Tracker</h4>
          <p className="text-caption text-on-surface-variant mt-xs">
            {thisMonthLabel} 1–{asOfDay} (this month so far)
          </p>
        </div>
        {!isFirstMonth && priorMonthCount > 0 && (
          <p className="text-label-sm text-on-surface-variant">
            Comparing same-day windows
            {prevMonthLabel ? <> · prev: <strong>{prevMonthLabel} 1–{asOfDay}</strong></> : null}
            {priorMonthCount > 1 ? <> · avg of {priorMonthCount} months</> : null}
          </p>
        )}
      </div>

      {isFirstMonth ? (
        <div className="rounded-lg bg-surface-container-low border border-outline-variant px-md py-md text-body-md text-on-surface-variant">
          First month of FY 2026-27 — pace comparisons unlock next month.
        </div>
      ) : priorMonthCount === 0 ? (
        <div className="rounded-lg bg-surface-container-low border border-outline-variant px-md py-md text-body-md text-on-surface-variant">
          No prior months in this fiscal year yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
          <PaceCard label="Revenue" metric={pace.revenue} />
          <PaceCard label="Expense" metric={pace.expense} inverted />
          <PaceCard label="Net" metric={pace.net} />
        </div>
      )}
    </section>
  );
}

function PaceCard({
  label,
  metric,
  inverted,
}: {
  label: string;
  metric: PaceMetric;
  /** When true, an increase is bad (red). Used for Expense. */
  inverted?: boolean;
}) {
  const vsPrev = deltaPct(metric.thisMtd, metric.prevMtd);
  const vsAvg = deltaPct(metric.thisMtd, metric.trailingAvg);

  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-lg p-md">
      <div className="flex items-baseline justify-between gap-base">
        <p className="text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</p>
        <span className="text-caption text-on-surface-variant">MTD</span>
      </div>
      <h5 className="text-h2 text-on-surface mt-xs">{inr(metric.thisMtd)}</h5>
      <div className="mt-md space-y-xs">
        <DeltaRow
          label={
            metric.prevMonthLabel
              ? `vs ${metric.prevMonthLabel} 1–${metric.asOfDay}`
              : "vs prev month"
          }
          baseline={metric.prevMtd}
          pct={vsPrev}
          inverted={inverted}
        />
        <DeltaRow
          label={
            metric.priorMonthCount > 1
              ? `vs ${metric.priorMonthCount}-month avg`
              : "vs prior-month avg"
          }
          baseline={metric.trailingAvg}
          pct={vsAvg}
          inverted={inverted}
        />
      </div>
    </div>
  );
}

function DeltaRow({
  label,
  baseline,
  pct,
  inverted,
}: {
  label: string;
  baseline: number | null;
  pct: number | null;
  inverted?: boolean;
}) {
  if (baseline === null) {
    return (
      <div className="flex items-center justify-between text-body-md">
        <span className="text-on-surface-variant truncate">{label}</span>
        <span className="text-on-surface-variant">—</span>
      </div>
    );
  }

  const positive = pct !== null && pct >= 0;
  const goodSign = inverted ? !positive : positive;
  const cls =
    pct === null
      ? "text-on-surface-variant"
      : goodSign
        ? "text-green-700"
        : "text-red-700";
  const arrow = pct === null ? "" : positive ? "↑" : "↓";

  return (
    <div className="flex items-center justify-between gap-base text-body-md">
      <span className="text-on-surface-variant truncate" title={label}>
        {label}
      </span>
      <span className="flex items-center gap-xs whitespace-nowrap">
        <span className="text-on-surface-variant font-mono text-caption">
          {inr(baseline)}
        </span>
        <span className={`font-bold ${cls}`}>
          {pct === null ? "—" : `${arrow} ${Math.abs(pct).toFixed(1)}%`}
        </span>
      </span>
    </div>
  );
}
