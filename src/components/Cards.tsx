import { inr } from "@/lib/format";

export function KpiCard({
  label,
  value,
  hint,
  tone = "default",
  trendPct,
  trendInverted,
  sparkline,
  hero,
  dark,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "primary" | "danger" | "success";
  /** Percentage change vs previous period. e.g. 12 → "+12%". null/undefined hides the chip. */
  trendPct?: number | null;
  /** When true, positive trend is bad (e.g. expenses) so red flips to green and vice versa. */
  trendInverted?: boolean;
  /** Up to ~12 numeric values for the inline sparkline. Bars are drawn relatively. */
  sparkline?: number[];
  /** When true, the card is rendered larger / more prominent. */
  hero?: boolean;
  /** Dark "feature" card on the brand surface (e.g. the headcount/net-position tile). */
  dark?: boolean;
}) {
  const valueClass = dark
    ? "text-on-brand"
    : tone === "primary"
      ? "text-accent"
      : tone === "danger"
        ? "text-error"
        : tone === "success"
          ? "text-green-700"
          : "text-on-surface";

  const heroBorder =
    hero && tone === "primary"
      ? "border-l-4 border-l-primary"
      : hero && tone === "danger"
        ? "border-l-4 border-l-error"
        : hero && tone === "success"
          ? "border-l-4 border-l-green-600"
          : "";

  // Dark cards sit on the brand surface with a gold accent edge; light cards
  // keep the standard outlined-white treatment (+ any hero left border).
  const container = dark
    ? "bg-brand text-on-brand border-l-4 border-l-primary"
    : "bg-surface-container-lowest border border-outline-variant " + heroBorder;
  const labelClass = dark ? "text-on-brand-variant" : "text-on-surface-variant";

  const heroValue = hero ? "text-[40px] leading-[44px]" : "text-h1";

  return (
    <div className={"p-lg rounded-xl shadow-sm flex flex-col " + container}>
      <div className="flex items-start justify-between mb-sm">
        <p className={"text-label-sm uppercase tracking-wider " + labelClass}>{label}</p>
        <TrendChip pct={trendPct} inverted={trendInverted} />
      </div>
      <h3 className={`font-semibold ${valueClass} ${heroValue}`}>
        {typeof value === "number" ? inr(value) : value}
      </h3>
      {sparkline && sparkline.length > 1 && <Sparkline data={sparkline} tone={tone} />}
      {hint && <p className={"text-caption mt-md " + labelClass}>{hint}</p>}
    </div>
  );
}

function TrendChip({ pct, inverted }: { pct?: number | null; inverted?: boolean }) {
  if (pct === undefined || pct === null || !isFinite(pct)) return null;
  const positive = pct >= 0;
  // For "inverted" KPIs (e.g. expenses), an increase is bad.
  const goodSign = inverted ? !positive : positive;
  const cls = goodSign ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700";
  const arrow = positive ? "↑" : "↓";
  return (
    <span className={"px-xs py-[2px] rounded text-[11px] font-bold whitespace-nowrap " + cls}>
      {arrow} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function Sparkline({
  data,
  tone,
}: {
  data: number[];
  tone: "default" | "primary" | "danger" | "success";
}) {
  const max = Math.max(...data.map(Math.abs), 1);
  const fill =
    tone === "primary"
      ? "#F5C518"
      : tone === "danger"
        ? "#BA1A1A"
        : tone === "success"
          ? "#16A34A"
          : "#7E6510";
  return (
    <div
      className="mt-md flex items-end gap-[2px] h-10"
      role="img"
      aria-label="trend over time"
    >
      {data.map((v, i) => {
        const h = Math.max(8, Math.round((Math.abs(v) / max) * 100));
        return (
          <div
            key={i}
            className="flex-1 rounded-sm"
            style={{ height: `${h}%`, background: fill, opacity: 0.4 + (i / data.length) * 0.6 }}
          />
        );
      })}
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={"bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg " + className}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-lg">
          {title ? <h4 className="text-h3 text-on-surface">{title}</h4> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
