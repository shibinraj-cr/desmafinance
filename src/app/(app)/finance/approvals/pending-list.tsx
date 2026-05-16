"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inrFull } from "@/lib/format";

export type PendingRow = {
  id: string;
  kind: "create" | "update" | "delete";
  submittedBy: string;
  createdAt: string;
  // Effective payload — proposed for create/update, targetTx for delete.
  date: string;
  type: string;
  category: string;
  subItem: string;
  partyId: string | null;
  description: string | null;
  paymentMode: string;
  flow: string;
  amount: number;
};

export type PartyLookup = Record<string, { name: string; group: string }>;

type Decision = "approve" | "reject" | null;
type RowState = { decision: Decision; remarks: string };

export function PendingList({
  rows,
  partyById,
}: {
  rows: PendingRow[];
  partyById: PartyLookup;
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, { decision: null, remarks: "" }])),
  );
  const [serverError, setServerError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function setDecision(id: string, decision: Decision) {
    setState((prev) => ({
      ...prev,
      [id]: {
        decision,
        // Clear remarks if we're switching off Reject; keep otherwise.
        remarks: decision === "reject" ? (prev[id]?.remarks ?? "") : "",
      },
    }));
  }

  function setRemarks(id: string, remarks: string) {
    setState((prev) => ({
      ...prev,
      [id]: { decision: prev[id]?.decision ?? null, remarks },
    }));
  }

  function setAll(decision: Decision) {
    setState((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        next[r.id] = {
          decision,
          remarks: decision === "reject" ? (prev[r.id]?.remarks ?? "") : "",
        };
      }
      return next;
    });
  }

  const summary = useMemo(() => {
    let approveCount = 0;
    let rejectCount = 0;
    let approveTotal = 0;
    let rejectTotal = 0;
    const invalidRejects: PendingRow[] = [];
    for (const r of rows) {
      const s = state[r.id];
      if (!s) continue;
      if (s.decision === "approve") {
        approveCount += 1;
        approveTotal += r.amount;
      } else if (s.decision === "reject") {
        rejectCount += 1;
        rejectTotal += r.amount;
        if (!s.remarks.trim()) invalidRejects.push(r);
      }
    }
    return {
      approveCount,
      rejectCount,
      approveTotal,
      rejectTotal,
      net: approveTotal - rejectTotal,
      invalidRejects,
    };
  }, [rows, state]);

  const canProcess =
    !busy &&
    summary.approveCount + summary.rejectCount > 0 &&
    summary.invalidRejects.length === 0;

  async function process() {
    setServerError(null);
    setToast(null);
    const items = rows
      .map((r) => ({ row: r, s: state[r.id] }))
      .filter(({ s }) => s && s.decision !== null)
      .map(({ row, s }) => ({
        id: row.id,
        action: s!.decision as "approve" | "reject",
        note: s!.decision === "reject" ? s!.remarks.trim() : undefined,
      }));
    if (items.length === 0) return;
    startTransition(async () => {
      const res = await fetch("/api/finance/approvals/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setServerError(
          (d as { error?: string }).error === "forbidden"
            ? "You don't have permission to approve / reject."
            : "Could not process the batch — try again.",
        );
        return;
      }
      const data = (await res.json()) as {
        ok: true;
        processed: number;
        errors: Array<{ id: string; error: string }>;
      };
      if (data.errors.length === 0) {
        setToast(`${data.processed} item${data.processed === 1 ? "" : "s"} processed.`);
      } else {
        setToast(
          `${data.processed} processed, ${data.errors.length} failed (${data.errors
            .map((e) => e.error)
            .join(", ")}).`,
        );
      }
      router.refresh();
    });
  }

  const allSelected =
    rows.length > 0 && rows.every((r) => state[r.id]?.decision !== null);
  const someSelected =
    !allSelected && rows.some((r) => state[r.id]?.decision !== null);
  const firstInvalidRow = summary.invalidRejects[0];

  return (
    <div className="space-y-md">
      {/* Sticky toolbar */}
      <div className="sticky top-[64px] z-20 -mx-margin px-margin py-sm bg-surface-container-lowest border-b border-outline-variant flex flex-wrap items-center gap-md shadow-sm">
        <Stat
          label="To approve"
          count={summary.approveCount}
          total={summary.approveTotal}
          tone="success"
        />
        <Stat
          label="To reject"
          count={summary.rejectCount}
          total={summary.rejectTotal}
          tone="danger"
        />
        <div className="text-caption text-on-surface-variant">
          Net effect:{" "}
          <span className="font-mono text-on-surface">
            {summary.net >= 0 ? "+" : "−"}
            {inrFull(Math.abs(summary.net))}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-base">
          {summary.invalidRejects.length > 0 && firstInvalidRow && (
            <span className="text-label-sm font-semibold rounded-full px-md py-xs bg-amber-50 text-amber-800 border border-amber-200">
              Add a remark for {labelFor(firstInvalidRow)}
              {summary.invalidRejects.length > 1
                ? ` (+${summary.invalidRejects.length - 1} more)`
                : ""}
            </span>
          )}
          <button
            type="button"
            onClick={process}
            disabled={!canProcess}
            className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Processing…" : "Process selected"}
          </button>
        </div>
      </div>

      {toast && (
        <div className="rounded-lg bg-green-50 text-green-800 border border-green-200 px-md py-sm text-body-md">
          {toast}
        </div>
      )}
      {serverError && (
        <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-body-md">
          {serverError}
        </div>
      )}

      {/* Bulk picker row */}
      <div className="flex items-center gap-base text-caption text-on-surface-variant">
        <span>Quick mark all rows:</span>
        <button
          type="button"
          onClick={() => setAll("approve")}
          className="underline hover:text-primary"
        >
          Approve all
        </button>
        <span>·</span>
        <button
          type="button"
          onClick={() => setAll("reject")}
          className="underline hover:text-error"
        >
          Reject all
        </button>
        <span>·</span>
        <button
          type="button"
          onClick={() => setAll(null)}
          className="underline hover:text-on-surface"
        >
          Clear
        </button>
        <span className="ml-auto">
          {allSelected
            ? "All rows have a decision"
            : someSelected
              ? `${rows.length - rows.filter((r) => state[r.id]?.decision === null).length}/${rows.length} decided`
              : `${rows.length} pending`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-outline-variant">
        <table className="w-full text-body-md min-w-[1400px]">
          <thead className="bg-surface-container-low text-on-surface-variant sticky top-0 z-10">
            <tr className="text-left">
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Category</Th>
              <Th>Sub-item</Th>
              <Th>Party</Th>
              <Th>Description</Th>
              <Th>Payment</Th>
              <Th>Flow</Th>
              <Th align="right">Amount</Th>
              <Th>Submitted</Th>
              <Th>Kind</Th>
              <Th align="center">Approve</Th>
              <Th align="center">Reject</Th>
              <Th>Remarks</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = state[r.id] ?? { decision: null, remarks: "" };
              const party = r.partyId ? partyById[r.partyId] : null;
              const rowTint =
                s.decision === "approve"
                  ? "bg-green-50/40"
                  : s.decision === "reject"
                    ? "bg-amber-50/40"
                    : "";
              return (
                <tr
                  key={r.id}
                  className={"border-t border-outline-variant/60 " + rowTint}
                >
                  <td className="px-md py-sm font-mono text-on-surface">{r.date.slice(0, 10)}</td>
                  <td className="px-md py-sm">{r.type}</td>
                  <td className="px-md py-sm">{r.category}</td>
                  <td className="px-md py-sm">{r.subItem}</td>
                  <td className="px-md py-sm">
                    {party ? `${party.name} (${party.group})` : "—"}
                  </td>
                  <td className="px-md py-sm text-on-surface-variant max-w-[240px] truncate" title={r.description ?? undefined}>
                    {r.description || "—"}
                  </td>
                  <td className="px-md py-sm">{r.paymentMode}</td>
                  <td className="px-md py-sm">{r.flow}</td>
                  <td className="px-md py-sm text-right font-mono font-semibold">{inrFull(r.amount)}</td>
                  <td className="px-md py-sm text-caption">
                    <div className="text-on-surface">{r.submittedBy}</div>
                    <div className="text-on-surface-variant">{r.createdAt.slice(0, 10)}</div>
                  </td>
                  <td className="px-md py-sm">
                    <KindBadge kind={r.kind} />
                  </td>
                  <td className="px-md py-sm text-center">
                    <input
                      type="checkbox"
                      aria-label="Approve this row"
                      checked={s.decision === "approve"}
                      onChange={(e) =>
                        setDecision(r.id, e.target.checked ? "approve" : null)
                      }
                      className="w-[18px] h-[18px] cursor-pointer"
                    />
                  </td>
                  <td className="px-md py-sm text-center">
                    <input
                      type="checkbox"
                      aria-label="Reject this row"
                      checked={s.decision === "reject"}
                      onChange={(e) =>
                        setDecision(r.id, e.target.checked ? "reject" : null)
                      }
                      className="w-[18px] h-[18px] cursor-pointer"
                    />
                  </td>
                  <td className="px-md py-sm">
                    <input
                      type="text"
                      value={s.remarks}
                      onChange={(e) => setRemarks(r.id, e.target.value)}
                      disabled={s.decision !== "reject"}
                      placeholder={
                        s.decision === "reject"
                          ? "Reason (required) — what should be corrected?"
                          : "—"
                      }
                      aria-invalid={
                        s.decision === "reject" && !s.remarks.trim() ? true : undefined
                      }
                      className={
                        "w-full min-w-[220px] h-9 px-sm rounded-md border text-body-md outline-none transition " +
                        (s.decision === "reject"
                          ? !s.remarks.trim()
                            ? "border-amber-400 bg-amber-50/40 focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
                            : "border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20"
                          : "border-outline-variant/40 bg-transparent text-on-surface-variant cursor-not-allowed")
                      }
                    />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={14}
                  className="px-md py-lg text-center text-on-surface-variant"
                >
                  No pending approvals.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" | "center" }) {
  return (
    <th
      className="px-md py-sm text-label-sm uppercase font-semibold tracking-wider whitespace-nowrap"
      style={{ textAlign: align ?? "left" }}
    >
      {children}
    </th>
  );
}

function Stat({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: "success" | "danger";
}) {
  const valueColor = tone === "success" ? "text-green-700" : "text-error";
  return (
    <div className="flex items-baseline gap-xs">
      <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      <span className={"text-h3 font-bold tabular-nums " + valueColor}>{count}</span>
      <span className="text-caption text-on-surface-variant">
        · <span className="font-mono">{inrFull(total)}</span>
      </span>
    </div>
  );
}

function KindBadge({ kind }: { kind: "create" | "update" | "delete" }) {
  const label = kind === "create" ? "New" : kind === "update" ? "Edit" : "Delete";
  const cls =
    kind === "create"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : kind === "update"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : "bg-red-50 text-red-700 border-red-200";
  return (
    <span
      className={
        "inline-flex items-center px-sm py-[2px] rounded-full border text-label-sm font-semibold uppercase tracking-wider " +
        cls
      }
    >
      {label}
    </span>
  );
}

function labelFor(r: PendingRow) {
  return `${r.date.slice(0, 10)} · ${r.subItem} · ${inrFull(r.amount)}`;
}
