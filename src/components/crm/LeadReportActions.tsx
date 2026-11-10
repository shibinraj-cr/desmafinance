"use client";

/**
 * The interactive pieces of the daily lead report: the cutoff countdown, the
 * "contact before the cutoff" list, the handover table and its Reject /
 * Reopen, the WhatsApp share box and the admin's Unlock. Display-only pieces
 * are in LeadReportParts.tsx.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { contactHint, type ContactHalves } from "@/lib/crm-contact";
import { HANDOVER_REJECT_REASONS, handoverChannel } from "@/lib/crm-handover";
import { Chip, HandoverStatusChip, istDayTime, istTime, tableTd, tableTh } from "./LeadReportParts";

const btn =
  "inline-flex h-9 items-center gap-xs rounded-lg border border-outline-variant px-md text-label-sm font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-50";
const btnPrimary =
  "inline-flex h-9 items-center gap-xs rounded-lg bg-primary px-md text-label-sm font-bold text-on-primary hover:opacity-90 disabled:opacity-50";
const btnLink = "inline-flex h-9 items-center px-sm text-label-sm font-semibold text-accent hover:underline";
const inputCls =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-md text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";

function Icon({ name }: { name: string }) {
  return (
    <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">
      {name}
    </span>
  );
}

function Modal({ title, onClose, busy, children }: { title: string; onClose: () => void; busy?: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-lg space-y-md"
      >
        <h3 className="text-h3 text-on-surface">{title}</h3>
        {children}
      </div>
    </div>,
    document.body,
  );
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  return d.message || fallback;
}

// ── Cutoff countdown ─────────────────────────────────────────────────────────

/** "Cutoff 5:00 pm · 2h 14m left", ticking; orange in the last hour; grey once passed. */
export function CutoffPill({ cutoff }: { cutoff: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const base = "inline-flex items-center gap-xs rounded-full px-md py-xs text-label-sm font-semibold";
  if (!cutoff) {
    return (
      <span className={`${base} bg-surface-container-high text-on-surface-variant`}>
        <Icon name="schedule" /> No cutoff today — new leads are due next working day
      </span>
    );
  }
  const at = istTime(cutoff);
  if (now === null) return <span className={`${base} bg-surface-container-high text-on-surface-variant`}>Cutoff {at}</span>;
  const left = new Date(cutoff).getTime() - now;
  if (left <= 0) {
    return (
      <span className={`${base} bg-surface-container-high text-on-surface`}>
        <Icon name="schedule" /> Cutoff passed · {at}
      </span>
    );
  }
  const mins = Math.ceil(left / 60_000);
  const text = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`;
  return (
    <span className={`${base} ${mins <= 60 ? "bg-orange-50 text-orange-800" : "bg-blue-50 text-blue-800"}`}>
      <Icon name="schedule" /> Cutoff {at} · {text}
    </span>
  );
}

// ── Contact before the cutoff ────────────────────────────────────────────────

export type QueueRow = {
  assignmentId: string;
  leadId: string;
  candidateName: string;
  phone: string | null;
  sourceLabel: string | null;
  assignedAt: string;
  dueAt: string;
  status: "pending" | "missed";
  halves: ContactHalves;
};

function NoteModal({ leadId, name, onClose }: { leadId: string; name: string; onClose: () => void }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!body.trim()) return setError("Write the note first.");
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/leads/${leadId}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: body.trim() }),
    });
    setBusy(false);
    if (!res.ok) return setError(await errorOf(res, "Could not save the note."));
    onClose();
    router.refresh();
  }
  return (
    <Modal title={`Add note — ${name}`} onClose={onClose} busy={busy}>
      <textarea className={inputCls} rows={4} value={body} onChange={(e) => setBody(e.target.value)} autoFocus aria-label="Note" />
      {error && <p className="text-label-sm font-semibold text-error">{error}</p>}
      <div className="flex justify-end gap-base">
        <button type="button" className={btn} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={btnPrimary} onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save note"}
        </button>
      </div>
    </Modal>
  );
}

/** Logs the WhatsApp contact (so it counts), then opens the chat. */
async function openWhatsApp(leadId: string): Promise<string | null> {
  const res = await fetch(`/api/crm/leads/${leadId}/comms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channel: "whatsapp" }),
  });
  if (!res.ok) return errorOf(res, "Could not open WhatsApp.");
  const d = (await res.json()) as { url?: string };
  if (d.url) window.open(d.url, "_blank", "noopener");
  return null;
}

