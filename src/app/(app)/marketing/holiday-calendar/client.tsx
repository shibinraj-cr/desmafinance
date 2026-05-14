"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Holiday = {
  id: string;
  date: string;
  label: string;
  notes: string | null;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmtDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function HolidayCalendarClient({
  year,
  month,
  todayStr,
  holidays: initial,
  canEdit,
}: {
  year: number;
  month: number;
  todayStr: string;
  holidays: Holiday[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [holidays, setHolidays] = useState<Holiday[]>(initial);
  const [editing, setEditing] = useState<{ date: string; label: string; notes: string } | null>(null);
  const [busy, startTransition] = useTransition();

  const holidayByDate = useMemo(() => {
    const m = new Map<string, Holiday>();
    for (const h of holidays) m.set(h.date, h);
    return m;
  }, [holidays]);

  // Build the grid cells for the calendar (6 weeks × 7 days).
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = firstOfMonth.getUTCDay(); // 0=Sun
  const dim = daysInMonth(year, month);
  type Cell = { date: string | null; day: number | null; weekday: number };
  const cells: Cell[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ date: null, day: null, weekday: i });
  for (let d = 1; d <= dim; d++) {
    const dt = new Date(Date.UTC(year, month - 1, d));
    cells.push({ date: fmtDate(dt), day: d, weekday: dt.getUTCDay() });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null, weekday: cells.length % 7 });

  function navigate(deltaMonths: number) {
    let y = year;
    let m = month + deltaMonths;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    router.push(`/marketing/holiday-calendar?year=${y}&month=${m}`);
  }

  async function saveHoliday() {
    if (!editing) return;
    const label = editing.label.trim();
    if (!label) return;
    startTransition(async () => {
      const res = await fetch("/api/marketing/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: editing.date, label, notes: editing.notes || null }),
      });
      if (!res.ok) {
        alert("Failed to save holiday.");
        return;
      }
      const { holiday } = (await res.json()) as { holiday: Holiday };
      setHolidays((arr) => {
        const idx = arr.findIndex((h) => h.date === holiday.date);
        if (idx >= 0) {
          const copy = arr.slice();
          copy[idx] = holiday;
          return copy;
        }
        return [...arr, holiday].sort((a, b) => a.date.localeCompare(b.date));
      });
      setEditing(null);
    });
  }

  async function deleteHoliday(date: string) {
    if (!confirm("Remove this holiday?")) return;
    startTransition(async () => {
      const res = await fetch("/api/marketing/holidays", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      if (!res.ok) {
        alert("Failed to delete.");
        return;
      }
      setHolidays((arr) => arr.filter((h) => h.date !== date));
      if (editing?.date === date) setEditing(null);
    });
  }

  // Right-column: all stored holidays this year, grouped by month.
  const byMonth = useMemo(() => {
    const map = new Map<number, Holiday[]>();
    for (const h of holidays) {
      const m = Number(h.date.slice(5, 7));
      const arr = map.get(m) ?? [];
      arr.push(h);
      map.set(m, arr);
    }
    return map;
  }, [holidays]);

  // Build also a working-days summary for the displayed month: total - sundays - holidays
  const summary = useMemo(() => {
    let sundays = 0;
    let stored = 0;
    let storedOnSunday = 0;
    for (let d = 1; d <= dim; d++) {
      const dt = new Date(Date.UTC(year, month - 1, d));
      const ds = fmtDate(dt);
      const isSun = dt.getUTCDay() === 0;
      if (isSun) sundays += 1;
      if (holidayByDate.has(ds)) {
        stored += 1;
        if (isSun) storedOnSunday += 1;
      }
    }
    const offDays = sundays + (stored - storedOnSunday);
    return { sundays, stored, working: dim - offDays, offDays };
  }, [year, month, dim, holidayByDate]);

  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Holiday Calendar</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            Sundays are off by default. {canEdit ? "Click any other day to mark it as a holiday." : "Read-only — only supervisors can edit."}
          </p>
        </div>
        <div className="flex items-center gap-[8px]">
          <button
            onClick={() => navigate(-1)}
            className="rounded-[8px] px-[10px] py-[6px] text-[13px] border"
            style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface)" }}
            disabled={busy}
          >
            ‹ Prev
          </button>
          <div
            className="rounded-[8px] px-[12px] py-[6px] text-[14px] font-semibold border"
            style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-primary)" }}
          >
            {MONTH_LABELS[month - 1]} {year}
          </div>
          <button
            onClick={() => navigate(1)}
            className="rounded-[8px] px-[10px] py-[6px] text-[13px] border"
            style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface)" }}
            disabled={busy}
          >
            Next ›
          </button>
          <button
            onClick={() => {
              const y = Number(todayStr.slice(0, 4));
              const m = Number(todayStr.slice(5, 7));
              router.push(`/marketing/holiday-calendar?year=${y}&month=${m}`);
            }}
            className="rounded-[8px] px-[10px] py-[6px] text-[13px] border"
            style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface)" }}
            disabled={busy}
          >
            Today
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-[16px]">
        {/* Calendar */}
        <section
          className="rounded-[12px] border p-[16px]"
          style={{
            backgroundColor: "var(--lp-surface-container)",
            borderColor: "var(--lp-outline-variant)",
          }}
        >
          <div
            className="flex flex-wrap items-center justify-between gap-[8px] mb-[12px] text-[12px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            <span>
              Working days this month:{" "}
              <span className="font-mono" style={{ color: "var(--lp-on-surface)" }}>
                {summary.working}
              </span>{" "}
              <span style={{ opacity: 0.7 }}>
                ({summary.offDays} off — {summary.sundays} Sundays + {summary.stored - (summary.stored ? 0 : 0)} marked)
              </span>
            </span>
          </div>
          <div className="grid grid-cols-7 gap-[6px] text-[11px] uppercase tracking-widest mb-[6px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            {WEEKDAY_LABELS.map((w) => (
              <div key={w} className="px-[6px] py-[4px]">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-[6px]">
            {cells.map((c, i) => {
              if (c.date == null) {
                return <div key={i} className="h-[88px] rounded-[8px]" style={{ backgroundColor: "transparent" }} />;
              }
              const h = holidayByDate.get(c.date);
              const isSun = c.weekday === 0;
              const isToday = c.date === todayStr;
              const bg = h
                ? "rgba(255, 180, 147, 0.18)"
                : isSun
                  ? "rgba(51, 228, 255, 0.10)"
                  : "var(--lp-surface-container-high)";
              const border = isToday ? "var(--lp-primary)" : "var(--lp-outline-variant)";
              return (
                <button
                  key={i}
                  onClick={() => {
                    if (!canEdit) return;
                    setEditing({
                      date: c.date!,
                      label: h?.label ?? (isSun ? "Sunday" : ""),
                      notes: h?.notes ?? "",
                    });
                  }}
                  disabled={!canEdit || busy}
                  className="h-[88px] rounded-[8px] border text-left p-[8px] transition-[transform] hover:translate-y-[-1px] disabled:hover:translate-y-0 disabled:cursor-default"
                  style={{ backgroundColor: bg, borderColor: border }}
                  title={
                    h
                      ? `${c.date} — ${h.label}`
                      : isSun
                        ? `${c.date} — Sunday (off)`
                        : c.date!
                  }
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-semibold" style={{ color: "var(--lp-on-surface)" }}>
                      {c.day}
                    </span>
                    {isToday && (
                      <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--lp-primary)" }}>
                        Today
                      </span>
                    )}
                  </div>
                  {h ? (
                    <div className="mt-[4px] text-[11px] leading-tight" style={{ color: "var(--lp-orange)" }}>
                      {h.label}
                    </div>
                  ) : isSun ? (
                    <div className="mt-[4px] text-[10px] uppercase tracking-widest" style={{ color: "var(--lp-cyan)" }}>
                      Sunday
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        {/* Right column: year list */}
        <aside
          className="rounded-[12px] border p-[16px]"
          style={{
            backgroundColor: "var(--lp-surface-container)",
            borderColor: "var(--lp-outline-variant)",
          }}
        >
          <div className="flex items-center justify-between mb-[10px]">
            <h2 className="text-[14px] font-semibold" style={{ color: "var(--lp-on-surface)" }}>
              Holidays in {year}
            </h2>
            <span className="text-[11px]" style={{ color: "var(--lp-on-surface-variant)" }}>
              {holidays.length} marked
            </span>
          </div>
          {holidays.length === 0 ? (
            <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
              No holidays added yet. {canEdit ? "Click any day on the calendar to add one." : ""}
            </p>
          ) : (
            <ul className="space-y-[10px]">
              {Array.from(byMonth.keys())
                .sort((a, b) => a - b)
                .map((m) => (
                  <li key={m}>
                    <p
                      className="text-[10px] uppercase tracking-widest mb-[4px]"
                      style={{ color: "var(--lp-on-surface-variant)" }}
                    >
                      {MONTH_LABELS[m - 1]}
                    </p>
                    <ul className="space-y-[6px]">
                      {byMonth.get(m)!.map((h) => {
                        const d = Number(h.date.slice(8, 10));
                        return (
                          <li
                            key={h.id}
                            className="flex items-center justify-between text-[13px]"
                          >
                            <span className="flex items-center gap-[8px]">
                              <span
                                className="inline-flex items-center justify-center w-[26px] text-[11px] font-mono rounded-[4px] px-[4px]"
                                style={{
                                  backgroundColor: "var(--lp-surface-container-high)",
                                  color: "var(--lp-on-surface-variant)",
                                }}
                              >
                                {d}
                              </span>
                              <span style={{ color: "var(--lp-on-surface)" }}>{h.label}</span>
                            </span>
                            {canEdit && (
                              <button
                                onClick={() => deleteHoliday(h.date)}
                                disabled={busy}
                                className="text-[11px] underline"
                                style={{ color: "var(--lp-error)" }}
                              >
                                Remove
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
            </ul>
          )}
        </aside>
      </div>

      {/* Edit modal */}
      {editing && (
        <div
          className="fixed inset-0 flex items-center justify-center px-[16px]"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.55)", zIndex: 50 }}
          onClick={() => setEditing(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-[12px] p-[20px] border"
            style={{
              backgroundColor: "var(--lp-surface-container)",
              borderColor: "var(--lp-outline-variant)",
            }}
          >
            <div className="flex items-center justify-between mb-[10px]">
              <h3 className="text-[15px] font-semibold" style={{ color: "var(--lp-on-surface)" }}>
                {holidayByDate.get(editing.date) ? "Edit holiday" : "Mark as holiday"}
              </h3>
              <span className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                {editing.date}
              </span>
            </div>
            <label className="block text-[11px] uppercase tracking-widest mb-[4px]" style={{ color: "var(--lp-on-surface-variant)" }}>
              Label
            </label>
            <input
              autoFocus
              value={editing.label}
              onChange={(e) => setEditing({ ...editing, label: e.target.value })}
              placeholder="e.g. Diwali"
              className="w-full rounded-[8px] px-[10px] py-[8px] text-[14px] border outline-none"
              style={{
                backgroundColor: "var(--lp-surface-container-high)",
                borderColor: "var(--lp-outline-variant)",
                color: "var(--lp-on-surface)",
              }}
            />
            <label className="block text-[11px] uppercase tracking-widest mt-[10px] mb-[4px]" style={{ color: "var(--lp-on-surface-variant)" }}>
              Notes (optional)
            </label>
            <textarea
              value={editing.notes}
              onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              rows={2}
              className="w-full rounded-[8px] px-[10px] py-[8px] text-[13px] border outline-none resize-none"
              style={{
                backgroundColor: "var(--lp-surface-container-high)",
                borderColor: "var(--lp-outline-variant)",
                color: "var(--lp-on-surface)",
              }}
            />
            <div className="mt-[14px] flex items-center justify-between gap-[8px]">
              {holidayByDate.get(editing.date) ? (
                <button
                  onClick={() => deleteHoliday(editing.date)}
                  disabled={busy}
                  className="text-[12px] underline"
                  style={{ color: "var(--lp-error)" }}
                >
                  Remove
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-[8px]">
                <button
                  onClick={() => setEditing(null)}
                  disabled={busy}
                  className="rounded-[8px] px-[12px] py-[6px] text-[13px] border"
                  style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface)" }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveHoliday}
                  disabled={busy || !editing.label.trim()}
                  className="rounded-[8px] px-[14px] py-[6px] text-[13px] font-semibold"
                  style={{ backgroundColor: "var(--lp-primary)", color: "#1a1500" }}
                >
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
