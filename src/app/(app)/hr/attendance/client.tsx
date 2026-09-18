"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type EmployeeLite = { id: string; empCode: string; name: string; lateEligible: boolean };
type LateTag = "LCE" | "AL" | null;
type GridCell = {
  /// HrAttendanceDay id — the handle POST /api/hr/attendance/decide works on.
  id: string;
  status: string;
  in: string | null;
  out: string | null;
  work: number | null;
  ot: number | null;
  late: number | null;
  remark: string | null;
  lateTag: LateTag;
  /// "AM" / "PM" when an approved half-day leave declared which half.
  halfSession: string | null;
  /// true / false when HR ruled on whether the half-day is paid; null when no
  /// such ruling exists (plain 0.5-day loss-of-pay).
  halfPaid: boolean | null;
  paid: number; // paid-leave portion of this day covered by the allocation (0 / 0.5 / 1)
};
/// Keys are ISO date strings (YYYY-MM-DD)
type Grid = Record<string, Record<string, GridCell>>;

/**
 * The decisions POST /api/hr/attendance/decide accepts, in the order HR reaches
 * for them. The route has always supported all six (and batches of up to 500
 * days); until now nothing in the product called it, so an absence could only
 * become paid leave if the employee happened to file a regularization request.
 */
const DECISIONS = [
  { code: "paid", label: "Paid leave", hint: "Marks the day LV — deducted from the leave balance, no loss of pay. An existing half-day stays HD and is flagged paid." },
  { code: "unpaid", label: "Unpaid (LOP)", hint: "Marks the day A — loss of pay. An existing half-day stays HD with 0.5 day docked." },
  { code: "half_day", label: "Half day", hint: "Marks the day HD." },
  { code: "on_duty", label: "On duty", hint: "Off-site work — counts as present (OD)." },
  { code: "regularized", label: "Regularized", hint: "Corrected via the regularization workflow (REG, treated as present)." },
  { code: "reset", label: "Reset to biometric", hint: "Reverts to the original biometric status, discarding this decision." },
] as const;

type DecisionCode = (typeof DECISIONS)[number]["code"];
type Summary = Record<
  string,
  { P: number; HD: number; A: number; WO: number; HL: number; LV: number; LCE: number; AL: number; PL: number }
>;

type Upload = {
  id: string;
  filename: string;
  rowCount: number;
  uploadedAt: string;
  uploadedBy: string;
};

type MonthSummary = {
  monthKey: string;
  uploadId: string;
  inserted: number;
  unmatched: number;
  unmatchedNames: string[];
};

type DateCell = { iso: string; day: number; month: number; weekday: string };
type Subscription = {
  expiry: string | null;
  daysLeft: number | null;
  tone: "none" | "ok" | "warn" | "expired";
  label: string;
};

const STATUS_TONE: Record<string, string> = {
  P: "bg-green-50 text-green-700",
  HD: "bg-yellow-50 text-yellow-700",
  A: "bg-red-50 text-red-700",
  WO: "bg-surface-container text-on-surface-variant",
  HL: "bg-blue-50 text-blue-700",
  LV: "bg-purple-50 text-purple-700",
};

