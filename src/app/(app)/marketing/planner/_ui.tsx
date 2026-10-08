import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  DISPLAY_STATUS_LABELS,
  MKT_PLANNER_HREF,
  PACE_LABELS,
  SERIES_COMMITTED,
  SERIES_SPENT,
  fyName,
  type DisplayStatus,
  type Pace,
} from "@/lib/mkt-planner-shared";
import { FySelect } from "./_fy-select";

/**
 * Presentational pieces shared by the planner's server pages and client
 * components. No hooks here, so both can import it. Colours come from the
 * `--lp-*` Darkroom variables the planner layout provides.
 */

export const cardStyle: CSSProperties = {
  backgroundColor: "var(--lp-surface-container)",
  borderColor: "var(--lp-outline-variant)",
};

export const inputStyle: CSSProperties = {
  backgroundColor: "var(--lp-surface-container-high)",
  borderColor: "var(--lp-outline-variant)",
  color: "var(--lp-on-surface)",
};

export const inputClass =
  "w-full rounded-[8px] px-[10px] py-[8px] text-[13px] border outline-none focus:border-[#facc15] min-h-[40px]";

export const primaryBtnClass =
  "inline-flex items-center justify-center gap-[6px] rounded-[8px] px-[16px] min-h-[40px] text-[13px] font-bold disabled:opacity-50";
export const primaryBtnStyle: CSSProperties = {
  backgroundColor: "var(--lp-primary)",
  color: "var(--lp-on-primary)",
};

export const ghostBtnClass =
  "inline-flex items-center justify-center gap-[6px] rounded-[8px] px-[14px] min-h-[40px] text-[13px] font-semibold border disabled:opacity-50";
export const ghostBtnStyle: CSSProperties = {
  backgroundColor: "var(--lp-surface-container)",
  borderColor: "var(--lp-outline-variant)",
  color: "var(--lp-on-surface)",
};

export const mutedText: CSSProperties = { color: "var(--lp-on-surface-variant)" };
export const faintText: CSSProperties = { color: "var(--lp-outline)" };

