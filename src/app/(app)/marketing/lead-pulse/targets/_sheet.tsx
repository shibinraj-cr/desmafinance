import Link from "next/link";
import { todayIst } from "@/lib/lead-pulse-dates";

/**
 * Chrome shared by the three L2 target sheet tabs — Service targets, Minimum &
 * slabs, Teams: the section tabs, the month picker and the supervisor-only
 * notice. Every tab keeps the chosen month in `?year=&month=`.
 */

const TABS = [
  { key: "service", href: "/marketing/lead-pulse/targets", label: "Service targets" },
  { key: "incentive", href: "/marketing/lead-pulse/targets/incentive", label: "Minimum & slabs" },
  { key: "teams", href: "/marketing/lead-pulse/targets/teams", label: "Teams" },
] as const;

export type SheetTab = (typeof TABS)[number]["key"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The sheet's month from the query string, defaulting to the current IST month. */
export function sheetMonth(searchParams: { year?: string; month?: string }): { year: number; month: number } {
  const today = todayIst();
  const y = Number(searchParams.year);
  const m = Number(searchParams.month);
  return {
    year: Number.isInteger(y) && y >= 2024 && y <= 2100 ? y : Number(today.slice(0, 4)),
    month: Number.isInteger(m) && m >= 1 && m <= 12 ? m : Number(today.slice(5, 7)),
  };
}

export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function monthLabel(year: number, month: number, style: "long" | "short" = "long"): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: style,
    year: "numeric",
    timeZone: "UTC",
  });
}

export function SheetTabs({ active, year, month }: { active: SheetTab; year: number; month: number }) {
  return (
    <nav
      aria-label="Target sheet sections"
      className="flex flex-wrap gap-[4px] p-[3px] rounded-[10px] border"
      style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
    >
      {TABS.map((t) => {
        const current = t.key === active;
        return (
          <Link
            key={t.key}
            href={`${t.href}?year=${year}&month=${month}`}
            aria-current={current ? "page" : undefined}
            className="min-h-[36px] inline-flex items-center px-[14px] rounded-[8px] text-[13px] font-semibold"
            style={
              current
                ? { backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }
                : { color: "var(--lp-on-surface-variant)" }
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Year + month picker — a plain GET form back to the same tab. */
export function MonthForm({ action, year, month }: { action: string; year: number; month: number }) {
  return (
    <form
      action={action}
      method="get"
      className="flex flex-wrap items-center gap-[8px] rounded-[12px] p-[12px] border"
      style={{
        backgroundColor: "var(--lp-surface-container)",
        borderColor: "var(--lp-outline-variant)",
      }}
    >
      <select
        name="year"
        aria-label="Year"
        defaultValue={String(year)}
        className="h-[36px] px-[10px] rounded-[8px] text-[13px]"
      >
        {[year - 1, year, year + 1].map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <select
        name="month"
        aria-label="Month"
        defaultValue={String(month)}
        className="h-[36px] px-[10px] rounded-[8px] text-[13px]"
      >
        {MONTHS.map((l, i) => (
          <option key={l} value={i + 1}>
            {l}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="h-[36px] px-[14px] rounded-[8px] text-[13px] font-semibold"
        style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
      >
        Apply
      </button>
    </form>
  );
}

export function SupervisorOnly() {
  return (
    <div className="px-[24px] py-[40px] max-w-2xl mx-auto">
      <div
        className="rounded-[12px] p-[24px] border"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
        }}
      >
        <p style={{ color: "var(--lp-on-surface-variant)" }}>
          Only supervisors and admins can set monthly L2 BDE targets.
        </p>
      </div>
    </div>
  );
}

/** Banner on a closed month: read-only, or an admin editing settled pay. */
export function ClosedMonthNote({ label, canEdit }: { label: string; canEdit: boolean }) {
  return (
    <p
      role="note"
      className="rounded-[10px] px-[16px] py-[10px] text-[13px] border"
      style={{ borderColor: "var(--lp-orange)", color: "var(--lp-orange)" }}
    >
      {canEdit
        ? `${label} is closed. You can still change it as an admin, but it changes what BDEs earned that month.`
        : `${label} is closed, so its incentive setup is read-only. Ask an admin if it needs a correction.`}
    </p>
  );
}
