"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type QueueItem = {
  key: string;
  userId: string;
  date: string;
  displayName: string;
  role: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  meta: {
    totalFollowups: number | null;
    referredToDoc: number | null;
    referredToAbroad: number | null;
    notes: string | null;
  };
  rows: Array<{
    sourceCode: string;
    sourceLabel: string;
    roleAtEntry: string;
    leadsReceived: number | null;
    connectedCalls: number | null;
    disqualified: number | null;
    transferredToL2: number | null;
    receivedFromL1: number | null;
    directLeads: number | null;
    connected: number | null;
    quoteSent: number | null;
    closedWon: number | null;
    closedLost: number | null;
  }>;
};

type StatusKey = "submitted" | "approved" | "rejected";

function fmtDDMMYY(s: string | null): string {
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[3]}-${m[2]}-${m[1].slice(2)}`;
}

export function ApprovalsClient({
  status,
  items,
  counts,
}: {
  status: StatusKey;
  items: QueueItem[];
  counts: { submitted: number; approved: number; rejected: number };
}) {
  const router = useRouter();
  const [openKey, setOpenKey] = useState<string | null>(items[0]?.key ?? null);
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [busy, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);

  async function act(item: QueueItem, action: "approve" | "reject") {
    setRowError((m) => ({ ...m, [item.key]: "" }));
    const note = rejectNote[item.key]?.trim() ?? "";
    if (action === "reject" && note.length === 0) {
      setRowError((m) => ({ ...m, [item.key]: "Add a remark explaining the rejection." }));
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/marketing/lead-pulse/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: item.userId,
          date: item.date,
          action,
          note: action === "reject" ? note : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setRowError((m) => ({
          ...m,
          [item.key]: (d as { error?: string }).error ?? "Action failed.",
        }));
        return;
      }
      setToast(
        action === "approve"
          ? `Approved ${item.displayName} — ${fmtDDMMYY(item.date)}.`
          : `Sent back to ${item.displayName} — ${fmtDDMMYY(item.date)}.`,
      );
      router.refresh();
    });
  }

  async function unlockForEdit(item: QueueItem) {
    setRowError((m) => ({ ...m, [item.key]: "" }));
    if (!confirm(
      `Unlock ${item.displayName}'s entry for ${item.date} so they can edit it?\n\n` +
        `Their daily-entry form will become editable again. You'll need to re-approve after they re-submit.`,
    )) {
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/marketing/lead-pulse/lock-override", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: item.userId, date: item.date }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setRowError((m) => ({
          ...m,
          [item.key]: (d as { error?: string }).error ?? "Unlock failed.",
        }));
        return;
      }
      setToast(`Unlocked ${item.displayName} — ${fmtDDMMYY(item.date)}. They can edit + re-submit now.`);
      router.refresh();
    });
  }

  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Daily Entry Approvals</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            Verify each BDE&apos;s submitted day before it counts toward dashboards.
            Reject with a remark to send it back for correction.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-[6px]">
        {(
          [
            { key: "submitted", label: "Pending", count: counts.submitted },
            { key: "approved", label: "Approved", count: counts.approved },
            { key: "rejected", label: "Rejected", count: counts.rejected },
          ] as Array<{ key: StatusKey; label: string; count: number }>
        ).map((t) => {
          const active = status === t.key;
          return (
            <Link
              key={t.key}
              href={`/marketing/lead-pulse/approvals?status=${t.key}`}
              scroll={false}
              className="inline-flex items-center gap-[6px] h-[34px] px-[12px] rounded-full border text-[12px] font-semibold transition"
              style={{
                backgroundColor: active ? "var(--lp-primary)" : "transparent",
                color: active ? "var(--lp-on-primary)" : "var(--lp-on-surface)",
                borderColor: active ? "var(--lp-primary)" : "var(--lp-outline-variant)",
              }}
            >
              {t.label}
              <span
                className="text-[10px] px-[6px] py-[1px] rounded-full"
                style={{
                  backgroundColor: active ? "rgba(0,0,0,0.18)" : "var(--lp-surface-container-low)",
                  color: active ? "var(--lp-on-primary)" : "var(--lp-on-surface-variant)",
                }}
              >
                {t.count}
              </span>
            </Link>
          );
        })}
      </div>

      {toast && (
        <div
          className="rounded-[10px] border-2 p-[12px] flex items-center gap-[10px]"
          style={{
            backgroundColor: "rgba(51, 228, 255, 0.12)",
            borderColor: "var(--lp-cyan)",
            color: "var(--lp-on-surface)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 22, color: "var(--lp-cyan)" }}>
            check_circle
          </span>
          <span className="text-[13px] font-semibold">{toast}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-auto text-[11px] underline"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div
          className="rounded-[12px] border p-[24px] text-center"
          style={{
            backgroundColor: "var(--lp-surface-container)",
            borderColor: "var(--lp-outline-variant)",
            color: "var(--lp-on-surface-variant)",
          }}
        >
          {status === "submitted"
            ? "No entries waiting for review."
            : status === "approved"
              ? "No approved entries in the recent window."
              : "No rejected entries in the queue."}
        </div>
      ) : (
        <ul className="space-y-[12px]">
          {items.map((item) => {
            const isOpen = openKey === item.key;
            const role = item.role.toUpperCase();
            return (
              <li
                key={item.key}
                className="rounded-[12px] border"
                style={{
                  backgroundColor: "var(--lp-surface-container)",
                  borderColor: "var(--lp-outline-variant)",
                }}
              >
                <button
                  onClick={() => setOpenKey(isOpen ? null : item.key)}
                  className="w-full flex flex-wrap items-center gap-[12px] px-[16px] py-[12px] text-left"
                >
                  <span
                    className="text-[11px] font-bold uppercase tracking-widest px-[8px] py-[2px] rounded-full"
                    style={{
                      backgroundColor: "var(--lp-surface-container-low)",
                      color:
                        role === "L1"
                          ? "var(--lp-primary)"
                          : role === "L2"
                            ? "var(--lp-cyan)"
                            : "var(--lp-on-surface-variant)",
                    }}
                  >
                    {role}
                  </span>
                  <span className="text-[15px] font-semibold" style={{ color: "var(--lp-on-surface)" }}>
                    {item.displayName}
                  </span>
                  <span className="text-[12px] font-mono" style={{ color: "var(--lp-on-surface-variant)" }}>
                    {fmtDDMMYY(item.date)}
                  </span>
                  <span className="ml-auto text-[11px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                    {status === "submitted"
                      ? `submitted ${fmtDDMMYY(item.submittedAt)}`
                      : item.reviewedBy
                        ? `${status === "approved" ? "approved" : "rejected"} by ${item.reviewedBy} on ${fmtDDMMYY(item.reviewedAt)}`
                        : ""}
                  </span>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 20, color: "var(--lp-on-surface-variant)" }}
                  >
                    {isOpen ? "expand_less" : "expand_more"}
                  </span>
                </button>

                {isOpen && (
                  <div className="px-[16px] pb-[14px] space-y-[12px]">
                    <EntryTable item={item} />
                    {item.reviewNote && (
                      <div
                        className="rounded-[8px] border p-[10px] text-[12px]"
                        style={{
                          backgroundColor: "rgba(255, 180, 171, 0.10)",
                          borderColor: "var(--lp-error)",
                          color: "var(--lp-on-surface)",
                        }}
                      >
                        <strong>Previous review note:</strong> {item.reviewNote}
                      </div>
                    )}
                    {status === "approved" && (
                      <div className="flex flex-wrap items-center gap-[12px]">
                        <button
                          onClick={() => unlockForEdit(item)}
                          disabled={busy}
                          className="h-[34px] px-[14px] rounded-[8px] text-[12px] font-semibold border"
                          style={{
                            borderColor: "var(--lp-primary)",
                            color: "var(--lp-primary)",
                            backgroundColor: "rgba(250, 204, 21, 0.10)",
                            opacity: busy ? 0.6 : 1,
                          }}
                          title="Unlock so the BDE can correct + re-submit this entry"
                        >
                          Unlock for edit
                        </button>
                        {rowError[item.key] && (
                          <p className="text-[12px]" style={{ color: "var(--lp-error)" }}>
                            {rowError[item.key]}
                          </p>
                        )}
                      </div>
                    )}
                    {status === "submitted" && (
                      <div className="space-y-[8px]">
                        <textarea
                          value={rejectNote[item.key] ?? ""}
                          onChange={(e) =>
                            setRejectNote((m) => ({ ...m, [item.key]: e.target.value }))
                          }
                          rows={2}
                          placeholder="Remark (required when rejecting) — what should the BDE correct?"
                          className="w-full rounded-[8px] px-[10px] py-[8px] text-[13px] border outline-none"
                          style={{
                            backgroundColor: "var(--lp-surface-container-high)",
                            borderColor: "var(--lp-outline-variant)",
                            color: "var(--lp-on-surface)",
                          }}
                        />
                        {rowError[item.key] && (
                          <p className="text-[12px]" style={{ color: "var(--lp-error)" }}>
                            {rowError[item.key]}
                          </p>
                        )}
                        <div className="flex items-center gap-[8px]">
                          <button
                            onClick={() => act(item, "approve")}
                            disabled={busy}
                            className="h-[36px] px-[16px] rounded-[8px] text-[13px] font-bold"
                            style={{
                              backgroundColor: "var(--lp-primary)",
                              color: "var(--lp-on-primary)",
                              opacity: busy ? 0.6 : 1,
                            }}
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => act(item, "reject")}
                            disabled={busy}
                            className="h-[36px] px-[16px] rounded-[8px] text-[13px] font-semibold border"
                            style={{
                              borderColor: "var(--lp-error)",
                              color: "var(--lp-error)",
                              opacity: busy ? 0.6 : 1,
                            }}
                          >
                            Reject &amp; send back
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EntryTable({ item }: { item: QueueItem }) {
  const isL1 = item.role.toLowerCase() === "l1";
  const rowsToShow = item.rows.filter((r) => {
    if (isL1) {
      return (
        (r.leadsReceived ?? 0) +
          (r.connectedCalls ?? 0) +
          (r.disqualified ?? 0) +
          (r.transferredToL2 ?? 0) >
        0
      );
    }
    return (
      (r.receivedFromL1 ?? 0) +
        (r.directLeads ?? 0) +
        (r.disqualified ?? 0) +
        (r.closedWon ?? 0) >
      0
    );
  });
  if (rowsToShow.length === 0) {
    return (
      <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        All values are zero on this day.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-[8px] border" style={{ borderColor: "var(--lp-outline-variant)" }}>
      <table className="w-full text-[12px] tabular-nums">
        <thead style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
          <tr>
            <Th>Source</Th>
            {isL1 ? (
              <>
                <Th align="right">Leads Recv</Th>
                <Th align="right">Connected</Th>
                <Th align="right">Disqualified</Th>
                <Th align="right">Transferred</Th>
              </>
            ) : (
              <>
                <Th align="right">From L1</Th>
                <Th align="right">Direct</Th>
                <Th align="right">Disqualified</Th>
                <Th align="right">Closed-Won</Th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rowsToShow.map((r) => (
            <tr
              key={r.sourceCode}
              className="border-t"
              style={{ borderColor: "var(--lp-outline-variant)" }}
            >
              <td className="px-[10px] py-[6px]" style={{ color: "var(--lp-on-surface)" }}>{r.sourceLabel}</td>
              {isL1 ? (
                <>
                  <Cell n={r.leadsReceived ?? 0} />
                  <Cell n={r.connectedCalls ?? 0} />
                  <Cell n={r.disqualified ?? 0} />
                  <Cell n={r.transferredToL2 ?? 0} />
                </>
              ) : (
                <>
                  <Cell n={r.receivedFromL1 ?? 0} />
                  <Cell n={r.directLeads ?? 0} />
                  <Cell n={r.disqualified ?? 0} />
                  <Cell n={r.closedWon ?? 0} gold />
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div
        className="px-[10px] py-[6px] text-[11px] flex flex-wrap gap-[10px]"
        style={{ color: "var(--lp-on-surface-variant)" }}
      >
        {item.meta.totalFollowups != null && <span>Total Follow-ups: {item.meta.totalFollowups}</span>}
        {item.meta.referredToDoc != null && <span>Referred to Doc: {item.meta.referredToDoc}</span>}
        {item.meta.referredToAbroad != null && <span>Study Abroad: {item.meta.referredToAbroad}</span>}
        {item.meta.notes && <span>Notes: {item.meta.notes}</span>}
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className="px-[10px] py-[6px] text-[10px] uppercase tracking-widest font-semibold"
      style={{ color: "var(--lp-on-surface-variant)", textAlign: align ?? "left" }}
    >
      {children}
    </th>
  );
}

function Cell({ n, gold }: { n: number; gold?: boolean }) {
  return (
    <td
      className="px-[10px] py-[6px] text-right font-mono"
      style={{ color: gold ? "var(--lp-primary)" : "var(--lp-on-surface)" }}
    >
      {n}
    </td>
  );
}