export function Icon({ name, size = 18, style }: { name: string; size?: number; style?: CSSProperties }) {
  return (
    <span className="material-symbols-outlined shrink-0" aria-hidden="true" style={{ fontSize: size, ...style }}>
      {name}
    </span>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  style,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={`rounded-[12px] border p-[18px] flex flex-col gap-[12px] min-w-0 ${className}`} style={{ ...cardStyle, ...style }}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-[10px]">
          <div className="min-w-0">
            {title && <h2 className="font-display text-[16px] font-semibold">{title}</h2>}
            {subtitle && (
              <p className="text-[12px] mt-[3px]" style={faintText}>
                {subtitle}
              </p>
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Spent + committed bar against a whole, with an optional "year gone" marker. */
export function Meter({
  spentPct,
  commPct,
  markerPct,
  height = 8,
  title,
}: {
  spentPct: number;
  commPct: number;
  markerPct?: number;
  height?: number;
  title?: string;
}) {
  const s = Math.max(0, Math.min(100, spentPct));
  const c = Math.max(0, Math.min(100 - s, commPct));
  return (
    <div
      title={title}
      className="relative w-full flex gap-[2px]"
      style={{ height, borderRadius: height / 2, backgroundColor: "var(--lp-surface-container-high)" }}
    >
      {s > 0 && <div style={{ width: `${s}%`, backgroundColor: SERIES_SPENT, borderRadius: `${height / 2}px 0 0 ${height / 2}px` }} />}
      {c > 0 && <div style={{ width: `${c}%`, backgroundColor: SERIES_COMMITTED }} />}
      {markerPct !== undefined && (
        <div
          aria-hidden="true"
          className="absolute"
          style={{ left: `${Math.min(100, markerPct)}%`, top: -3, bottom: -3, width: 2, backgroundColor: "var(--lp-on-surface)" }}
        />
      )}
    </div>
  );
}

export function Swatch({ color, outline }: { color?: string; outline?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-[10px] h-[10px] rounded-[2px] shrink-0"
      style={outline ? { border: "1px solid var(--lp-outline)" } : { backgroundColor: color }}
    />
  );
}

/** Style of a status, shared by pills and timeline bars. */
export function statusLook(s: DisplayStatus): { bg: string; fg: string; border: string; strike?: boolean } {
  switch (s) {
    case "live":
      return { bg: "#facc15", fg: "#3c2f00", border: "1px solid #facc15" };
    case "approved":
      return { bg: "#4d4632", fg: "#ebe2d0", border: "1px solid #9a9078" };
    case "awaiting":
      return { bg: "transparent", fg: "#ffb693", border: "1.5px dashed #ffb693" };
    case "draft":
      return { bg: "transparent", fg: "#d1c6ab", border: "1px dotted #9a9078" };
    case "idea":
      return { bg: "transparent", fg: "#9a9078", border: "1px dashed #4d4632" };
    case "done":
      return { bg: "#2e2a1e", fg: "#9a9078", border: "1px solid #2e2a1e" };
    case "cancelled":
      return { bg: "transparent", fg: "#9a9078", border: "1px solid #2e2a1e", strike: true };
  }
}

export function StatusPill({ status }: { status: DisplayStatus }) {
  const l = statusLook(status);
  return (
    <span
      className="inline-flex items-center rounded-full px-[10px] py-[2px] text-[11px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: l.bg, color: l.fg, border: l.border, textDecoration: l.strike ? "line-through" : undefined }}
    >
      {DISPLAY_STATUS_LABELS[status]}
    </span>
  );
}

const PACE_LOOK: Record<Pace, { icon: string; color: string }> = {
  over_budget: { icon: "error", color: "var(--lp-error)" },
  hot: { icon: "trending_up", color: "var(--lp-orange)" },
  on_pace: { icon: "check_circle", color: "var(--lp-cyan)" },
  under: { icon: "south", color: "var(--lp-on-surface-variant)" },
  no_plan: { icon: "remove", color: "var(--lp-outline)" },
};

export function PaceBadge({ pace }: { pace: Pace }) {
  const l = PACE_LOOK[pace];
  return (
    <span className="inline-flex items-center gap-[5px] text-[12px] font-semibold whitespace-nowrap" style={{ color: l.color }}>
      <Icon name={l.icon} size={15} />
      {PACE_LABELS[pace]}
    </span>
  );
}

export type PlannerTab = "overview" | "timeline" | "budget" | "channels";

export function PlannerHeader({
  tab,
  fy,
  fys,
  admin,
  actions,
  subtitle,
}: {
  tab: PlannerTab;
  fy: number;
  fys: number[];
  admin: boolean;
  actions?: ReactNode;
  subtitle?: ReactNode;
}) {
  const tabs: { key: PlannerTab; label: string; href: string }[] = [
    { key: "overview", label: "Overview", href: `${MKT_PLANNER_HREF}?fy=${fy}` },
    { key: "timeline", label: "Planner", href: `${MKT_PLANNER_HREF}/timeline?fy=${fy}` },
    { key: "budget", label: "Budget & Spend", href: `${MKT_PLANNER_HREF}/budget?fy=${fy}` },
    ...(admin ? [{ key: "channels" as const, label: "Channels", href: `${MKT_PLANNER_HREF}/channels?fy=${fy}` }] : []),
  ];
  return (
    <div className="flex flex-col gap-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[14px]">
        <div className="min-w-0 flex flex-col gap-[4px]">
          <p className="text-[12px]" style={faintText}>
            Marketing / Content
          </p>
          <h1 className="font-display text-[26px] font-semibold leading-tight">Marketing &amp; Branding Planner</h1>
          <p className="text-[13px]" style={mutedText}>
            {subtitle ?? <>Plan campaigns and brand work, then track every rupee against the year&apos;s budget · {fyName(fy)}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          <FySelect fy={fy} fys={fys} />
          {actions}
        </div>
      </header>
      <nav aria-label="Planner sections" className="flex flex-wrap gap-[2px] border-b" style={{ borderColor: "var(--lp-surface-container-high)" }}>
        {tabs.map((t) => {
          const active = t.key === tab;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className="px-[14px] py-[10px] text-[14px] -mb-px"
              style={{
                color: active ? "var(--lp-primary)" : "var(--lp-on-surface-variant)",
                fontWeight: active ? 600 : 400,
                borderBottom: active ? "2px solid var(--lp-primary)" : "2px solid transparent",
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
