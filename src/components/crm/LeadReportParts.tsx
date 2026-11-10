/**
 * Display pieces of the daily lead report, shared by My Day, the team view on
 * /crm/report and Lead Handovers. Server-safe (no hooks); the interactive bits
 * are in LeadReportActions.tsx.
 *
 * Status colours (from the brief): contacted / created green, pending blue,
 * missed / overdue orange, duplicate grey.
 */
import type { HandoverCounts, LeadCounts, LeadReportSource } from "@/lib/crm-lead-report";

const TIME = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
const DAY_TIME = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});

/** "1:52 pm" in IST. */
export function istTime(iso: string): string {
  return TIME.format(new Date(iso)).toLowerCase();
}

/** "Mon 5:00 pm" in IST. */
export function istDayTime(iso: string): string {
  return DAY_TIME.format(new Date(iso)).replace(",", "").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export const TONE = {
  green: "bg-green-50 text-green-800",
  blue: "bg-blue-50 text-blue-800",
  orange: "bg-orange-50 text-orange-800",
  grey: "bg-surface-container-high text-on-surface-variant",
} as const;

export function Chip({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-sm py-[2px] text-[11px] font-bold ${TONE[tone]}`}>
      {children}
    </span>
  );
}

const HANDOVER_TONE: Record<string, { tone: keyof typeof TONE; label: string }> = {
  pending: { tone: "blue", label: "Pending" },
  created: { tone: "green", label: "Created" },
  duplicate: { tone: "grey", label: "Duplicate" },
  rejected: { tone: "grey", label: "Rejected" },
  overdue: { tone: "orange", label: "Overdue" },
};

export function HandoverStatusChip({ status, isLate }: { status: string; isLate: boolean }) {
  const s = HANDOVER_TONE[status] ?? { tone: "grey" as const, label: status };
  return (
    <span className="inline-flex items-center gap-xs">
      <Chip tone={s.tone}>{s.label}</Chip>
      {isLate && status !== "overdue" && <span className="text-[11px] font-semibold text-orange-800">late</span>}
    </span>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
  emphasise,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "green" | "blue" | "orange";
  emphasise?: boolean;
}) {
  const valueCls = tone === "green" ? "text-green-800" : tone === "blue" ? "text-blue-700" : tone === "orange" ? "text-orange-800" : "text-on-surface";
  const box = emphasise
    ? tone === "orange"
      ? "border-2 border-orange-700 bg-orange-50"
      : "border-2 border-blue-700 bg-surface-container-lowest"
    : "border border-outline-variant bg-surface-container-lowest";
  return (
    <div className={`rounded-xl p-md ${box}`}>
      <div className={`text-label-sm ${emphasise ? `font-semibold ${valueCls}` : "text-on-surface-variant"}`}>{label}</div>
      <div className={`mt-xs text-[30px] font-bold leading-tight tabular-nums ${valueCls}`}>{value}</div>
      {hint && <div className="text-caption text-on-surface-variant">{hint}</div>}
    </div>
  );
}

/** Leads judged on the day: due on it (received before the cutoff, or carried in). */
export function dueToday(t: LeadCounts): number {
  return t.contacted + t.missed + t.pending;
}

/** The five tiles of My Day; the team view passes its totals and the submitted count. */
export function ReportTiles({
  totals: t,
  handovers: h,
  cutoffLabel,
  submitted,
}: {
  totals: LeadCounts;
  handovers: HandoverCounts;
  /** "5:00 pm", or null on a day without a cutoff. */
  cutoffLabel: string | null;
  /** Team view: "2 / 3" reports generated, shown instead of the Pending tile when the day is over. */
  submitted?: string;
}) {
  const due = dueToday(t);
  const pct = due ? Math.round((t.contacted / due) * 100) : null;
  const receivedHint = [t.carriedIn ? `+${t.carriedIn} carried in` : null, t.dueLater ? `${t.dueLater} due next working day` : null]
    .filter(Boolean)
    .join(" · ");
  const settled = h.created + h.duplicate;
  return (
    <section aria-label="The day at a glance" className="grid grid-cols-2 gap-md sm:grid-cols-3 lg:grid-cols-5">
      <Tile label="Received" value={String(t.received)} hint={receivedHint || "assigned today"} />
      <Tile label="Contacted on time" value={String(t.contacted)} tone="green" hint={pct === null ? "nothing due yet" : `${pct}% of ${due} due`} />
      {submitted === undefined || t.pending > 0 ? (
        <Tile
          label="Pending"
          value={String(t.pending)}
          tone="blue"
          emphasise={t.pending > 0}
          hint={cutoffLabel ? `due by ${cutoffLabel}` : "no cutoff today"}
        />
      ) : (
        <Tile label="Reports generated" value={submitted} />
      )}
      <Tile
        label="Missed"
        value={String(t.missed)}
        tone={t.missed ? "orange" : undefined}
        emphasise={t.missed > 0}
        hint={t.late ? `${t.late} contacted late` : "not contacted by the cutoff"}
      />
      <Tile
        label="Handovers"
        value={h.given ? `${settled} / ${h.given}` : "0"}
        tone={h.overdue ? "orange" : undefined}
        hint={
          h.given
            ? [h.created ? `${h.created} created` : null, h.duplicate ? `${h.duplicate} duplicate` : null, h.rejected ? `${h.rejected} rejected` : null, h.overdue ? `${h.overdue} overdue` : null]
                .filter(Boolean)
                .join(" · ") || "waiting to be created"
            : "none given"
        }
      />
    </section>
  );
}

const th = "px-sm py-xs text-left text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant border-b border-outline-variant whitespace-nowrap";
const td = "px-sm py-sm border-b border-outline-variant/60 text-label-sm text-on-surface";
const num = "text-right tabular-nums";

/** Assigned leads by source, with a progress bar of contacted on time / due. */
export function SourceTable({ sources, totals }: { sources: LeadReportSource[]; totals: LeadCounts }) {
  if (sources.length === 0) return <p className="py-md text-center text-label-sm text-on-surface-variant">No leads assigned or due on this day.</p>;
  const carried = totals.carriedIn > 0;
  const row = (s: LeadCounts, label: string, total = false) => {
    const due = dueToday(s);
    const pct = due ? Math.round((s.contacted / due) * 100) : 0;
    const strong = total ? "font-semibold border-b-0" : "";
    return (
      <tr key={label}>
        <td className={`${td} ${strong} ${total ? "" : "font-medium"}`}>{label}</td>
        <td className={`${td} ${num} ${strong}`}>{s.received}</td>
        {carried && <td className={`${td} ${num} ${strong}`}>{s.carriedIn || "–"}</td>}
        <td className={`${td} ${num} ${strong} text-green-800`}>{s.contacted}</td>
        <td className={`${td} ${num} ${strong} ${s.pending ? "font-semibold text-blue-700" : ""}`}>{s.pending}</td>
        <td className={`${td} ${num} ${strong} ${s.missed ? "font-semibold text-orange-800" : ""}`}>
          {s.missed}
          {s.late ? <span className="font-normal text-on-surface-variant"> ({s.late} late)</span> : null}
        </td>
        <td className={`${td} ${strong} w-40`}>
          {!total && due > 0 && (
            <div className="h-2 overflow-hidden rounded bg-surface-container-high" title={`${pct}% contacted on time`}>
              <div className={`h-2 ${pct === 100 ? "bg-green-700" : "bg-blue-700"}`} style={{ width: `${pct}%` }} />
            </div>
          )}
        </td>
      </tr>
    );
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th}>Source</th>
            <th className={`${th} text-right`}>Received</th>
            {carried && <th className={`${th} text-right`}>Carried in</th>}
            <th className={`${th} text-right`}>Contacted</th>
            <th className={`${th} text-right`}>Pending</th>
            <th className={`${th} text-right`}>Missed</th>
            <th className={th}>Progress</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => row(s, s.label))}
          {row(totals, "Total", true)}
        </tbody>
      </table>
    </div>
  );
}

export const tableTh = th;
export const tableTd = td;
export const tableNum = num;
