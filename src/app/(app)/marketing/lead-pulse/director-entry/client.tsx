"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

type Source = { id: string; label: string; code: string };

export function DirectorEntryClient({
  directorDisplayName,
  date,
  today,
  sources,
  initialCloses,
}: {
  directorDisplayName: string;
  date: string;
  today: string;
  sources: Source[];
  initialCloses: Record<string, number>;
}) {
  const router = useRouter();
  const [pickedDate, setPickedDate] = useState(date);
  const [closes, setCloses] = useState<Record<string, number>>(initialCloses);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // Refresh on date change.
  useEffect(() => {
    if (pickedDate === date) return;
    router.push(`/marketing/lead-pulse/director-entry?date=${pickedDate}`);
  }, [pickedDate, date, router]);

  function setClose(sourceId: string, n: number) {
    setCloses((m) => ({ ...m, [sourceId]: Math.max(0, Math.floor(n)) }));
  }

  function save() {
    setSuccess(null);
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/marketing/lead-pulse/director-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: pickedDate, closes }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error ?? "Save failed.");
        return;
      }
      const total = Object.values(closes).reduce((a, b) => a + b, 0);
      setSuccess(
        `Saved ${directorDisplayName}'s closed leads for ${pickedDate} — ${total} total.`,
      );
      router.refresh();
    });
  }

  const total = Object.values(closes).reduce((a, b) => a + b, 0);

  return (
    <div className="px-[24px] py-[24px] space-y-[16px] max-w-3xl">
      <header className="space-y-[4px]">
        <h1 className="text-[28px] font-bold tracking-tight">Director Entry</h1>
        <p className="text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
          {directorDisplayName} doesn&apos;t log her own daily numbers — Suhaina enters
          only the count of closed leads per source here. Closed-Won values feed all
          downstream dashboards exactly like a BDE submission.
        </p>
      </header>

      <div
        className="rounded-[12px] border p-[16px] space-y-[12px]"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
        }}
      >
        <div className="flex flex-wrap items-end justify-between gap-[12px]">
          <label
            className="flex items-center gap-[8px] text-[13px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            Entry date
            <input
              type="date"
              value={pickedDate}
              max={today}
              onChange={(e) => setPickedDate(e.target.value)}
              className="rounded-[8px] px-[10px] h-[36px] text-[13px] lp-date-input"
              style={{ colorScheme: "dark" }}
            />
          </label>
          <div className="text-right">
            <p
              className="text-[10px] uppercase tracking-widest"
              style={{ color: "var(--lp-on-surface-variant)" }}
            >
              Total closed
            </p>
            <p
              className="text-[26px] font-bold tabular-nums"
              style={{ color: "var(--lp-primary)" }}
            >
              {total}
            </p>
          </div>
        </div>

        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
              <th
                className="px-[12px] py-[8px] text-left text-[11px] uppercase tracking-widest font-semibold"
                style={{ color: "var(--lp-on-surface-variant)" }}
              >
                Source
              </th>
              <th
                className="px-[12px] py-[8px] text-right text-[11px] uppercase tracking-widest font-semibold"
                style={{ color: "var(--lp-primary)" }}
              >
                Closed-Won
              </th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr
                key={s.id}
                className="border-t"
                style={{ borderColor: "var(--lp-outline-variant)" }}
              >
                <td className="px-[12px] py-[8px]" style={{ color: "var(--lp-on-surface)" }}>
                  {s.label}
                </td>
                <td className="px-[8px] py-[6px]">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={closes[s.id] ?? 0}
                    onChange={(e) => setClose(s.id, Number(e.target.value || 0))}
                    className="w-full h-[36px] rounded-[8px] px-[10px] text-right font-mono"
                    style={{ color: "var(--lp-primary)", fontWeight: 600 }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {error && (
          <p className="text-[12px]" style={{ color: "var(--lp-error)" }}>
            {error}
          </p>
        )}
        {success && (
          <div
            className="rounded-[8px] border-2 p-[10px] text-[13px] flex items-center gap-[8px]"
            style={{
              backgroundColor: "rgba(51, 228, 255, 0.12)",
              borderColor: "var(--lp-cyan)",
              color: "var(--lp-on-surface)",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 20, color: "var(--lp-cyan)" }}
            >
              check_circle
            </span>
            {success}
          </div>
        )}

        <div className="flex items-center justify-end">
          <button
            onClick={save}
            disabled={busy}
            className="h-[40px] px-[18px] rounded-[8px] text-[13px] font-bold"
            style={{
              backgroundColor: "var(--lp-primary)",
              color: "var(--lp-on-primary)",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
