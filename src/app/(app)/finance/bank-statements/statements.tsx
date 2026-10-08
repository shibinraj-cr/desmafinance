"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";
import type { StatementRow } from "@/lib/bank/queries";
import { Modal, Notice, Pager, StatusChip, api, day, money, primaryBtn, secondaryBtn, td, th, time, when } from "./_ui";

const RETRYABLE = new Set(["FAILED", "MANUAL_ACTION_REQUIRED", "REVIEW_REQUIRED"]);

export function StatementsView({
  integrationId,
  rows,
  total,
  page,
  canManage,
  canDownload,
}: {
  integrationId: string;
  rows: StatementRow[];
  total: number;
  page: number;
  canManage: boolean;
  canDownload: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<StatementRow | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const failed = rows.filter((r) => r.status === "FAILED" || r.status === "MANUAL_ACTION_REQUIRED").length;

  const retry = async (ids: string[] | "failed") => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ count: number }>("/api/finance/bank-statements/retry", "POST", { integrationId, statementIds: ids });
      setMsg({ tone: "ok", text: r.count ? `${r.count} statement${r.count === 1 ? "" : "s"} queued for retry — progress shows on the Automation tab.` : "Nothing to retry." });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Retry failed" });
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("integrationId", integrationId);
      fd.set("file", file);
      const res = await fetch("/api/finance/bank-statements/upload", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { message?: string; duplicate?: boolean; status?: string; inserted?: number; duplicates?: number };
      if (!res.ok) throw new Error(data.message ?? "Upload failed");
      setMsg(
        data.duplicate
          ? { tone: "ok", text: "This PDF was already imported — nothing added." }
          : data.status === "REVIEW_REQUIRED"
            ? { tone: "error", text: "Imported for review — validation found a problem. Open Review on the statement." }
            : { tone: "ok", text: `Imported — ${data.inserted ?? 0} new transaction(s), ${data.duplicates ?? 0} already present.` },
      );
      router.refresh();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Deep link from the Transactions tab: #<statementId>.
  useEffect(() => {
    const id = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    const hit = id && rows.find((r) => r.id === id);
    if (hit) setOpen(hit);
  }, [rows]);

  return (
    <div className="space-y-md">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Section
        title="Statements"
        action={
          canManage ? (
            <div className="flex flex-wrap gap-sm">
              {failed > 0 && (
                <button type="button" className={secondaryBtn} disabled={busy} onClick={() => retry("failed")}>
                  <span className="material-symbols-outlined text-[18px]">replay</span>Retry failed ({failed})
                </button>
              )}
              <button type="button" className={secondaryBtn} disabled={busy} onClick={() => fileRef.current?.click()}>
                <span className="material-symbols-outlined text-[18px]">upload_file</span>Upload PDF
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
            </div>
          ) : undefined
        }
      >
        {rows.length === 0 ? (
          <p className="py-lg text-center text-on-surface-variant">No statements yet. Run the automation or a backfill from the Automation tab.</p>
        ) : (
          <div className="overflow-x-auto -mx-lg">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container text-on-surface-variant text-caption uppercase tracking-wide">
                <tr>
                  <th className={th}>Statement date</th>
                  <th className={`${th} hidden lg:table-cell`}>Period</th>
                  <th className={`${th} hidden md:table-cell`}>Email received</th>
                  <th className={`${th} hidden xl:table-cell`}>Message ID</th>
                  <th className={`${th} text-right`}>Txns</th>
                  <th className={`${th} text-right hidden md:table-cell`}>Total debit</th>
                  <th className={`${th} text-right hidden md:table-cell`}>Total credit</th>
                  <th className={`${th} text-right hidden lg:table-cell`}>Opening</th>
                  <th className={`${th} text-right hidden lg:table-cell`}>Closing</th>
                  <th className={th}>Status</th>
                  <th className={`${th} hidden lg:table-cell`}>Processed</th>
                  <th className={`${th} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {rows.map((s) => (
                  <tr key={s.id} id={s.id} className="hover:bg-surface-container-low">
                    <td className={`${td} whitespace-nowrap font-semibold`}>{day(s.periodEnd)}</td>
                    <td className={`${td} whitespace-nowrap hidden lg:table-cell text-on-surface-variant`}>
                      {s.periodStart === s.periodEnd ? "1 day" : `${day(s.periodStart)} → ${day(s.periodEnd)}`}
                    </td>
                    <td className={`${td} whitespace-nowrap hidden md:table-cell`}>{s.source === "upload" ? "Uploaded" : when(s.receivedAt)}</td>
                    <td className={`${td} hidden xl:table-cell text-data-mono text-caption`}>{s.gmailMessageId ?? "—"}</td>
                    <td className={`${td} text-right`}>
                      {s.transactionCount ?? "—"}
                      {!!s.duplicateCount && <div className="text-caption text-on-surface-variant">{s.duplicateCount} dup</div>}
                    </td>
                    <td className={`${td} text-right whitespace-nowrap hidden md:table-cell`}>{money(s.totalDebit)}</td>
                    <td className={`${td} text-right whitespace-nowrap hidden md:table-cell`}>{money(s.totalCredit)}</td>
                    <td className={`${td} text-right whitespace-nowrap hidden lg:table-cell`}>{money(s.openingBalance)}</td>
                    <td className={`${td} text-right whitespace-nowrap hidden lg:table-cell`}>{money(s.closingBalance)}</td>
                    <td className={td}>
                      <StatusChip status={s.status} title={s.lastError ?? undefined} />
                      {s.lastError && <div className="text-caption text-on-surface-variant mt-[2px] max-w-[260px] line-clamp-2">{s.lastError}</div>}
                      {s.nextAttemptAt && <div className="text-caption text-on-surface-variant">Retry {when(s.nextAttemptAt)}</div>}
                    </td>
                    <td className={`${td} whitespace-nowrap hidden lg:table-cell text-caption`}>{when(s.processedAt)}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>
                      <div className="flex justify-end gap-md">
                        {canDownload && s.hasPdf && (
                          <a className="text-primary font-semibold hover:underline" href={`/api/finance/bank-statements/${s.id}/pdf`} target="_blank" rel="noopener">
                            PDF
                          </a>
                        )}
                        <button type="button" className="text-primary font-semibold hover:underline" onClick={() => setOpen(s)}>
                          {s.status === "REVIEW_REQUIRED" && canManage ? "Review" : "Details"}
                        </button>
                        {canManage && RETRYABLE.has(s.status) && s.status !== "REVIEW_REQUIRED" && (
                          <button type="button" className="text-primary font-semibold hover:underline" disabled={busy} onClick={() => retry([s.id])}>
                            Retry
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} total={total} />
      </Section>
      {open && <StatementDetail statement={open} canManage={canManage} onClose={() => setOpen(null)} onRetry={() => retry([open.id])} />}
    </div>
  );
}

type Detail = {
  events: Array<{ id: string; level: string; step: string; message: string; createdAt: string }>;
  held: Array<{ date: string; description: string; reference: string | null; debit: number; credit: number; balance: number | null }>;
};

function StatementDetail({ statement: s, canManage, onClose, onRetry }: { statement: StatementRow; canManage: boolean; onClose: () => void; onRetry: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Detail>(`/api/finance/bank-statements/${s.id}`, "GET").then(setD, (e) => setError(e instanceof Error ? e.message : "Could not load"));
  }, [s.id]);

  const decide = async (action: "approve" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/finance/bank-statements/${s.id}/review`, "POST", { action, note: note || undefined });
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the decision");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Statement ${day(s.periodEnd)}`} subtitle={`${s.account} · ${s.status.replace(/_/g, " ").toLowerCase()}`} onClose={onClose}>
      <div className="max-h-[65vh] overflow-y-auto space-y-md pr-xs">
        {s.errors.length > 0 && (
          <Notice tone="warn">
            <b>Validation found {s.errors.length} problem{s.errors.length === 1 ? "" : "s"}:</b>
            <ul className="list-disc ml-md mt-xs">
              {s.errors.slice(0, 8).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Notice>
        )}
        {s.warnings.length > 0 && <p className="text-caption text-on-surface-variant">Warnings: {s.warnings.slice(0, 5).join(" · ")}</p>}

        {d && d.held.length > 0 && (
          <div>
            <h4 className="text-label-sm font-semibold mb-xs">Rows held for review ({d.held.length}) — nothing has been imported</h4>
            <div className="overflow-x-auto border border-outline-variant rounded-lg">
              <table className="w-full text-caption">
                <thead className="bg-surface-container">
                  <tr>
                    <th className="text-left px-sm py-xs">Date</th>
                    <th className="text-left px-sm py-xs">Narration</th>
                    <th className="text-right px-sm py-xs">Debit</th>
                    <th className="text-right px-sm py-xs">Credit</th>
                    <th className="text-right px-sm py-xs">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {d.held.map((r, i) => (
                    <tr key={i}>
                      <td className="px-sm py-xs whitespace-nowrap">{day(r.date)}</td>
                      <td className="px-sm py-xs">{r.description}</td>
                      <td className="px-sm py-xs text-right whitespace-nowrap">{r.debit ? money(r.debit) : ""}</td>
                      <td className="px-sm py-xs text-right whitespace-nowrap">{r.credit ? money(r.credit) : ""}</td>
                      <td className="px-sm py-xs text-right whitespace-nowrap">{money(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div>
          <h4 className="text-label-sm font-semibold mb-xs">Timeline</h4>
          {!d ? (
            <p className="text-on-surface-variant text-body-md">Loading…</p>
          ) : d.events.length === 0 ? (
            <p className="text-on-surface-variant text-body-md">No events recorded.</p>
          ) : (
            <ol className="space-y-[2px] text-body-md">
              {d.events.map((e) => (
                <li key={e.id} className={`flex gap-sm ${e.level === "error" ? "text-red-700" : e.level === "warn" ? "text-amber-800" : ""}`}>
                  <span className="text-data-mono text-caption text-on-surface-variant w-[64px] flex-shrink-0">{time(e.createdAt)}</span>
                  <span className="break-words">{e.message}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {canManage && s.status === "REVIEW_REQUIRED" ? (
        <div className="space-y-sm">
          <input className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md" placeholder="Decision note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          <div className="flex flex-wrap justify-end gap-sm">
            <button type="button" className={secondaryBtn} disabled={busy} onClick={onRetry}>
              Re-parse
            </button>
            <button type="button" className={secondaryBtn} disabled={busy} onClick={() => decide("reject")}>
              Reject
            </button>
            <button type="button" className={primaryBtn} disabled={busy} onClick={() => decide("approve")}>
              Approve &amp; import
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <button type="button" className={secondaryBtn} onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </Modal>
  );
}
