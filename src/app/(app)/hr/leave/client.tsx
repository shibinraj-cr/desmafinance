"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Request = {
  id: string;
  employeeCode: string;
  employeeName: string;
  fromDate: string;
  toDate: string;
  days: number;
  leaveType: string;
  reason: string | null;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

const STATUS_TONE: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-800",
  approved: "bg-green-50 text-green-800",
  rejected: "bg-red-50 text-red-800",
  cancelled: "bg-surface-container text-on-surface-variant",
};

export function LeaveReviewer({ requests, canDecide }: { requests: Request[]; canDecide: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

  async function decide(id: string, action: "approve" | "reject") {
    setError(null);
    const res = await fetch(`/api/hr/leave/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, note: notes[id] || null }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "decision failed");
      return;
    }
    start(() => router.refresh());
  }

  const filtered = requests.filter((r) => (filter === "all" ? true : r.status === filter));

  return (
    <Section title="">
      <div className="flex gap-sm mb-md">
        {(["all", "pending", "approved", "rejected"] as const).map((f) => (
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
      {error && <p className="text-red-700 text-label-sm mb-sm">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-label-sm">
          <thead className="text-left text-on-surface-variant border-b border-outline-variant">
            <tr>
              <th className="py-sm pr-md">Employee</th>
              <th className="py-sm pr-md">From → To</th>
              <th className="py-sm pr-md">Days</th>
              <th className="py-sm pr-md">Type</th>
              <th className="py-sm pr-md">Reason</th>
              <th className="py-sm pr-md">Status</th>
              {canDecide && <th className="py-sm pr-md">Decide</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-outline-variant last:border-0 align-top">
                <td className="py-sm pr-md font-semibold whitespace-nowrap">
                  {r.employeeCode} · {r.employeeName}
                </td>
                <td className="py-sm pr-md whitespace-nowrap">
                  {r.fromDate}
                  {r.fromDate !== r.toDate ? ` → ${r.toDate}` : ""}
                </td>
                <td className="py-sm pr-md">{r.days.toFixed(1)}</td>
                <td className="py-sm pr-md">{r.leaveType}</td>
                <td className="py-sm pr-md max-w-[300px]">{r.reason}</td>
                <td className="py-sm pr-md">
                  <span
                    className={
                      "inline-block px-xs py-[2px] rounded text-[11px] font-bold " +
                      (STATUS_TONE[r.status] ?? "bg-surface-container")
                    }
                  >
                    {r.status}
                  </span>
                  {r.reviewedBy && (
                    <div className="text-caption text-on-surface-variant">
                      by {r.reviewedBy}
                      {r.reviewNote ? ` — ${r.reviewNote}` : ""}
                    </div>
                  )}
                </td>
                {canDecide && (
                  <td className="py-sm pr-md min-w-[260px]">
                    {r.status === "pending" ? (
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
                            onClick={() => decide(r.id, "approve")}
                            className="px-sm py-xs rounded bg-green-600 text-white font-bold disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            disabled={pending}
                            onClick={() => decide(r.id, "reject")}
                            className="px-sm py-xs rounded bg-red-600 text-white font-bold disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-on-surface-variant">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={canDecide ? 7 : 6} className="py-lg text-center text-on-surface-variant">
                  No leave requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
