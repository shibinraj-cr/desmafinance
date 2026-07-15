"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type EmployeeLite = { id: string; empCode: string; name: string; lateEligible: boolean };
type LateTag = "LCE" | "AL" | null;
type GridCell = {
  status: string;
  in: string | null;
  out: string | null;
  work: number | null;
  ot: number | null;
  late: number | null;
  remark: string | null;
  lateTag: LateTag;
};
/// Keys are ISO date strings (YYYY-MM-DD)
type Grid = Record<string, Record<string, GridCell>>;
type Summary = Record<
  string,
  { P: number; HD: number; A: number; WO: number; HL: number; LV: number; LCE: number; AL: number }
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

type SalaryRunSummary = {
  monthKey: string;
  recomputed: boolean;
  status: string | null;
  warnings?: string[];
};

type DateCell = { iso: string; day: number; month: number; weekday: string };

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
  canUpload,
  uploads,
  employees,
  grid,
  summary,
  lceGraceDays,
  lceGraceMinutes,
}: {
  monthKey: string;
  prevMonth: string;
  nextMonth: string;
  cycleLabel: string;
  dateCells: DateCell[];
  canUpload: boolean;
  uploads: Upload[];
  employees: EmployeeLite[];
  grid: Grid;
  summary: Summary;
  lceGraceDays: number;
  lceGraceMinutes: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(monthKey);
  const [uploadStatus, setUploadStatus] = useState<{
    msg: string;
    tone: "info" | "ok" | "err";
    months?: MonthSummary[];
    salaryRuns?: SalaryRunSummary[];
    unmatched?: string[];
    rangeStart?: string;
    rangeEnd?: string;
  } | null>(null);

  const [syncing, setSyncing] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadStatus({ msg: "Uploading & parsing…", tone: "info" });
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch("/api/hr/attendance/upload", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUploadStatus({ msg: `Failed: ${j.error || res.statusText}`, tone: "err" });
      return;
    }
    const totalInserted = (j.months as MonthSummary[]).reduce((s, m) => s + m.inserted, 0);
    setUploadStatus({
      msg: `Imported ${totalInserted} day rows across ${j.months.length} cycle(s).`,
      tone: "ok",
      months: j.months,
      salaryRuns: j.salaryRuns ?? [],
      unmatched: j.unmatchedNames ?? [],
      rangeStart: j.rangeStart ?? undefined,
      rangeEnd: j.rangeEnd ?? undefined,
    });
    if (fileRef.current) fileRef.current.value = "";
    start(() => router.refresh());
  }

  async function onSync() {
    if (syncing) return;
    setSyncing(true);
    setUploadStatus({ msg: "Fetching punches from eTimeOffice…", tone: "info" });
    try {
      // fromDate omitted → the server defaults to (and hard-floors at) the
      // 2026-07-01 cutover; toDate omitted → today.
      const res = await fetch("/api/hr/attendance/etime-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadStatus({ msg: `Sync failed: ${j.error || res.statusText}`, tone: "err" });
        return;
      }
      const totalInserted = (j.months as MonthSummary[]).reduce((s, m) => s + m.inserted, 0);
      setUploadStatus({
        msg: `Fetched ${j.fetched ?? 0} punch records; imported ${totalInserted} day rows across ${j.months.length} cycle(s). Data before ${j.cutover} left untouched.`,
        tone: "ok",
        months: j.months,
        salaryRuns: j.salaryRuns ?? [],
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
          <span className="text-label-sm text-on-surface-variant">{cycleLabel}</span>
          {canUpload && (
            <>
              <button
                type="button"
                onClick={onSync}
                disabled={syncing || pending}
                title="Fetch in/out punches from the eTimeOffice biometric cloud (from 01 Jul 2026 onward; earlier data is never modified)"
                className="ml-auto px-md py-sm rounded border border-primary text-primary font-bold disabled:opacity-50"
              >
                {syncing ? "Syncing…" : "Sync from eTimeOffice"}
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={pending || syncing}
                className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
              >
                Upload biometric report (.xls / .xlsx)
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xls,.xlsx"
                className="hidden"
                onChange={onPick}
              />
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
          Salary cycle: 26th of previous month → 25th of current month. The file can span any
          range; rows are bucketed into the matching cycle automatically.
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
            {uploadStatus.salaryRuns?.length ? (
              <ul className="mt-xs text-caption list-disc ml-md">
                {uploadStatus.salaryRuns.map((r) => (
                  <li key={r.monthKey}>
                    <strong>Salary {r.monthKey}</strong>:{" "}
                    {r.recomputed
                      ? "draft recomputed"
                      : r.status
                        ? `not recomputed (${r.status})`
                        : "no draft run found"}
                    {r.warnings?.length ? `, ${r.warnings.length} warning(s)` : ""}
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
                            c.in && c.out ? `${c.in} → ${c.out}` : null,
                            c.work ? `work ${hhmm(c.work)}` : null,
                            c.ot ? `OT ${hhmm(c.ot)}` : null,
                            c.late ? `late ${hhmm(c.late)}` : null,
                            c.lateTag ? `tag ${c.lateTag}` : null,
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
                      return (
                        <td
                          key={d.iso}
                          className={
                            "px-[1px] py-[1px] align-top " +
                            (isBoundary ? "border-l-2 border-l-primary/40" : "")
                          }
                        >
                          <div
                            title={tip}
                            className={
                              "flex flex-col items-stretch justify-start rounded text-[9px] font-bold leading-tight w-11 mx-auto " +
                              tone +
                              (missingPunch ? " ring-2 ring-orange-500" : "")
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
                      {/* Net Paid vs Unpaid (HD's 0.5 counts as unpaid; LV is paid) */}
                      <div className="text-on-surface-variant">
                        Paid <span className="text-purple-700 font-bold">{s.LV}</span>
                        {" · "}
                        Unpaid <span className="text-red-700 font-bold">{(s.A + s.HD * 0.5).toFixed(1)}</span>
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
          The Summary column shows day counts on top, Paid / Unpaid totals next, and the
          Late-Coming usage at the bottom for employees with that eligibility enabled.
        </p>
      </Section>
    </>
  );
}