export function ContactQueue({ rows, readOnly }: { rows: QueueRow[]; readOnly: boolean }) {
  const router = useRouter();
  const [noteFor, setNoteFor] = useState<QueueRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0) {
    return <p className="py-md text-center text-label-sm text-on-surface-variant">Every lead due has been contacted.</p>;
  }
  return (
    <>
      {error && <p className="mb-sm text-label-sm font-semibold text-error">{error}</p>}
      <ul className="space-y-sm">
        {rows.map((r) => {
          const hint = contactHint(r.halves);
          const noteFirst = r.halves.call && !r.halves.note;
          return (
            <li key={r.assignmentId} className="rounded-lg border border-outline-variant p-md">
              <div className="flex flex-wrap items-baseline justify-between gap-sm">
                <Link href={`/crm/leads/${r.leadId}`} className="font-semibold text-on-surface hover:underline">
                  {r.candidateName}
                </Link>
                <span className="text-caption text-on-surface-variant">
                  {[r.sourceLabel, `assigned ${istTime(r.assignedAt)}`].filter(Boolean).join(" · ")}
                </span>
              </div>
              <div className="mt-xs flex flex-wrap items-center gap-sm text-caption text-on-surface-variant">
                {r.phone && <span>{r.phone}</span>}
                {r.status === "missed" ? (
                  <Chip tone="orange">Missed — was due {istDayTime(r.dueAt)}</Chip>
                ) : (
                  <span>due {istTime(r.dueAt)}</span>
                )}
                {hint && <span className="font-semibold text-blue-800">{hint}</span>}
              </div>
              {!readOnly && (
                <div className="mt-sm flex flex-wrap gap-sm">
                  {r.phone && !noteFirst && (
                    <a href={`tel:${r.phone}`} className={btnPrimary}>
                      <Icon name="call" /> Call
                    </a>
                  )}
                  <button type="button" className={noteFirst ? btnPrimary : btn} onClick={() => setNoteFor(r)}>
                    <Icon name="edit_note" /> Add note
                  </button>
                  {r.phone && (
                    <button
                      type="button"
                      className={btn}
                      onClick={async () => {
                        setError(await openWhatsApp(r.leadId));
                        router.refresh();
                      }}
                    >
                      <Icon name="chat" /> WhatsApp
                    </button>
                  )}
                  <Link href={`/crm/leads/${r.leadId}`} className={btnLink}>
                    Open lead
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {noteFor && <NoteModal leadId={noteFor.leadId} name={noteFor.candidateName} onClose={() => setNoteFor(null)} />}
    </>
  );
}

// ── Handovers ────────────────────────────────────────────────────────────────

export type HandoverListRow = {
  id: string;
  handoverDate: string;
  channel: string;
  leadName: string | null;
  phone: string;
  note: string | null;
  status: string;
  isLate: boolean;
  rejectReason: string | null;
  rejectNote: string | null;
  dueAt: string;
  createdAt: string;
  assignedBde: { id: string; name: string };
  createdByName: string | null;
  linkedLead: { id: string; candidateName: string; ownerName: string | null } | null;
};

function RejectModal({ row, onClose }: { row: HandoverListRow; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState<string>(HANDOVER_REJECT_REASONS[0].code);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/handovers/${row.id}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, note: note.trim() || null }),
    });
    setBusy(false);
    if (!res.ok) return setError(await errorOf(res, "Could not reject the handover."));
    onClose();
    router.refresh();
  }
  return (
    <Modal title={`Reject — ${row.leadName ?? row.phone}`} onClose={onClose} busy={busy}>
      <fieldset className="space-y-xs">
        <legend className="mb-xs text-label-sm font-semibold text-on-surface">Reason</legend>
        {HANDOVER_REJECT_REASONS.map((r) => (
          <label key={r.code} className="flex items-center gap-sm text-body-md text-on-surface">
            <input type="radio" name="reject-reason" value={r.code} checked={reason === r.code} onChange={() => setReason(r.code)} />
            {r.label}
          </label>
        ))}
      </fieldset>
      <label className="block space-y-xs">
        <span className="text-label-sm font-semibold text-on-surface">Note{reason === "other" ? " (required)" : " (optional)"}</span>
        <textarea className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="text-label-sm font-semibold text-error">{error}</p>}
      <div className="flex justify-end gap-base">
        <button type="button" className={btn} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={btnPrimary} onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Reject"}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Handovers as a table. On My Day (`viewerId` = the BDE) open ones get Create
 * lead and Reject; on Lead Handovers the Marketing Admin gets Reopen on
 * rejected ones and may cancel an open one.
 */
export function HandoverTable({
  rows,
  viewerId,
  canManage,
  readOnly,
  showBde,
}: {
  rows: HandoverListRow[];
  viewerId: string;
  canManage: boolean;
  readOnly: boolean;
  showBde: boolean;
}) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState<HandoverListRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0) {
    return <p className="py-md text-center text-label-sm text-on-surface-variant">No handovers.</p>;
  }
  async function reopen(id: string) {
    setError(null);
    const res = await fetch(`/api/crm/handovers/${id}/reopen`, { method: "POST" });
    if (!res.ok) return setError(await errorOf(res, "Could not reopen it."));
    router.refresh();
  }
  return (
    <>
      {error && <p className="mb-sm text-label-sm font-semibold text-error">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={tableTh}>Given</th>
              <th className={tableTh}>Source</th>
              <th className={tableTh}>Name</th>
              <th className={tableTh}>Phone</th>
              {showBde && <th className={tableTh}>BDE</th>}
              <th className={tableTh}>Note</th>
              <th className={tableTh}>Status</th>
              <th className={tableTh}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const open = h.status === "pending" || h.status === "overdue";
              const mine = h.assignedBde.id === viewerId;
              const reason = HANDOVER_REJECT_REASONS.find((r) => r.code === h.rejectReason)?.label;
              return (
                <tr key={h.id}>
                  <td className={`${tableTd} whitespace-nowrap`}>{istDayTime(h.createdAt)}</td>
                  <td className={tableTd}>{handoverChannel(h.channel)?.label ?? h.channel}</td>
                  <td className={`${tableTd} font-medium`}>{h.leadName ?? "—"}</td>
                  <td className={`${tableTd} whitespace-nowrap`}>{h.phone}</td>
                  {showBde && <td className={tableTd}>{h.assignedBde.name}</td>}
                  <td className={`${tableTd} text-on-surface-variant`}>
                    {[h.note, reason ? `Rejected: ${reason}${h.rejectNote ? ` — ${h.rejectNote}` : ""}` : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                    {h.status === "duplicate" && h.linkedLead && (
                      <div>
                        Already a lead{h.linkedLead.ownerName ? `, owner ${h.linkedLead.ownerName}` : ", unassigned"}
                      </div>
                    )}
                  </td>
                  <td className={tableTd}>
                    <HandoverStatusChip status={h.status} isLate={h.isLate} />
                    {open && <div className="mt-[2px] text-caption text-on-surface-variant">by {istDayTime(h.dueAt)}</div>}
                  </td>
                  <td className={`${tableTd} whitespace-nowrap text-right`}>
                    {!readOnly && open && mine && (
                      <Link href={`/crm/leads?handover=${h.id}`} className={btnPrimary}>
                        Create lead
                      </Link>
                    )}
                    {!readOnly && open && (mine || canManage) && (
                      <button type="button" className={`${btn} ml-xs`} onClick={() => setRejecting(h)}>
                        {mine ? "Reject" : "Cancel"}
                      </button>
                    )}
                    {!readOnly && h.status === "rejected" && canManage && (
                      <button type="button" className={btn} onClick={() => reopen(h.id)}>
                        Reopen
                      </button>
                    )}
                    {h.linkedLead && (
                      <Link href={`/crm/leads/${h.linkedLead.id}`} className={btnLink}>
                        View lead
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rejecting && <RejectModal row={rejecting} onClose={() => setRejecting(null)} />}
    </>
  );
}

// ── Share text + unlock ──────────────────────────────────────────────────────

/** "Copy for WhatsApp" with the preview the team already posts. */
export function ShareBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this text:", text);
    }
  }
  return (
    <div className="space-y-sm">
      <div className="flex items-center justify-between gap-sm">
        <span className="text-label-sm text-on-surface-variant">WhatsApp preview</span>
        <button type="button" className={btn} onClick={copy}>
          <Icon name={copied ? "check" : "content_copy"} /> {copied ? "Copied" : "Copy for WhatsApp"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap rounded-lg border border-outline-variant bg-surface-container-low p-md font-mono text-[12.5px] leading-relaxed text-on-surface">
        {text}
      </pre>
    </div>
  );
}

/** An admin reopens a submitted day so the BDE can correct and submit it again. */
export function UnlockButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-sm">
      <button
        type="button"
        className={btn}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch(`/api/crm/report/${reportId}/unlock`, { method: "POST" });
          setBusy(false);
          if (!res.ok) return setError(await errorOf(res, "Could not unlock."));
          router.refresh();
        }}
      >
        <Icon name="lock_open" /> {busy ? "Unlocking…" : "Unlock day"}
      </button>
      {error && <span className="text-label-sm font-semibold text-error">{error}</span>}
    </span>
  );
}
