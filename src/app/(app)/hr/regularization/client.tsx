"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type RegRow = {
  id: string;
  empCode: string;
  name: string;
  date: string;
  requestType: string;
  reasonType: string;
  reasonLabel: string;
  reason: string;
  proposedIn: string | null;
  proposedOut: string | null;
  status: string;
  attachmentUrl: string | null;
  createdAt: string;
  reviewNote: string | null;
};

const STATUSES = ["pending", "clarification", "approved", "rejected"] as const;

export function RegularizationReviewClient({
  canDecide,
  status,
  requests,
}: {
  canDecide: boolean;
  status: string;
  requests: RegRow[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decideOpen, setDecideOpen] = useState<RegRow | null>(null);

  async function quickDecide(row: RegRow, decision: "approve" | "reject" | "clarify") {
    const note =
      decision === "reject"
        ? prompt("Reason for rejection?") ?? ""
        : decision === "clarify"
          ? prompt("What clarification is needed?") ?? ""
          : null;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/hr/regularization/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          reviewNote: note,
          finalIn: row.proposedIn,
          finalOut: row.proposedOut,
          finalStatus: "P",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed");
      }
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Section
        title={`${status[0].toUpperCase() + status.slice(1)} requests`}
        action={
          <div className="flex items-center gap-xs">
            {STATUSES.map((s) => (
              <Link
                key={s}
                href={`/hr/regularization?status=${s}`}
                className={`px-sm py-xs rounded-lg text-label-sm capitalize ${s === status ? "bg-primary text-on-primary font-semibold" : "bg-surface-container text-on-surface-variant"}`}
              >
                {s}
              </Link>
            ))}
          </div>
        }
      >
        {requests.length === 0 ? (
          <p className="py-lg text-center text-on-surface-variant">No {status} requests.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-label-sm">
              <thead className="bg-surface-container text-on-surface-variant uppercase tracking-wider text-caption">
                <tr>
                  <th className="px-sm py-xs text-left">Submitted</th>
                  <th className="px-sm py-xs text-left">Employee</th>
                  <th className="px-sm py-xs text-left">Date</th>
                  <th className="px-sm py-xs text-left">Type</th>
                  <th className="px-sm py-xs text-left">Reason</th>
                  <th className="px-sm py-xs text-left">Proposed In</th>
                  <th className="px-sm py-xs text-left">Out</th>
                  <th className="px-sm py-xs text-left">Notes</th>
                  <th className="px-sm py-xs text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-t border-outline-variant align-top">
                    <td className="px-sm py-sm text-on-surface-variant whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString("en-IN", { hour12: false })}
                    </td>
                    <td className="px-sm py-sm">
                      <span className="font-semibold">{r.empCode}</span>
                      <br />
                      {r.name}
                    </td>
                    <td className="px-sm py-sm">{r.date}</td>
                    <td className="px-sm py-sm">
                      <span
                        className={
                          "px-xs py-[1px] rounded text-caption font-semibold " +
                          (r.requestType === "leave"
                            ? "bg-purple-50 text-purple-700"
                            : "bg-yellow-50 text-yellow-700")
                        }
                      >
                        {r.requestType === "leave" ? "Leave" : "Punch"}
                      </span>
                    </td>
                    <td className="px-sm py-sm">
                      <span className="font-semibold">{r.reasonLabel}</span>
                      <p className="text-on-surface-variant text-caption mt-[2px] max-w-md">
                        {r.reason}
                      </p>
                    </td>
                    <td className="px-sm py-sm font-mono">{r.proposedIn ?? "—"}</td>
                    <td className="px-sm py-sm font-mono">{r.proposedOut ?? "—"}</td>
                    <td className="px-sm py-sm text-on-surface-variant text-caption">
                      {r.attachmentUrl && (
                        <a
                          href={r.attachmentUrl}
                          target="_blank"
                          rel="noopener"
                          className="underline"
                        >
                          attachment
                        </a>
                      )}
                      {r.reviewNote && <div>HR: {r.reviewNote}</div>}
                    </td>
                    <td className="px-sm py-sm text-right">
                      {canDecide && (r.status === "pending" || r.status === "clarification") && (
                        <span className="inline-flex flex-wrap justify-end gap-xs">
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => setDecideOpen(r)}
                            className="px-sm py-[2px] rounded bg-green-600 text-white text-caption font-semibold"
                          >
                            Approve…
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => quickDecide(r, "reject")}
                            className="px-sm py-[2px] rounded bg-red-600 text-white text-caption font-semibold"
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => quickDecide(r, "clarify")}
                            className="px-sm py-[2px] rounded bg-yellow-600 text-white text-caption font-semibold"
                          >
                            Clarify
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {decideOpen && (
        <ApproveModal
          row={decideOpen}
          busy={busyId === decideOpen.id}
          onClose={() => setDecideOpen(null)}
          onSubmit={async (final) => {
            setBusyId(decideOpen.id);
            try {
              const res = await fetch(`/api/hr/regularization/${decideOpen.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  decision: "approve",
                  reviewNote: final.reviewNote,
                  finalIn: final.finalIn || null,
                  finalOut: final.finalOut || null,
                  finalStatus: final.finalStatus,
                  leaveStatus: final.leaveStatus,
                }),
              });
              if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error ?? "Failed");
              }
              setDecideOpen(null);
              router.refresh();
            } catch (e) {
              alert(e instanceof Error ? e.message : "Failed");
            } finally {
              setBusyId(null);
            }
          }}
        />
      )}
    </>
  );
}

function ApproveModal({
  row,
  busy,
  onClose,
  onSubmit,
}: {
  row: RegRow;
  busy: boolean;
  onClose: () => void;
  onSubmit: (v: {
    finalIn: string;
    finalOut: string;
    finalStatus: "P" | "HD" | "REG";
    leaveStatus: "LV" | "A";
    reviewNote: string;
  }) => Promise<void>;
}) {
  const [v, setV] = useState({
    finalIn: row.proposedIn ?? "",
    finalOut: row.proposedOut ?? "",
    finalStatus: "P" as "P" | "HD" | "REG",
    leaveStatus: "LV" as "LV" | "A",
    reviewNote: "",
  });
  const isLeave = row.requestType === "leave";
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-md">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg w-full max-w-md space-y-base">
        <h3 className="text-h3">{isLeave ? "Approve leave request" : "Approve punch correction"}</h3>
        <p className="text-label-sm text-on-surface-variant">
          {row.empCode} · {row.name} · {row.date} · {row.reasonLabel}
        </p>
        {isLeave ? (
          <label className="block space-y-xs">
            <span className="text-caption uppercase tracking-wider text-on-surface-variant">
              Leave type
            </span>
            <select
              value={v.leaveStatus}
              onChange={(e) => setV({ ...v, leaveStatus: e.target.value as "LV" | "A" })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            >
              <option value="LV">Paid leave (deducts leave balance)</option>
              <option value="A">Unpaid — loss of pay</option>
            </select>
            <p className="text-caption text-on-surface-variant">
              {v.leaveStatus === "LV"
                ? `Marks ${row.date} as paid leave (LV), deducted from the employee's leave balance.`
                : `Marks ${row.date} as unpaid leave / loss of pay (A).`}
            </p>
          </label>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-base">
              <label className="block space-y-xs">
                <span className="text-caption uppercase tracking-wider text-on-surface-variant">
                  Final In
                </span>
                <input
                  type="time"
                  value={v.finalIn}
                  onChange={(e) => setV({ ...v, finalIn: e.target.value })}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
                />
              </label>
              <label className="block space-y-xs">
                <span className="text-caption uppercase tracking-wider text-on-surface-variant">
                  Final Out
                </span>
                <input
                  type="time"
                  value={v.finalOut}
                  onChange={(e) => setV({ ...v, finalOut: e.target.value })}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
                />
              </label>
            </div>
            <label className="block space-y-xs">
              <span className="text-caption uppercase tracking-wider text-on-surface-variant">
                Final status
              </span>
              <select
                value={v.finalStatus}
                onChange={(e) => setV({ ...v, finalStatus: e.target.value as "P" | "HD" | "REG" })}
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
              >
                <option value="P">Present (full day)</option>
                <option value="HD">Half-day</option>
                <option value="REG">Regularized (special)</option>
              </select>
            </label>
          </>
        )}
        <label className="block space-y-xs">
          <span className="text-caption uppercase tracking-wider text-on-surface-variant">
            Review note
          </span>
          <input
            type="text"
            value={v.reviewNote}
            onChange={(e) => setV({ ...v, reviewNote: e.target.value })}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
          />
        </label>
        <div className="flex justify-end gap-sm pt-sm">
          <button
            type="button"
            onClick={onClose}
            className="px-md py-sm rounded-lg text-on-surface-variant"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSubmit(v)}
            className="px-md py-sm rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
          >
            {busy ? "Approving…" : "Approve & apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