const MONTH_LABEL = [
  "",
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function hhmm(min: number | null): string {
  if (!min) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function AttendanceClient({
  monthKey,
  prevMonth,
  nextMonth,
  cycleLabel,
  dateCells,
  canDecide,
  canUpload,
  uploads,
  employees,
  grid,
  summary,
  lceGraceDays,
  lceGraceMinutes,
  subscription,
}: {
  monthKey: string;
  prevMonth: string;
  nextMonth: string;
  cycleLabel: string;
  dateCells: DateCell[];
  canUpload: boolean;
  canDecide: boolean;
  uploads: Upload[];
  employees: EmployeeLite[];
  grid: Grid;
  summary: Summary;
  lceGraceDays: number;
  lceGraceMinutes: number;
  subscription: Subscription;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selectedMonth, setSelectedMonth] = useState(monthKey);
  const [uploadStatus, setUploadStatus] = useState<{
    msg: string;
    tone: "info" | "ok" | "err";
    months?: MonthSummary[];
    unmatched?: string[];
    rangeStart?: string;
    rangeEnd?: string;
  } | null>(null);

  const [syncing, setSyncing] = useState(false);

  // Cell selection for the decide action. Keyed by HrAttendanceDay id, with the
  // label kept alongside so the action bar can say what is about to change
  // without walking the grid again.
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decideMsg, setDecideMsg] = useState<{ msg: string; tone: "ok" | "err" } | null>(null);

  function toggleCell(dayId: string, label: string) {
    setDecideMsg(null);
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(dayId)) next.delete(dayId);
      else next.set(dayId, label);
      return next;
    });
  }

  async function applyDecision(decision: DecisionCode) {
    if (deciding || picked.size === 0) return;
    setDeciding(true);
    setDecideMsg(null);
    try {
      const res = await fetch("/api/hr/attendance/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayIds: [...picked.keys()],
          decision,
          note: note.trim() || null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The route refuses a batch as a whole when it contains the approver's
        // own day, or an HR approver's day they may not decide — surface that
        // reason rather than a generic failure.
        setDecideMsg({ msg: j.error || "decision failed", tone: "err" });
        return;
      }
      const label = DECISIONS.find((d) => d.code === decision)?.label ?? decision;
      setDecideMsg({ msg: `${label} applied to ${picked.size} day(s).`, tone: "ok" });
      setPicked(new Map());
      setNote("");
      start(() => router.refresh());
    } catch {
      setDecideMsg({ msg: "decision failed", tone: "err" });
    } finally {
      setDeciding(false);
    }
  }

  async function onSync() {
    if (syncing) return;
    setSyncing(true);
    setUploadStatus({ msg: "Fetching punches from eTimeOffice…", tone: "info" });
    try {
      // fromDate omitted → the server defaults to (and hard-floors at) the
      // cutover; toDate omitted → today.
      const res = await fetch("/api/hr/attendance/etime-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadStatus({ msg: `Sync failed: ${j.message || j.error || res.statusText}`, tone: "err" });
        return;
      }
      const totalInserted = ((j.months ?? []) as MonthSummary[]).reduce((s, m) => s + m.inserted, 0);
      setUploadStatus({
        msg: `Fetched ${j.fetched ?? 0} punch records; imported ${totalInserted} day rows across ${j.months?.length ?? 0} cycle(s). Data before ${j.cutover} left untouched.`,
        tone: "ok",
        months: j.months,
        unmatched: j.unmatchedNames ?? [],
        rangeStart: j.rangeStart ?? undefined,
        rangeEnd: j.rangeEnd ?? undefined,
      });
      start(() => router.refresh());
    } catch (err) {
      setUploadStatus({ msg: `Sync failed: ${err instanceof Error ? err.message : "network error"}`, tone: "err" });
    } finally {
      setSyncing(false);
    }
  }

  function gotoMonth(m: string) {
    setSelectedMonth(m);
    router.push(`/hr/attendance?month=${m}`);
  }

  // Identify the month boundary within the date strip so we can paint a separator.
  const firstMonth = dateCells[0]?.month;

  const subExpiryLabel = subscription.expiry
    ? new Date(subscription.expiry + "T00:00:00Z").toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;
  const subTone =
    subscription.tone === "expired"
      ? "bg-red-100 text-red-800 border-red-300"
      : subscription.tone === "warn"
        ? "bg-amber-100 text-amber-800 border-amber-300"
        : "bg-surface-container text-on-surface-variant border-outline-variant";

  return (
    <>
      {subscription.tone !== "none" && (
        <div
          className={
            "flex flex-wrap items-center gap-xs rounded-lg border px-md py-sm text-label-sm " + subTone
          }
        >
          <span className="material-symbols-outlined text-[18px]">fingerprint</span>
          <span className="font-semibold">Biometric subscription:</span>
          <span>{subscription.label}</span>
          {subExpiryLabel && <span className="opacity-80">· renews {subExpiryLabel}</span>}
          {canUpload && (
            <a href="/hr/attendance/settings" className="ml-auto underline font-medium">
              {subscription.tone === "ok" ? "Manage" : "Renew now →"}
            </a>
          )}
        </div>
      )}
      {subscription.tone === "none" && canUpload && (
        <div className="rounded-lg border border-dashed border-outline-variant px-md py-sm text-label-sm text-on-surface-variant">
          Set the biometric subscription renewal date to enable expiry alerts —{" "}
          <a href="/hr/attendance/settings" className="text-primary underline">
            Biometric Sync settings
          </a>
          .
        </div>
      )}
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
          <span className="text-label-sm text-on-surface-variant">{cycleLabel}</span>
          {canUpload && (
            <>
              <button
                type="button"
                onClick={onSync}
                disabled={syncing || pending}
                title="Fetch in/out punches from the eTimeOffice biometric cloud (earlier data is never modified)"
                className="ml-auto px-md py-sm rounded border border-primary text-primary font-bold disabled:opacity-50"
              >
                {syncing ? "Syncing…" : "Sync from eTimeOffice"}
              </button>
              <a
                href="/hr/attendance/settings"
                title="Configure the eTimeOffice biometric sync"
                className="px-sm py-sm rounded border border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
              >
                ⚙
              </a>
            </>
          )}
        </div>
        <p className="text-caption text-on-surface-variant mt-sm">
          Salary cycle: 26th of previous month → 25th of current month. Attendance is pulled
          automatically from the eTimeOffice biometric cloud.
        </p>
        {uploadStatus && (
          <div
            className={
              "mt-md rounded p-sm text-label-sm " +
              (uploadStatus.tone === "ok"
                ? "bg-green-50 text-green-800"
                : uploadStatus.tone === "err"
                  ? "bg-red-50 text-red-800"
                  : "bg-surface-container text-on-surface")
            }
          >
            <p className="font-semibold">{uploadStatus.msg}</p>
            {uploadStatus.rangeStart && uploadStatus.rangeEnd && (
              <p className="text-caption">
                Range: {uploadStatus.rangeStart} → {uploadStatus.rangeEnd}
              </p>
            )}
            {uploadStatus.months?.length ? (
              <ul className="mt-xs text-caption list-disc ml-md">
                {uploadStatus.months.map((m) => (
                  <li key={m.monthKey}>
                    <strong>Cycle {m.monthKey}</strong>: {m.inserted} rows inserted
                    {m.unmatched > 0 ? `, ${m.unmatched} unmatched` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            {uploadStatus.unmatched && uploadStatus.unmatched.length > 0 && (
              <p className="text-caption mt-xs">
                <strong>Unmatched names:</strong> {uploadStatus.unmatched.join(", ")}
              </p>
            )}
          </div>
        )}
      </Section>

      {uploads.length > 0 && (
        <Section title="Uploads for this cycle">
          <table className="w-full text-label-sm">
            <thead className="text-left text-on-surface-variant border-b border-outline-variant">
              <tr>
                <th className="py-sm pr-md">Filename</th>
                <th className="py-sm pr-md">Rows for this cycle</th>
                <th className="py-sm pr-md">By</th>
                <th className="py-sm pr-md">When</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id} className="border-b border-outline-variant last:border-0">
                  <td className="py-sm pr-md">{u.filename}</td>
                  <td className="py-sm pr-md">{u.rowCount}</td>
                  <td className="py-sm pr-md">{u.uploadedBy}</td>
                  <td className="py-sm pr-md text-on-surface-variant">
                    {new Date(u.uploadedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="Attendance grid">
        <div className="overflow-auto max-h-[70vh]">
          <table className="text-[11px] border-collapse">
            <thead>
              <tr>
                <th
                  rowSpan={2}
                  className="sticky left-0 top-0 bg-surface-container z-30 px-sm py-xs text-left text-label-sm"
                >
                  Employee
                </th>
                {dateCells.map((d) => {
                  const isBoundary = d.day === 1; // start of new calendar month within the cycle
                  return (
                    <th
                      key={d.iso}
                      className={
                        "sticky top-0 z-20 bg-surface-container px-xs py-xs text-on-surface-variant w-12 text-center " +
                        (isBoundary ? "border-l-2 border-l-primary/60" : "")
                      }
                      title={d.iso}
                    >
                      <div className="text-[9px] font-normal text-on-surface-variant">
                        {d.day === 26 || d.day === 1 ? MONTH_LABEL[d.month] : ""}
                      </div>
                      <div className="text-[12px] font-semibold text-on-surface">{d.day}</div>
                      <div className="text-[9px] font-normal text-on-surface-variant">
                        {d.weekday[0]}
                      </div>
                    </th>
                  );
                })}
                <th
                  rowSpan={2}
                  className="sticky top-0 z-20 bg-surface-container px-sm py-xs text-on-surface-variant text-right whitespace-nowrap"
                >
                  Summary
                </th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const row = grid[e.id] ?? {};
                const s = summary[e.id] ?? { P: 0, HD: 0, A: 0, WO: 0, HL: 0, LV: 0 };
                return (
                  <tr key={e.id} className="border-t border-outline-variant">
                    <td className="sticky left-0 bg-surface z-10 px-sm py-xs whitespace-nowrap text-label-sm font-medium">
                      {e.empCode} · {e.name}
                    </td>
                    {dateCells.map((d) => {
                      const c = row[d.iso];
                      // A present day flagged AL (late beyond the allowance) is a
                      // payroll half-day — show it as HD here too (the AL badge
                      // below still explains why). LCE days stay Present.
                      const code = c ? (c.status === "P" && c.lateTag === "AL" ? "HD" : c.status) : "";
                      const tone = STATUS_TONE[code] ?? "bg-surface-container text-on-surface-variant";
                      const isBoundary = d.day === 1;
                      // Missing punch: exactly one of in/out recorded — the
                      // employee clocked one side only. Highlighted so HR (and
                      // the employee, in My Attendance) can get it regularized.
                      const missingPunch = !!c && !!c.in !== !!c.out;
                      const tip = c
                        ? [
                            `${d.iso} ${code}`,
                            missingPunch ? "⚠ punch missing" : null,
                            c.halfSession === "AM"
                              ? "first half off (approved)"
                              : c.halfSession === "PM"
                                ? "second half off (approved)"
                                : null,
                            c.halfPaid === true
                              ? "half-day PAID (0.5 from leave balance)"
                              : c.halfPaid === false
                                ? "half-day unpaid (0.5 loss of pay)"
                                : null,
                            c.in && c.out ? `${c.in} → ${c.out}` : null,
                            c.work ? `work ${hhmm(c.work)}` : null,
                            c.ot ? `OT ${hhmm(c.ot)}` : null,
                            c.late ? `late ${hhmm(c.late)}` : null,
                            c.lateTag ? `tag ${c.lateTag}` : null,
                            c.paid > 0 ? `paid leave ${c.paid} (covered by allocation)` : null,
                            c.remark ? `(${c.remark})` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : `${d.iso} — no record`;
                      const hasPunch = c && (c.in || c.out);
                      const tagTone =
                        c?.lateTag === "LCE"
                          ? "bg-amber-200 text-amber-900"
                          : c?.lateTag === "AL"
                            ? "bg-red-200 text-red-900"
                            : "";
                      // A cell is actionable only when it has a day row behind
                      // it — there is nothing to decide on a date the employee
                      // has no record for.
                      const selectable = canDecide && !!c;
                      const isPicked = !!c && picked.has(c.id);
                      return (
                        <td
                          key={d.iso}
                          className={
                            "px-[1px] py-[1px] align-top " +
                            (isBoundary ? "border-l-2 border-l-primary/40" : "")
                          }
                        >
                          <div
                            title={selectable ? `${tip} · click to select` : tip}
                            role={selectable ? "button" : undefined}
                            tabIndex={selectable ? 0 : undefined}
                            aria-pressed={selectable ? isPicked : undefined}
                            aria-label={selectable ? `${e.name} ${d.iso} ${code}` : undefined}
                            onClick={selectable ? () => toggleCell(c!.id, `${e.empCode} ${d.iso}`) : undefined}
                            onKeyDown={
                              selectable
                                ? (ev) => {
                                    if (ev.key === "Enter" || ev.key === " ") {
                                      ev.preventDefault();
                                      toggleCell(c!.id, `${e.empCode} ${d.iso}`);
                                    }
                                  }
                                : undefined
                            }
                            className={
                              "flex flex-col items-stretch justify-start rounded text-[9px] font-bold leading-tight w-11 mx-auto " +
                              tone +
                              (missingPunch ? " ring-2 ring-orange-500" : "") +
                              (selectable ? " cursor-pointer" : "") +
                              (isPicked ? " outline outline-2 outline-offset-1 outline-primary" : "")
                            }
                          >
                            <span className="text-center text-[10px] py-[1px] border-b border-current/10">
                              {code || "·"}
                            </span>
                            {hasPunch ? (
                              <span className="font-normal text-[9px] text-center py-[1px] tabular-nums">
                                {c?.in ?? "—"}
                                <br />
                                {c?.out ?? "—"}
                              </span>
                            ) : (
                              <span className="font-normal text-[9px] text-center py-[1px] opacity-50">
                                &nbsp;
                                <br />&nbsp;
                              </span>
                            )}
                            {missingPunch && (
                              <span
                                className="text-[8px] font-extrabold text-center py-[1px] border-t border-current/10 bg-orange-200 text-orange-900"
                                title="Punch missing — only one of in/out recorded"
                              >
                                MP
                              </span>
                            )}
                            {c?.lateTag && (
                              <span
                                className={
                                  "text-[8px] font-extrabold text-center py-[1px] border-t border-current/10 " +
                                  tagTone
                                }
                                title={
                                  c.lateTag === "LCE"
                                    ? `LCE — within 30-min grace (Late-Coming Eligibility)`
                                    : `AL — Arrived Late beyond grace or quota`
                                }
                              >
                                {c.lateTag}
                              </span>
                            )}
                            {!!c && c.paid > 0 && (
                              <span
                                className="text-[8px] font-extrabold text-center py-[1px] border-t border-current/10 bg-emerald-200 text-emerald-900"
                                title={`Paid leave — ${c.paid} day covered by the monthly allocation (would otherwise be loss-of-pay)`}
                              >
                                {c.paid < 1 ? `PL·${c.paid}` : "PL"}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-sm py-xs text-right whitespace-nowrap text-[11px] leading-tight">
                      {/* Day counts (one row per biometric/HR-classified day) */}
                      <div>
                        <span className="text-green-700 font-bold">P {s.P}</span>
                        <span className="text-on-surface-variant"> · </span>
                        <span className="text-yellow-700 font-bold">HD {(s.HD * 0.5).toFixed(1)}</span>
                        <span className="text-on-surface-variant"> · </span>
                        <span className="text-purple-700 font-bold">LV {s.LV}</span>
                        <span className="text-on-surface-variant"> · </span>
                        <span className="text-red-700 font-bold">A {s.A}</span>
                      </div>
                      {/* Net Paid vs Unpaid. Loss-of-pay = A + HD·0.5 (HD already
                          includes AL half-days); the monthly paid-leave allocation
                          covers PL of it, so Unpaid = LOP − PL. Paid = LV + PL. */}
                      <div className="text-on-surface-variant">
                        Paid <span className="text-purple-700 font-bold">{(s.LV + s.PL).toFixed(1)}</span>
                        {s.PL > 0 && <span className="text-emerald-700"> (PL {s.PL.toFixed(1)})</span>}
                        {" · "}
                        Unpaid <span className="text-red-700 font-bold">{Math.max(0, s.A + s.HD * 0.5 - s.PL).toFixed(1)}</span>
                      </div>
                      {/* Late-coming summary */}
                      {(s.LCE > 0 || s.AL > 0 || e.lateEligible) && (
                        <div
                          className="text-on-surface-variant"
                          title={
                            e.lateEligible
                              ? `Late-Coming Eligible: 10-${lceGraceMinutes} min window × ${lceGraceDays} days/cycle (≤10 min is on-time)`
                              : "Not eligible for LCE — late beyond 10 min counts as AL"
                          }
                        >
                          {e.lateEligible ? (
                            <>
                              LCE <span className="text-amber-700 font-bold">{s.LCE}/{lceGraceDays}</span>
                              {" · "}
                              AL <span className="text-red-700 font-bold">{s.AL}</span>
                            </>
                          ) : (
                            <>
                              AL <span className="text-red-700 font-bold">{s.AL}</span>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={dateCells.length + 2} className="py-lg text-center text-on-surface-variant">
                    No active employees on the master.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {canDecide && (
          <p className="text-caption text-on-surface-variant mt-md">
            Click any day to select it — pick as many as you like, across employees, then choose
            what to record. A decision applies to the whole selection at once.
          </p>
        )}
        {decideMsg && (
          <p
            className={
              "text-label-sm mt-sm font-semibold " +
              (decideMsg.tone === "ok" ? "text-green-700" : "text-red-700")
            }
          >
            {decideMsg.msg}
          </p>
        )}
        <p className="text-caption text-on-surface-variant mt-md">
          Cycle starts {dateCells[0]?.iso} · ends {dateCells[dateCells.length - 1]?.iso}. A
          highlighted column boundary marks the calendar-month rollover. Legend:{" "}
          <span className="font-bold text-green-700">P</span> Present ·{" "}
          <span className="font-bold text-yellow-700">HD</span> Half-day (×0.5) ·{" "}
          <span className="font-bold text-red-700">A</span> Absent (unpaid) ·{" "}
          <span className="font-bold text-on-surface-variant">WO</span> Week-off ·{" "}
          <span className="font-bold text-blue-700">HL</span> Holiday ·{" "}
          <span className="font-bold text-purple-700">LV</span> Paid leave.
          {" "}<span className="font-bold text-amber-700">LCE</span> Late-Coming Eligibility used
          (≤30 min late, within 3 days/cycle).
          {" "}<span className="font-bold text-red-700">AL</span> Arrived Late beyond grace or
          quota.
          {" "}<span className="font-bold text-orange-700">MP</span> (orange ring) Missing punch —
          only one of in/out recorded; needs a regularization.
          {" "}<span className="font-bold text-emerald-700">PL</span> Paid leave — the day&apos;s
          loss-of-pay is covered by the employee&apos;s monthly paid-leave allocation (earliest
          first); it is paid, not docked.
          The Summary column shows day counts on top, Paid / Unpaid totals next (Paid includes
          the PL coverage), and the Late-Coming usage at the bottom for employees with that
          eligibility enabled.
        </p>
      </Section>

      {/* Decide bar — appears only with a live selection, pinned to the bottom so
          it stays reachable while scrolling a wide cycle grid. */}
      {canDecide && picked.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-outline-variant bg-surface/95 backdrop-blur px-margin py-md shadow-lg">
          <div className="flex flex-wrap items-center gap-sm">
            <span className="text-label-sm font-bold whitespace-nowrap">
              {picked.size} day{picked.size === 1 ? "" : "s"} selected
            </span>
            <button
              onClick={() => setPicked(new Map())}
              className="text-label-sm underline text-on-surface-variant"
            >
              Clear
            </button>
            <input
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              placeholder="Note (optional) — recorded on every selected day"
              className="flex-1 min-w-[200px] px-sm py-xs rounded border border-outline-variant bg-surface text-label-sm"
            />
            <div className="flex flex-wrap gap-xs">
              {DECISIONS.map((dec) => (
                <button
                  key={dec.code}
                  disabled={deciding}
                  title={dec.hint}
                  onClick={() => applyDecision(dec.code)}
                  className={
                    "px-sm py-xs rounded text-label-sm font-bold disabled:opacity-50 " +
                    (dec.code === "paid"
                      ? "bg-purple-600 text-white"
                      : dec.code === "unpaid"
                        ? "bg-red-600 text-white"
                        : dec.code === "reset"
                          ? "bg-surface-container text-on-surface-variant"
                          : "bg-primary text-on-primary")
                  }
                >
                  {dec.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-caption text-on-surface-variant mt-xs">
            {[...picked.values()].slice(0, 6).join(", ")}
            {picked.size > 6 ? ` +${picked.size - 6} more` : ""}
          </p>
        </div>
      )}
    </>
  );
}
