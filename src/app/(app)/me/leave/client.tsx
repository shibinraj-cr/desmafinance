"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Request = {
  id: string;
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

type Balance = {
  year: number;
  opening: number;
  accrued: number;
  used: number;
  balance: number;
};

type LedgerRow = {
  month: number;
  label: string;
  accrued: number;
  taken: number;
  unpaid: number;
  balance: number;
};

const STATUS_TONE: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-800",
  approved: "bg-green-50 text-green-800",
  rejected: "bg-red-50 text-red-800",
  cancelled: "bg-surface-container text-on-surface-variant",
};

export function MyLeaveClient({
  balance,
  requests,
  canApply = true,
  ledger = [],
  ledgerYear,
  ledgerOpening = 0,
}: {
  balance: Balance | null;
  requests: Request[];
  canApply?: boolean;
  ledger?: LedgerRow[];
  ledgerYear?: number;
  ledgerOpening?: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    fromDate: "",
    toDate: "",
    halfDay: false,
    leaveType: "CL" as "CL" | "LOP" | "SL",
    reason: "",
  });

  async function submit() {
    setError(null);
    const res = await fetch("/api/me/leave", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...draft,
        toDate: draft.toDate || draft.fromDate,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "submit failed");
      return;
    }
    setDraft({ fromDate: "", toDate: "", halfDay: false, leaveType: "CL", reason: "" });
    start(() => router.refresh());
  }

  return (
    <div className="space-y-lg">
      {balance && (
        <Section title={`Balance · ${balance.year}`}>
          <div className="grid grid-cols-4 gap-base">
            {[
              { label: "Opening", value: balance.opening },
              { label: "Accrued", value: balance.accrued },
              { label: "Used", value: balance.used },
              { label: "Balance", value: balance.balance },
            ].map((c) => (
              <div key={c.label} className="bg-surface-container rounded p-md">
                <p className="text-caption text-on-surface-variant uppercase tracking-wider">{c.label}</p>
                <p className="text-h2 font-extrabold">{c.value.toFixed(1)}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {ledger.length > 0 && (
        <Section title={`Leave ledger · ${ledgerYear ?? ""}`}>
          <p className="text-caption text-on-surface-variant mb-sm">
            Paid leave is credited each month and carries forward if unused. &ldquo;Taken&rdquo;
            counts leave used (half-day = 0.5); &ldquo;Unpaid&rdquo; is absence days (loss of pay).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-label-sm">
              <thead className="bg-surface-container text-on-surface-variant uppercase tracking-wider text-caption">
                <tr>
                  <th className="px-sm py-xs text-left">Month</th>
                  <th className="px-sm py-xs text-right">Paid leave</th>
                  <th className="px-sm py-xs text-right">Taken</th>
                  <th className="px-sm py-xs text-right">Unpaid</th>
                  <th className="px-sm py-xs text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-outline-variant text-on-surface-variant">
                  <td className="px-sm py-xs italic">Opening (carried forward)</td>
                  <td className="px-sm py-xs text-right">—</td>
                  <td className="px-sm py-xs text-right">—</td>
                  <td className="px-sm py-xs text-right">—</td>
                  <td className="px-sm py-xs text-right font-semibold">{ledgerOpening.toFixed(1)}</td>
                </tr>
                {ledger.map((r) => (
                  <tr key={r.month} className="border-t border-outline-variant">
                    <td className="px-sm py-xs">{r.label}</td>
                    <td className="px-sm py-xs text-right text-green-700">
                      {r.accrued ? `+${r.accrued.toFixed(1)}` : "—"}
                    </td>
                    <td className="px-sm py-xs text-right text-purple-700">
                      {r.taken ? r.taken.toFixed(1) : "—"}
                    </td>
                    <td className="px-sm py-xs text-right text-red-700">
                      {r.unpaid ? r.unpaid.toFixed(1) : "—"}
                    </td>
                    <td className="px-sm py-xs text-right font-semibold">{r.balance.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {canApply ? (
      <Section title="Apply for leave">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-sm items-end">
          <label className="flex flex-col gap-xs">
            <span className="text-caption text-on-surface-variant">From</span>
            <input
              type="date"
              className="px-sm py-sm rounded border border-outline-variant bg-surface"
              value={draft.fromDate}
              onChange={(e) => setDraft({ ...draft, fromDate: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="text-caption text-on-surface-variant">To (optional)</span>
            <input
              type="date"
              className="px-sm py-sm rounded border border-outline-variant bg-surface"
              value={draft.toDate}
              onChange={(e) => setDraft({ ...draft, toDate: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="text-caption text-on-surface-variant">Type</span>
            <select
              className="px-sm py-sm rounded border border-outline-variant bg-surface"
              value={draft.leaveType}
              onChange={(e) => setDraft({ ...draft, leaveType: e.target.value as "CL" | "LOP" | "SL" })}
              disabled={draft.halfDay}
            >
              <option value="CL">Casual</option>
              <option value="SL">Sick</option>
              <option value="LOP">Unpaid (LOP)</option>
            </select>
          </label>
          <label className="flex items-center gap-xs text-label-sm">
            <input
              type="checkbox"
              checked={draft.halfDay}
              onChange={(e) => setDraft({ ...draft, halfDay: e.target.checked })}
            />
            Half day
          </label>
          <label className="flex flex-col gap-xs md:col-span-4">
            <span className="text-caption text-on-surface-variant">Reason</span>
            <textarea
              rows={2}
              className="px-sm py-sm rounded border border-outline-variant bg-surface"
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            />
          </label>
          <div className="md:col-span-4 flex items-center gap-sm">
            <button
              onClick={submit}
              disabled={pending || !draft.fromDate || !draft.reason}
              className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
            >
              Submit request
            </button>
            {error && <span className="text-red-700 text-label-sm">{error}</span>}
          </div>
        </div>
      </Section>
      ) : (
        <Section title="Apply for leave">
          <p className="py-md text-on-surface-variant text-label-sm">
            Leave does not apply to your designation.
          </p>
        </Section>
      )}

      <Section title="My requests">
        <table className="w-full text-label-sm">
          <thead className="text-left text-on-surface-variant border-b border-outline-variant">
            <tr>
              <th className="py-sm pr-md">From → To</th>
              <th className="py-sm pr-md">Days</th>
              <th className="py-sm pr-md">Type</th>
              <th className="py-sm pr-md">Reason</th>
              <th className="py-sm pr-md">Status</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-outline-variant last:border-0">
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
                  {r.reviewNote && (
                    <div className="text-caption text-on-surface-variant">{r.reviewNote}</div>
                  )}
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={5} className="py-lg text-center text-on-surface-variant">
                  No requests yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
