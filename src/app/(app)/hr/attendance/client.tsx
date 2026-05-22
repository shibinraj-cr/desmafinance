"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type EmployeeLite = { id: string; empCode: string; name: string };
type GridCell = { status: string; in: string | null; out: string | null };
type Grid = Record<string, Record<number, GridCell>>;

type Upload = {
  id: string;
  filename: string;
  rowCount: number;
  uploadedAt: string;
  uploadedBy: string;
};

const STATUS_TONE: Record<string, string> = {
  P: "bg-green-50 text-green-700",
  HD: "bg-yellow-50 text-yellow-700",
  A: "bg-red-50 text-red-700",
  WO: "bg-surface-container text-on-surface-variant",
  HL: "bg-blue-50 text-blue-700",
  LV: "bg-purple-50 text-purple-700",
};

export function AttendanceClient({
  monthKey,
  daysInMonth,
  canUpload,
  uploads,
  employees,
  grid,
}: {
  monthKey: string;
  daysInMonth: number;
  canUpload: boolean;
  uploads: Upload[];
  employees: EmployeeLite[];
  grid: Grid;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(monthKey);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setStatus("Uploading…");
    const fd = new FormData();
    fd.append("file", f);
    fd.append("monthKey", monthKey);
    const res = await fetch("/api/hr/attendance/upload", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(`Failed: ${j.error || res.statusText}`);
      return;
    }
    setStatus(
      `Imported ${j.inserted} day rows. ${j.unmatched > 0 ? `${j.unmatched} unmatched employees.` : ""}`,
    );
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
      <div className="flex flex-wrap items-center gap-sm">
        <label className="flex items-center gap-xs text-label-sm">
          <span className="text-on-surface-variant">Month</span>
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
              Upload biometric file (.xls / .xlsx)
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xls,.xlsx"
              className="hidden"
              onChange={onPick}
            />
          </>
        )}
        {status && <span className="text-caption text-on-surface-variant">{status}</span>}
      </div>

      {uploads.length > 0 && (
        <Section title="Recent uploads for this month">
          <table className="w-full text-label-sm">
            <thead className="text-left text-on-surface-variant border-b border-outline-variant">
              <tr>
                <th className="py-sm pr-md">Filename</th>
                <th className="py-sm pr-md">Rows</th>
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
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const row = grid[e.id] ?? {};
                return (
                  <tr key={e.id} className="border-t border-outline-variant">
                    <td className="sticky left-0 bg-surface z-10 px-sm py-xs whitespace-nowrap text-label-sm font-medium">
                      {e.empCode} · {e.name}
                    </td>
                    {days.map((d) => {
                      const c = row[d];
                      const s = c?.status ?? "";
                      const tone = STATUS_TONE[s] ?? "bg-surface-container text-on-surface-variant";
                      return (
                        <td key={d} className="px-[1px] py-[1px] text-center">
                          <span
                            title={c ? `${s}${c.in ? ` ${c.in}-${c.out ?? "?"}` : ""}` : "no record"}
                            className={
                              "inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-bold " +
                              tone
                            }
                          >
                            {s || "·"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={daysInMonth + 1} className="py-lg text-center text-on-surface-variant">
                    No active employees on the master.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-caption text-on-surface-variant mt-md">
          Legend: P = Present · HD = Half-day · A = Absent · WO = Week-off · HL = Holiday · LV =
          Leave. Hover a cell to see in/out times.
        </p>
      </Section>
    </>
  );
}
