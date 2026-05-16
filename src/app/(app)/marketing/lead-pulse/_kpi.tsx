// Shared KPI tile components for the Lead Pulse dashboard and the
// Monthly Funnel Report. Kept as a tiny presentational module so the
// two pages render the same "value + sub-line + target + trend pill"
// shape without copy-pasting.

export function pctChange(now: number, prev: number): number | null {
  if (prev === 0) return now === 0 ? 0 : null;
  return Math.round(((now - prev) / prev) * 1000) / 10;
}

export function Kpi({
  label,
  value,
  trend,
  icon,
  paceLabel,
  paceValue,
  paceTrend,
  subLabel,
  subValue,
  target,
}: {
  label: string;
  value: string;
  trend?: number | null;
  icon: string;
  paceLabel?: string;
  paceValue?: number;
  paceTrend?: number | null;
  subLabel?: string;
  subValue?: string;
  target?: string;
}) {
  return (
    <div
      className="rounded-[12px] p-[16px] border flex items-start justify-between"
      style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
    >
      <div className="min-w-0">
        <span
          className="inline-flex items-center justify-center w-[32px] h-[32px] rounded-[8px] mb-[8px]"
          style={{ backgroundColor: "var(--lp-surface-container-high)", color: "var(--lp-primary)" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{icon}</span>
        </span>
        <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--lp-on-surface-variant)" }}>
          {label}
        </p>
        <p className="text-[26px] font-bold tabular-nums mt-[2px]" style={{ color: "var(--lp-primary)" }}>
          {value}
        </p>
        {target && (
          <p className="text-[11px] mt-[2px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            {target}
          </p>
        )}
        {subLabel && subValue != null && (
          <p
            className="text-[11px] mt-[6px] flex flex-wrap items-baseline gap-[6px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            <span style={{ opacity: 0.8 }}>{subLabel}:</span>
            <span className="tabular-nums" style={{ color: "var(--lp-on-surface)" }}>
              {subValue}
            </span>
          </p>
        )}
        {paceLabel && paceValue != null && (
          <p
            className="text-[11px] mt-[6px] flex items-center gap-[6px] flex-wrap"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            <span>
              Pace: <span className="tabular-nums">{paceValue.toLocaleString("en-IN")}</span>{" "}
              <span style={{ opacity: 0.8 }}>({paceLabel})</span>
            </span>
            {paceTrend != null ? (
              <span
                className="text-[10px] px-[6px] py-[1px] rounded-full"
                style={{
                  backgroundColor:
                    paceTrend >= 0 ? "rgba(51, 228, 255, 0.18)" : "rgba(255, 180, 171, 0.18)",
                  color: paceTrend >= 0 ? "var(--lp-cyan)" : "var(--lp-error)",
                }}
                title="Same-window pace vs last month"
              >
                {paceTrend >= 0 ? "▲" : "▼"} {Math.abs(paceTrend).toFixed(1)}%
              </span>
            ) : (
              <span className="text-[10px]" style={{ opacity: 0.6 }} title="No data last month for this window">
                —
              </span>
            )}
          </p>
        )}
      </div>
      {trend != null && (
        <span
          className="text-[11px] px-[8px] py-[2px] rounded-full whitespace-nowrap"
          style={{
            backgroundColor: trend >= 0 ? "rgba(51, 228, 255, 0.18)" : "rgba(255, 180, 171, 0.18)",
            color: trend >= 0 ? "var(--lp-cyan)" : "var(--lp-error)",
          }}
        >
          {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
        </span>
      )}
    </div>
  );
}

export function TripletKpi({
  label,
  icon,
  thisMonth,
  lastMonth,
  lastMonthLabel = "Last month",
  avg,
  avgLabel,
}: {
  label: string;
  icon: string;
  thisMonth: number;
  lastMonth: number;
  lastMonthLabel?: string;
  avg: number;
  avgLabel: string;
}) {
  const monthTrend = lastMonth === 0 ? null : ((thisMonth - lastMonth) / lastMonth) * 100;
  const avgTrend = avg === 0 ? null : ((thisMonth - avg) / avg) * 100;
  return (
    <div
      className="rounded-[12px] p-[16px] border"
      style={{
        backgroundColor: "var(--lp-surface-container)",
        borderColor: "var(--lp-outline-variant)",
      }}
    >
      <div className="flex items-center gap-[8px] mb-[8px]">
        <span
          className="inline-flex items-center justify-center w-[28px] h-[28px] rounded-[6px]"
          style={{
            backgroundColor: "var(--lp-surface-container-high)",
            color: "var(--lp-primary)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            {icon}
          </span>
        </span>
        <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--lp-on-surface-variant)" }}>
          {label}
        </p>
      </div>
      <p className="text-[26px] font-bold tabular-nums" style={{ color: "var(--lp-primary)" }}>
        {thisMonth.toLocaleString("en-IN")}
      </p>
      <div className="grid grid-cols-2 gap-[6px] mt-[8px] text-[11px]">
        <div>
          <p style={{ color: "var(--lp-on-surface-variant)" }}>{lastMonthLabel}</p>
          <p className="font-mono">{lastMonth.toLocaleString("en-IN")}</p>
          {monthTrend != null && (
            <span
              className="text-[10px]"
              style={{ color: monthTrend >= 0 ? "var(--lp-cyan)" : "var(--lp-error)" }}
            >
              {monthTrend >= 0 ? "▲" : "▼"} {Math.abs(monthTrend).toFixed(1)}%
            </span>
          )}
        </div>
        <div>
          <p style={{ color: "var(--lp-on-surface-variant)" }}>{avgLabel}</p>
          <p className="font-mono">{avg.toLocaleString("en-IN")}</p>
          {avgTrend != null && (
            <span
              className="text-[10px]"
              style={{ color: avgTrend >= 0 ? "var(--lp-cyan)" : "var(--lp-error)" }}
            >
              {avgTrend >= 0 ? "▲" : "▼"} {Math.abs(avgTrend).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
