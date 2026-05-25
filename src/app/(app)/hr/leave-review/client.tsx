"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Row = {
  id: string;
  date: string;
  status: string;
  rawStatus: string | null;
  remark: string | null;
  in: string | null;
  out: string | null;
  workMinutes: number | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

type Group = {
  empId: string;
  empCode: string;
  name: string;
  balance: { opening: number; accrued: number; used: number; balance: number } | null;
  rows: Row[];
  counts: { A: number; HD: number; LV: number; undecided: number };
};

const STATUS_TONE: Record<string, string> = {
  P: "bg-green-50 text-green-700",
  HD: "bg-yellow-50 text-yellow-700",
  A: "bg-red-50 text-red-700",
  WO: "bg-surface-container text-on-surface-variant",
  HL: "bg-blue-50 text-blue-700",
  LV: "bg-purple-50 text-purple-700",
};

function hhmm(min: number | null) {
  if (!min) return "—";
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

export function LeaveReviewClient({
  monthKey,
  prevMonth,
  nextMonth,
  cycleLabel,
  groups,
  canDecide,
}: {
  monthKey: string;
  prevMonth: string;
  nextMonth: string;
  cycleLabel: string;
  groups: Group[];
  canDecide: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"undecided" | "all">("undecided");

  function toggle(id: string) {
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function isSelected(id: string) {
    return !!selectedIds[id];
  }

  function selectAllForGroup(group: Group) {
    const allDayIds = group.rows.filter((r) => filter === "all" || !r.decidedBy).map((r) => r.id);
    const allOn = allDayIds.every((id) => isSelected(id));
    const next = { ...selectedIds };
    for (const id of allDayIds) next[id] = !allOn;
    setSelectedIds(next);
  }

  async function decide(decision: "paid" | "unpaid" | "reset", dayIds: string[]) {
    if (dayIds.length === 0) return;
    setError(null);
    const noteVal = dayIds.length === 1 ? notes[dayIds[0]] || null : null;
    const res = await fetch("/api/hr/attendance/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dayIds, decision, note: noteVal }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "decision failed");
      return;
    }
    setSelectedIds({});
    setNotes({});
    start(() => router.refresh());
  }

  function gotoMonth(m: string) {
    router.push(`/hr/leave-review?month=${m}`);
  }

  const selectedCount = Object.values(selectedIds).filter(Boolean).length;
  const allSelectedIds = Object.entries(selectedIds)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return (
    <div className="space-y-lg">
      <Section title="">
        <div className="flex flex-wrap items-center gap-sm">
          <button
            onClick={() => gotoMonth(prevMonth)}
            className="px-sm py-sm rounded border border-outline-variant"
          >
            ←
          </button>
          <label className="flex items-center gap-xs text-label-sm">
            <span className="text-on-surface-variant">Cycle</span>
            <input
              type="month"
              value={monthKey}
              onChange={(e) => gotoMonth(e.target.value)}
              className="px-sm py-sm rounded border border-outline-variant bg-surface"
            />
          </label>
          <button
            onClick={() => gotoMonth(nextMonth)}
            className="px-sm py-sm rounded border border-outline-variant"
          >
            →
          </button>
          <span className="text-label-sm text-on-surface-variant">{cycleLabel}</span>
          <div className="ml-auto flex items-center gap-xs">
            <span className="text-caption text-on-surface-variant">Show</span>
            {(["undecided", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  "px-sm py-xs rounded text-label-sm capitalize " +
                  (filter === f
                    ? "bg-primary text-on-primary font-bold"
                    : "bg-surface-container text-on-surface-variant")
                }
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        {canDecide && selectedCount > 0 && (
          <div className="mt-md flex flex-wrap items-center gap-sm rounded bg-yellow-50 border border-yellow-300 px-md py-sm">
            <span className="font-semibold text-label-sm">{selectedCount} day(s) selected.</span>
            <button
              disabled={pending}
              onClick={() => decide("paid", allSelectedIds)}
              className="px-sm py-xs rounded bg-purple-600 text-white text-label-sm font-bold disabled:opacity-50"
            >
              Mark as Paid Leave (CL)
            </button>
            <button
              disabled={pending}
              onClick={() => decide("unpaid", allSelectedIds)}
              className="px-sm py-xs rounded bg-red-600 text-white text-label-sm font-bold disabled:opacity-50"
            >
              Mark as Unpaid (LOP)
            </button>
            <button
              disabled={pending}
              onClick={() => decide("reset", allSelectedIds)}
              className="px-sm py-xs rounded border border-outline-variant text-label-sm"
            >
              Reset to biometric
            </button>
            <button
              onClick={() => setSelectedIds({})}
              className="ml-auto text-label-sm underline text-on-surface-variant"
            >
              Clear selection
            </button>
          </div>
        )}
        {error && <p className="mt-sm text-red-700 text-label-sm">{error}</p>}
        <p className="text-caption text-on-surface-variant mt-sm">
          Each Absent / Half-day from biometric needs a decision. Paid Leave deducts from the
          employee&apos;s balance; Unpaid deducts from salary. Reset reverts to the original
          biometric value.
        </p>
      </Section>

      {groups.map((g) => {
        const visibleRows = g.rows.filter((r) => (filter === "all" ? true : !r.decidedBy));
        if (visibleRows.length === 0) return null;
        return (
          <Section
            key={g.empId}
            title={`${g.empCode} · ${g.name}`}
            action={
              <div className="flex items-center gap-sm">
                <span className="text-caption">
                  Leave bal:{" "}
                  <strong>{g.balance ? g.balance.balance.toFixed(1) : "—"}</strong>
                </span>
                <span className="text-caption text-red-700">A:{g.counts.A}</span>
                <span className="text-caption text-yellow-700">HD:{g.counts.HD}</span>
                <span className="text-caption text-purple-700">LV:{g.counts.LV}</span>
                {g.counts.undecided > 0 && (
                  <span className="text-caption text-yellow-800 font-bold">
                    {g.counts.undecided} undecided
                  </span>
                )}
              </div>
            }
          >
            <table className="w-full text-label-sm">
              <thead className="text-left text-on-surface-variant border-b border-outline-variant">
                <tr>
                  {canDecide && (
                    <th className="py-sm pr-sm w-8">
                      <input
                        type="checkbox"
                        checked={
                          visibleRows.length > 0 && visibleRows.every((r) => isSelected(r.id))
                        }
                        onChange={() => selectAllForGroup(g)}
                      />
                    </th>
                  )}
                  <th className="py-sm pr-md">Date</th>
                  <th className="py-sm pr-md">Status</th>
                  <th className="py-sm pr-md">Biometric</th>
                  <th className="py-sm pr-md">IN / OUT</th>
                  <th className="py-sm pr-md">Work</th>
                  <th className="py-sm pr-md">Remark</th>
                  <th className="py-sm pr-md">Decision</th>
                  {canDecide && <th className="py-sm pr-md">Action</th>}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const tone = STATUS_TONE[r.status] ?? "bg-surface-container";
                  return (
                    <tr key={r.id} className="border-b border-outline-variant last:border-0 align-top">
                      {canDecide && (
                        <td className="py-sm pr-sm">
                          <input
                            type="checkbox"
                            checked={isSelected(r.id)}
                            onChange={() => toggle(r.id)}
                          />
                        </td>
                      )}
                      <td className="py-sm pr-md whitespace-nowrap">{r.date}</td>
                      <td className="py-sm pr-md">
                        <span
                          className={
                            "inline-flex items-center justify-center w-7 h-6 rounded text-[10px] font-bold " +
                            tone
                          }
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-sm pr-md text-on-surface-variant">
                        {r.rawStatus ?? "—"}
                      </td>
                      <td className="py-sm pr-md text-on-surface-variant whitespace-nowrap">
                        {r.in && r.out ? `${r.in} → ${r.out}` : "—"}
                      </td>
                      <td className="py-sm pr-md text-on-surface-variant">{hhmm(r.workMinutes)}</td>
                      <td className="py-sm pr-md text-on-surface-variant">{r.remark ?? "—"}</td>
                      <td className="py-sm pr-md text-on-surface-variant">
                        {r.decidedBy ? (
                          <>
                            <div className="text-label-sm font-semibold">
                              {r.status === "LV" ? "Paid (CL)" : r.status === "A" ? "Unpaid (LOP)" : r.status}
                            </div>
                            <div className="text-caption">
                              by {r.decidedBy}
                              {r.decidedAt
                                ? ` · ${new Date(r.decidedAt).toLocaleDateString()}`
                                : ""}
                            </div>
                            {r.decisionNote && (
                              <div className="text-caption italic">{r.decisionNote}</div>
                            )}
                          </>
                        ) : (
                          <span className="text-yellow-700 font-bold">Undecided</span>
                        )}
                      </td>
                      {canDecide && (
                        <td className="py-sm pr-md min-w-[260px]">
                          <div className="flex flex-col gap-xs">
                            <input
                              placeholder="optional note"
                              value={notes[r.id] ?? ""}
                              onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                              className="px-xs py-xs rounded border border-outline-variant bg-surface text-label-sm"
                            />
                            <div className="flex gap-xs">
                              <button
                                disabled={pending}
                                onClick={() => decide("paid", [r.id])}
                                className="px-xs py-xs rounded bg-purple-600 text-white text-[10px] font-bold disabled:opacity-50"
                              >
                                Paid
                              </button>
                              <button
                                disabled={pending}
                                onClick={() => decide("unpaid", [r.id])}
                                className="px-xs py-xs rounded bg-red-600 text-white text-[10px] font-bold disabled:opacity-50"
                              >
                                Unpaid
                              </button>
                              {r.decidedBy && (
                                <button
                                  disabled={pending}
                                  onClick={() => decide("reset", [r.id])}
                                  className="px-xs py-xs rounded border border-outline-variant text-[10px]"
                                >
                                  Reset
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        );
      })}

      {groups.every((g) => g.rows.filter((r) => (filter === "all" ? true : !r.decidedBy)).length === 0) && (
        <Section title="">
          <p className="py-lg text-center text-on-surface-variant">
            {filter === "undecided"
              ? "Nothing to review — all absent / half-day entries are decided. Switch to All to see history."
              : "No A / HD / LV days in this cycle yet. Upload attendance from the Attendance page."}
          </p>
        </Section>
      )}
    </div>
  );
}
