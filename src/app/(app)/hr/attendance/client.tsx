"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type EmployeeLite = { id: string; empCode: string; name: string };
type GridCell = {
  status: string;
  in: string | null;
  out: string | null;
  work: number | null;
  ot: number | null;
  remark: string | null;
};
type Grid = Record<string, Record<number, GridCell>>;
type Summary = Record<string, { P: number; HD: number; A: number; WO: number; HL: number; LV: number }>;

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

const STATUS_TONE: Record<string, string> = {
  P: "bg-green-50 text-green-700",
  HD: "bg-yellow-50 text-yellow-700",
  A: "bg-red-50 text-red-700",
  WO: "bg-surface-container text-on-surface-variant",
  HL: "bg-blue-50 text-blue-700",
  LV: "bg-purple-50 text-purple-700",
};

function hhmm(min: number | null): string {
  if (!min) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function AttendanceClient({
  monthKey,
  daysInMonth,
  canUpload,
  uploads,
  employees,
  grid,
  summary,
}: {
  monthKey: string;
  daysInMonth: number;
  canUpload: boolean;
  uploads: Upload[];
  employees: EmployeeLite[];
  grid: Grid;
  summary: Summary;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(monthKey);
  const [uploadStatus, setUploadStatus] = useState<{
    msg: string;
    tone: "info" | "ok" | "err";
    months?: MonthSummary[];
    unmatched?: string[];
    rangeStart?: string;
    rangeEnd?: string;
  } | null>(null);

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
      msg: `Imported ${totalInserted} day rows across ${j.months.length} month(s).`,
      tone: "ok",
      months: j.months,
      unmatched: j.unmatchedNames ?? [],
      rangeStart: j.rangeStart ?? undefined,
      rangeEnd: j.rangeEnd ?? undefined,
    });
    if (fileRef.current) fileRef.current.value = "";
    start(() => router.refresh());
  }

  function gotoMonth(m: string) {
    setSelectedMonth(m);
    router.push(`/hr/attendance?month=${m}`);
  }

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <>
      <Section title="">
        <div className="flex flex-wrap items-center gap-sm">
          <label className="flex items-center gap-xs text-label-sm">
            <span className="text-on-surface-variant">View month</span>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => gotoMonth(e.target.value)}
              className="px-sm py-sm rounded border border-outline-variant bg-surface"
            />
          </label>
          {canUpload && (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={pending}
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
              <span className="text-caption text-on-surface-variant">
                File can span any date range — months are detected automatically.
              </span>
            </>
          )}
        </div>
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
                    <strong>{m.monthKey}</strong>: {m.inserted} rows inserted
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
        <Section title="Uploads covering this month">
          <table className="w-full text-label-sm">
            <thead className="text-left text-on-surface-variant border-b border-outline-variant">
              <tr>
                <th className="py-sm pr-md">Filename</th>
                <th className="py-sm pr-md">Rows in this month</th>
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
        <div className="overflow-x-auto">
          <table className="text-[11px] border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 bg-surface-container z-10 px-sm py-xs text-left text-label-sm">
                  Employee
                </th>
                {days.map((d) => (
                  <th key={d} className="px-xs py-xs text-on-surface-variant w-7 text-center">
                    {d}
                  </th>
                ))}
                <th className="px-sm py-xs text-on-surface-variant text-right whitespace-nowrap">P · HD · A</th>
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
                    {days.map((d) => {
                      const c = row[d];
                      const code = c?.status ?? "";
                      const tone = STATUS_TONE[code] ?? "bg-surface-container text-on-surface-variant";
                      const tip = c
                        ? [
                            `${code}`,
                            c.in && c.out ? `${c.in} → ${c.out}` : null,
                            c.work ? `work ${hhmm(c.work)}` : null,
                            c.ot ? `OT ${hhmm(c.ot)}` : null,
                            c.remark ? `(${c.remark})` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : "no record";
                      return (
                        <td key={d} className="px-[1px] py-[1px] text-center">
                          <span
                            title={tip}
                            className={
                              "inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-bold " +
                              tone
                            }
                          >
                            {code || "·"}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-sm py-xs text-right whitespace-nowrap text-label-sm">
                      <span className="text-green-700 font-bold">{s.P}</span>
                      <span className="text-on-surface-variant"> · </span>
                      <span className="text-yellow-700 font-bold">{s.HD}</span>
                      <span className="text-on-surface-variant"> · </span>
                      <span className="text-red-700 font-bold">{s.A}</span>
                    </td>
                  </tr>
                );
              })}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={daysInMonth + 2} className="py-lg text-center text-on-surface-variant">
                    No active employees on the master.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-caption text-on-surface-variant mt-md">
          Legend: <span className="font-bold text-green-700">P</span> Present ·{" "}
          <span className="font-bold text-yellow-700">HD</span> Half-day (auto when work &lt; 4h) ·{" "}
          <span className="font-bold text-red-700">A</span> Absent ·{" "}
          <span className="font-bold text-on-surface-variant">WO</span> Week-off ·{" "}
          <span className="font-bold text-blue-700">HL</span> Holiday ·{" "}
          <span className="font-bold text-purple-700">LV</span> Leave. Hover a cell for in/out, work
          hours, OT, and biometric remark.
        </p>
      </Section>
    </>
  );
}
