"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

type Source = { id: string; label: string; code: string };
type Service = { id: string; name: string };
type CloseRow = { count: number; serviceIds: string[] };

export function DirectorEntryClient({
  directorDisplayName,
  date,
  today,
  sources,
  services,
  initialCloses,
}: {
  directorDisplayName: string;
  date: string;
  today: string;
  sources: Source[];
  services: Service[];
  initialCloses: Record<string, CloseRow>;
}) {
  const router = useRouter();
  const [pickedDate, setPickedDate] = useState(date);
  const [closes, setCloses] = useState<Record<string, CloseRow>>(initialCloses);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // Refresh on date change.
  useEffect(() => {
    if (pickedDate === date) return;
    router.push(`/marketing/lead-pulse/director-entry?date=${pickedDate}`);
  }, [pickedDate, date, router]);

  function setCount(sourceId: string, n: number) {
    const next = Math.max(0, Math.floor(n));
    setCloses((m) => {
      const prev = m[sourceId] ?? { count: 0, serviceIds: [] };
      // Pad with empty slots when count grows, trim from the end when it
      // shrinks — preserves the picks already made.
      const ids = [...prev.serviceIds];
      while (ids.length < next) ids.push("");
      while (ids.length > next) ids.pop();
      return { ...m, [sourceId]: { count: next, serviceIds: ids } };
    });
  }

  function setServicePick(sourceId: string, index: number, serviceId: string) {
    setCloses((m) => {
      const prev = m[sourceId] ?? { count: 0, serviceIds: [] };
      const ids = [...prev.serviceIds];
      ids[index] = serviceId;
      return { ...m, [sourceId]: { count: prev.count, serviceIds: ids } };
    });
  }

  // A row is valid for save when count===0 OR every slot has a service.
  const invalidSources = sources.filter((s) => {
    const r = closes[s.id];
    if (!r || r.count === 0) return false;
    return r.serviceIds.some((sid) => !sid.trim());
  });
  const canSave = !busy && invalidSources.length === 0;

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
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          d.error === "service_count_mismatch"
            ? "Pick one service per close before saving."
            : (d.error ?? "Save failed."),
        );
        return;
      }
      const total = Object.values(closes).reduce((a, r) => a + r.count, 0);
      setSuccess(
        `Saved ${directorDisplayName}'s closed leads for ${pickedDate} — ${total} total.`,
      );
      router.refresh();
    });
  }

  const total = Object.values(closes).reduce((a, r) => a + r.count, 0);

  return (
    <div className="px-[24px] py-[24px] space-y-[16px] max-w-3xl">
      <header className="space-y-[4px]">
        <h1 className="text-[28px] font-bold tracking-tight">Director Entry</h1>
        <p className="text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
          {directorDisplayName} doesn&apos;t log her own daily numbers — Suhaina enters
          the count of closed leads per source and tags each close with the service it
          was against. Closed-Won values feed all downstream dashboards (including the
          L2 Targets matrix) exactly like a BDE submission.
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
              <th
                className="px-[12px] py-[8px] text-left text-[11px] uppercase tracking-widest font-semibold"
                style={{ color: "var(--lp-on-surface-variant)" }}
              >
                Services
              </th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => {
              const row = closes[s.id] ?? { count: 0, serviceIds: [] };
              return (
                <tr
                  key={s.id}
                  className="border-t"
                  style={{ borderColor: "var(--lp-outline-variant)" }}
                >
                  <td
                    className="px-[12px] py-[8px] align-top"
                    style={{ color: "var(--lp-on-surface)" }}
                  >
                    {s.label}
                  </td>
                  <td className="px-[8px] py-[6px] align-top w-[120px]">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={row.count}
                      onChange={(e) => setCount(s.id, Number(e.target.value || 0))}
                      className="w-full h-[36px] rounded-[8px] px-[10px] text-right font-mono"
                      style={{ color: "var(--lp-primary)", fontWeight: 600 }}
                    />
                  </td>
                  <td className="px-[8px] py-[6px] align-top">
                    {row.count === 0 ? (
                      <span
                        className="text-[12px]"
                        style={{ color: "var(--lp-on-surface-variant)", opacity: 0.6 }}
                      >
                        —
                      </span>
                    ) : (
                      <div className="flex flex-col gap-[6px]">
                        {Array.from({ length: row.count }).map((_, i) => {
                          const picked = row.serviceIds[i] ?? "";
                          const isEmpty = !picked.trim();
                          return (
                            <select
                              key={i}
                              value={picked}
                              onChange={(e) => setServicePick(s.id, i, e.target.value)}
                              className="h-[32px] rounded-[6px] px-[8px] text-[12px] min-w-[180px]"
                              style={{
                                color: isEmpty ? "var(--lp-orange)" : "var(--lp-on-surface)",
                                border: isEmpty
                                  ? "1px solid var(--lp-orange)"
                                  : "1px solid var(--lp-outline-variant)",
                                backgroundColor: "var(--lp-surface-container-low)",
                              }}
                            >
                              <option value="">— pick a service —</option>
                              {services.map((sv) => (
                                <option key={sv.id} value={sv.id}>
                                  {sv.name}
                                </option>
                              ))}
                            </select>
                          );
                        })}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
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

        <div className="flex items-center justify-between">
          {invalidSources.length > 0 ? (
            <p className="text-[12px]" style={{ color: "var(--lp-orange)" }}>
              Pick a service for every close in:{" "}
              <span style={{ color: "var(--lp-on-surface)" }}>
                {invalidSources.map((s) => s.label).join(", ")}
              </span>
            </p>
          ) : (
            <span />
          )}
          <button
            onClick={save}
            disabled={!canSave}
            className="h-[40px] px-[18px] rounded-[8px] text-[13px] font-bold"
            style={{
              backgroundColor: "var(--lp-primary)",
              color: "var(--lp-on-primary)",
              opacity: !canSave ? 0.5 : 1,
              cursor: !canSave ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
