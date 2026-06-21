"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { LeadRow, NoteRow, ActivityRow, TaskRow } from "@/lib/crm-leads";
import { renderTemplate } from "@/lib/crm";
import { StatusPill, type StatusOpt, type Opt, type BdeOpt } from "../client";

export type DetailMasters = {
  statuses: StatusOpt[];
  sources: Opt[];
  services: Opt[];
  qualifications: Opt[];
  bdes: BdeOpt[];
  parties: Opt[];
};
export type DetailAccess = {
  isAdmin: boolean;
  canAssign: boolean;
  canViewHistory: boolean;
  userId: string;
};

// ── class strings ───────────────────────────────────────────────────────────
const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";
const primaryBtn =
  "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
const secondaryBtn =
  "h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition";
const cardCls = "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg space-y-md";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
    </label>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dd} ${MONTHS[d.getMonth()]} ${yy}, ${hh}:${mm}`;
}
function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDateTime(iso);
}

const ACTIVITY_ICON: Record<string, string> = {
  LEAD_CREATED: "add_circle",
  LEAD_IMPORTED: "upload",
  LEAD_OPENED: "visibility",
  STATUS_CHANGED: "flag",
  FIELD_UPDATED: "edit",
  ASSIGNED: "person_add",
  REASSIGNED: "swap_horiz",
  UNASSIGNED: "person_remove",
  NOTE_ADDED: "sticky_note_2",
  NOTE_EDITED: "edit_note",
  NOTE_DELETED: "delete",
  EMAIL_SENT: "mail",
  WHATSAPP_SENT: "chat",
  CALL_LOGGED: "call",
  PARTY_LINKED: "link",
  TASK_CREATED: "add_task",
  TASK_COMPLETED: "task_alt",
  TASK_REOPENED: "restart_alt",
  TASK_UPDATED: "edit",
  TASK_DELETED: "delete",
};

function Avatar({ name }: { name: string | null }) {
  const initials = (name ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span className="inline-grid place-items-center h-7 w-7 rounded-full bg-surface-container-high text-on-surface-variant text-[11px] font-bold flex-shrink-0">
      {initials}
    </span>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────
function Modal({
  title,
  onClose,
  children,
  busy,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  busy?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md" onClick={() => !busy && onClose()}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
      >
        <h3 className="text-h3 text-on-surface">{title}</h3>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export type DuplicateRow = {
  id: string;
  candidateName: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  source: string | null;
  status: { label: string; color: string | null };
  matchedOn: string; // "email", "phone", or "email + phone"
};

// Banner shown on a lead that shares an email or phone with other lead(s) — so a
// "Duplicate"-flagged lead reveals exactly which record(s) it matches.
function DuplicatesBanner({ duplicates }: { duplicates: DuplicateRow[] }) {
  const fields = Array.from(new Set(duplicates.flatMap((d) => d.matchedOn.split(" + ")).filter(Boolean)));
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-md">
      <div className="flex items-center gap-xs text-amber-800 font-semibold">
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
          content_copy
        </span>
        {duplicates.length} possible duplicate{duplicates.length === 1 ? "" : "s"}
        {fields.length > 0 && <span className="font-normal text-amber-700">— same {fields.join(" / ")}</span>}
      </div>
      <ul className="mt-sm space-y-xs">
        {duplicates.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-xs text-body-md">
            <Link href={`/crm/leads/${d.id}`} className="font-semibold text-on-surface hover:text-primary hover:underline">
              {d.candidateName}
            </Link>
            <span className="text-on-surface-variant">· {d.phone ?? d.email ?? "—"}</span>
            {d.source && <span className="text-on-surface-variant">· {d.source}</span>}
            <span
              className="px-xs py-[1px] rounded-full text-[10px] font-bold"
              style={{ backgroundColor: (d.status.color ?? "#9aa0a6") + "22", color: d.status.color ?? "#6b7280" }}
            >
              {d.status.label}
            </span>
            <span className="text-label-sm text-on-surface-variant">matched on {d.matchedOn}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export function LeadDetail({
  lead,
  notes,
  timeline,
  tasks,
  duplicates,
  masters,
  canEdit,
  access,
}: {
  lead: LeadRow;
  notes: NoteRow[];
  timeline: ActivityRow[];
  tasks: TaskRow[];
  duplicates: DuplicateRow[];
  masters: DetailMasters;
  canEdit: boolean;
  access: DetailAccess;
}) {
  const [tab, setTab] = useState<"overview" | "tasks" | "history">("overview");
  const [comm, setComm] = useState<null | "email" | "whatsapp" | "call">(null);
  const openTaskCount = tasks.filter((t) => t.status === "open").length;
  const overdueCount = tasks.filter((t) => t.status === "open" && t.dueAt && new Date(t.dueAt).getTime() < Date.now()).length;

  return (
    <div className="space-y-lg">
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-base">
        <div className="inline-flex rounded-lg border border-outline-variant overflow-hidden">
          <button
            type="button"
            onClick={() => setTab("overview")}
            className={
              "px-md h-9 text-label-sm font-semibold transition " +
              (tab === "overview"
                ? "bg-primary text-on-primary"
                : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low")
            }
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setTab("tasks")}
            className={
              "px-md h-9 text-label-sm font-semibold transition inline-flex items-center gap-xs " +
              (tab === "tasks"
                ? "bg-primary text-on-primary"
                : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low")
            }
          >
            Tasks
            {openTaskCount > 0 && (
              <span
                className={
                  "inline-grid place-items-center min-w-[18px] h-[18px] px-[5px] rounded-full text-[10px] font-bold " +
                  (overdueCount > 0 ? "bg-error text-white" : "bg-accent text-on-primary")
                }
                title={overdueCount > 0 ? `${overdueCount} overdue` : `${openTaskCount} open`}
              >
                {openTaskCount}
              </span>
            )}
          </button>
          {access.canViewHistory && (
            <button
              type="button"
              onClick={() => setTab("history")}
              className={
                "px-md h-9 text-label-sm font-semibold transition " +
                (tab === "history"
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              History
            </button>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-base">
            <CommButton icon="mail" label="Email" onClick={() => setComm("email")} />
            <CommButton icon="chat" label="WhatsApp" onClick={() => setComm("whatsapp")} />
            <CommButton icon="call" label="Call" onClick={() => setComm("call")} />
          </div>
        )}
      </div>

      {duplicates.length > 0 && <DuplicatesBanner duplicates={duplicates} />}

      {tab === "overview" && (
        <>
          <StageBar lead={lead} statuses={masters.statuses} canEdit={canEdit} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-lg">
            <div className="lg:col-span-1">
              <SummaryCard lead={lead} masters={masters} canEdit={canEdit} />
            </div>
            <div className="lg:col-span-1">
              <Timeline lead={lead} notes={notes} timeline={timeline} canEdit={canEdit} access={access} />
            </div>
            <div className="lg:col-span-1 space-y-lg">
              <AssignmentCard lead={lead} masters={masters} canAssign={access.canAssign} />
              <LeadInfoCard lead={lead} masters={masters} isAdmin={access.isAdmin} />
            </div>
          </div>
        </>
      )}

      {tab === "tasks" && (
        <TasksPanel
          leadId={lead.id}
          tasks={tasks}
          canEdit={canEdit}
          bdes={masters.bdes}
          defaultAssigneeId={lead.assignedTo?.id ?? null}
        />
      )}

      {tab === "history" && <HistoryPanel leadId={lead.id} bdes={masters.bdes} />}

      {comm === "email" && <EmailModal lead={lead} onClose={() => setComm(null)} />}
      {comm === "whatsapp" && <WhatsAppModal lead={lead} onClose={() => setComm(null)} />}
      {comm === "call" && <CallModal lead={lead} onClose={() => setComm(null)} />}
    </div>
  );
}

function CommButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-xs h-9 px-md rounded-lg border border-outline-variant text-on-surface-variant text-label-sm font-semibold hover:bg-surface-container-low transition"
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
        {icon}
      </span>
      {label}
    </button>
  );
}

// ── Stage bar (Dynamics BPF style) ──────────────────────────────────────────
function StageBar({ lead, statuses, canEdit }: { lead: LeadRow; statuses: StatusOpt[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const active = statuses.filter((s) => s.kind === "active");
  const currentIdx = active.findIndex((s) => s.id === lead.status.id);
  const isEndState = lead.status.kind === "won" || lead.status.kind === "lost";

  async function setStatus(statusId: string) {
    if (!canEdit || busy || statusId === lead.status.id) return;
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statusId }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-md flex flex-wrap items-center gap-xs">
      {active.map((s, i) => {
        const reached = !isEndState && currentIdx >= 0 && i <= currentIdx;
        return (
          <button
            key={s.id}
            type="button"
            disabled={!canEdit || busy}
            onClick={() => setStatus(s.id)}
            className={
              "h-9 px-md text-label-sm font-semibold rounded-lg transition disabled:cursor-default " +
              (reached
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high") +
              (canEdit ? " cursor-pointer" : "")
            }
            title={canEdit ? `Set status: ${s.label}` : s.label}
          >
            {i + 1}. {s.label}
          </button>
        );
      })}
      {isEndState && (
        <span className="ml-auto">
          <StatusPill status={lead.status} />
        </span>
      )}
    </div>
  );
}

// ── Summary card (inline editable) ──────────────────────────────────────────
function SummaryCard({ lead, masters, canEdit }: { lead: LeadRow; masters: DetailMasters; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    candidateName: lead.candidateName,
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    sourceId: lead.source?.id ?? "",
    serviceId: lead.service?.id ?? "",
    qualificationId: lead.qualification?.id ?? "",
    statusId: lead.status.id,
  });

  async function save() {
    setError(null);
    if (!draft.candidateName.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        candidateName: draft.candidateName.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim(),
        sourceId: draft.sourceId,
        serviceId: draft.serviceId,
        qualificationId: draft.qualificationId,
        statusId: draft.statusId,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Failed to save changes.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between">
        <h3 className="text-h3 text-on-surface">Summary</h3>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex p-xs text-on-surface-variant hover:text-accent transition"
            title="Edit details"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              edit
            </span>
          </button>
        )}
      </div>
      {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">{error}</div>}

      {editing ? (
        <div className="space-y-md">
          <Field label="Candidate name">
            <input className={inputCls} value={draft.candidateName} onChange={(e) => setDraft({ ...draft, candidateName: e.target.value })} />
          </Field>
          <Field label="Email">
            <input className={inputCls} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          </Field>
          <Field label="Source">
            <select className={inputCls} value={draft.sourceId} onChange={(e) => setDraft({ ...draft, sourceId: e.target.value })}>
              <option value="">—</option>
              {masters.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Service">
            <select className={inputCls} value={draft.serviceId} onChange={(e) => setDraft({ ...draft, serviceId: e.target.value })}>
              <option value="">—</option>
              {masters.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Qualification">
            <select
              className={inputCls}
              value={draft.qualificationId}
              onChange={(e) => setDraft({ ...draft, qualificationId: e.target.value })}
            >
              <option value="">—</option>
              {masters.qualifications.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={draft.statusId} onChange={(e) => setDraft({ ...draft, statusId: e.target.value })}>
              {masters.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex justify-end gap-base">
            <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className={primaryBtn} disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <dl className="space-y-sm text-body-md">
          <Row label="Candidate" value={lead.candidateName} />
          <Row label="Email" value={lead.email ?? "—"} />
          <Row label="Phone" value={lead.phone ?? "—"} />
          <Row label="Source" value={lead.source?.label ?? "—"} />
          <Row label="Service" value={lead.service?.name ?? "—"} />
          <Row label="Qualification" value={lead.qualification?.label ?? "—"} />
          <Row label="Consultant" value={lead.assignedTo?.name ?? "Unassigned"} />
          <Row label="Created" value={fmtDateTime(lead.createdAt)} />
          {lead.extra &&
            Object.entries(lead.extra).map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}
        </dl>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-md">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="text-on-surface text-right font-medium break-words">{value}</dd>
    </div>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────────
type FeedItem =
  | { kind: "note"; at: string; note: NoteRow }
  | { kind: "activity"; at: string; activity: ActivityRow };

function Timeline({
  lead,
  notes,
  timeline,
  canEdit,
  access,
}: {
  lead: LeadRow;
  notes: NoteRow[];
  timeline: ActivityRow[];
  canEdit: boolean;
  access: DetailAccess;
}) {
  const items = useMemo<FeedItem[]>(() => {
    const merged: FeedItem[] = [
      ...notes.map((n) => ({ kind: "note" as const, at: n.createdAt, note: n })),
      ...timeline.map((a) => ({ kind: "activity" as const, at: a.occurredAt, activity: a })),
    ];
    merged.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return merged;
  }, [notes, timeline]);

  return (
    <div className={cardCls}>
      <h3 className="text-h3 text-on-surface">Timeline</h3>
      {canEdit && <NoteComposer leadId={lead.id} />}
      {items.length === 0 ? (
        <p className="text-on-surface-variant text-body-md">No activity yet.</p>
      ) : (
        <ul className="space-y-md">
          {items.map((it) =>
            it.kind === "note" ? (
              <NoteCard key={`note-${it.note.id}`} leadId={lead.id} note={it.note} canEdit={canEdit} access={access} />
            ) : (
              <ActivityCard key={`act-${it.activity.id}`} activity={it.activity} />
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function NoteComposer({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!body.trim() || busy) return;
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${leadId}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: body.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      setBody("");
      router.refresh();
    }
  }

  return (
    <div className="space-y-xs">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Enter a note…"
        rows={2}
        className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md resize-y"
      />
      <div className="flex justify-end">
        <button type="button" disabled={!body.trim() || busy} onClick={add} className={primaryBtn + " h-9"}>
          {busy ? "Adding…" : "Add note"}
        </button>
      </div>
    </div>
  );
}

function NoteCard({
  leadId,
  note,
  canEdit,
  access,
}: {
  leadId: string;
  note: NoteRow;
  canEdit: boolean;
  access: DetailAccess;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const canDelete = access.isAdmin || note.authorId === access.userId;

  async function save() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${leadId}/notes/${note.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: draft.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    }
  }
  async function remove() {
    if (!confirm("Delete this note?") || busy) return;
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${leadId}/notes/${note.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <li className="rounded-lg border border-outline-variant bg-surface-container-low p-md space-y-xs">
      <div className="flex items-center gap-xs">
        <Avatar name={note.authorName} />
        <span className="text-label-sm font-semibold text-on-surface">{note.authorName}</span>
        <span className="text-label-sm text-on-surface-variant">· {fmtRelative(note.createdAt)}</span>
        {note.editedAt && <span className="text-label-sm text-on-surface-variant italic">(edited)</span>}
        {canEdit && !editing && (
          <span className="ml-auto flex items-center gap-xs">
            <button type="button" onClick={() => setEditing(true)} className="text-on-surface-variant hover:text-accent" title="Edit">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                edit
              </span>
            </button>
            {canDelete && (
              <button type="button" onClick={remove} disabled={busy} className="text-on-surface-variant hover:text-error" title="Delete">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                  delete
                </span>
              </button>
            )}
          </span>
        )}
      </div>
      {editing ? (
        <div className="space-y-xs">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest outline-none focus:border-primary text-body-md resize-y"
          />
          <div className="flex justify-end gap-base">
            <button type="button" className={secondaryBtn + " h-9"} disabled={busy} onClick={() => { setEditing(false); setDraft(note.body); }}>
              Cancel
            </button>
            <button type="button" className={primaryBtn + " h-9"} disabled={busy} onClick={save}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <p className="text-body-md text-on-surface whitespace-pre-wrap">{note.body}</p>
      )}
    </li>
  );
}

function ActivityCard({ activity }: { activity: ActivityRow }) {
  return (
    <li className="flex items-start gap-sm">
      <span className="inline-grid place-items-center h-7 w-7 rounded-full bg-surface-container-high text-on-surface-variant flex-shrink-0">
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          {ACTIVITY_ICON[activity.type] ?? "bolt"}
        </span>
      </span>
      <div className="min-w-0">
        <p className="text-body-md text-on-surface">{activity.summary ?? activity.type}</p>
        <p className="text-label-sm text-on-surface-variant">
          {activity.actorName ? `${activity.actorName} · ` : ""}
          {fmtRelative(activity.occurredAt)}
        </p>
      </div>
    </li>
  );
}

// ── Assignment ────────────────────────────────────────────────────────────────
function AssignmentCard({ lead, masters, canAssign }: { lead: LeadRow; masters: DetailMasters; canAssign: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function assign(value: string) {
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${lead.id}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignedToId: value || null }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className={cardCls}>
      <h3 className="text-h3 text-on-surface">Consultant</h3>
      <div className="flex items-center gap-sm">
        <Avatar name={lead.assignedTo?.name ?? null} />
        <span className="text-body-md text-on-surface font-medium">{lead.assignedTo?.name ?? "Unassigned"}</span>
      </div>
      {canAssign && (
        <Field label="Assign / reassign">
          <select className={inputCls} disabled={busy} value={lead.assignedTo?.id ?? ""} onChange={(e) => assign(e.target.value)}>
            <option value="">Unassigned</option>
            {masters.bdes.map((b) => (
              <option key={b.userId} value={b.userId}>
                {b.displayName}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  );
}

// ── Lead info (right rail) ──────────────────────────────────────────────────
function LeadInfoCard({ lead, masters, isAdmin }: { lead: LeadRow; masters: DetailMasters; isAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function linkParty(value: string) {
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partyId: value || null }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className={cardCls}>
      <h3 className="text-h3 text-on-surface">Lead detail</h3>
      <dl className="space-y-sm text-body-md">
        <div className="flex justify-between gap-md">
          <dt className="text-on-surface-variant">Status</dt>
          <dd>
            <StatusPill status={lead.status} />
          </dd>
        </div>
        <Row label="Source" value={lead.source?.label ?? "—"} />
        <Row label="Service" value={lead.service?.name ?? "—"} />
        <Row label="Qualification" value={lead.qualification?.label ?? "—"} />
        {lead.status.code === "duplicate" && (
          <div className="rounded-lg bg-amber-50 text-amber-800 border border-amber-200 px-md py-sm text-label-sm">
            Flagged as a possible duplicate.
          </div>
        )}
      </dl>
      <div className="pt-xs border-t border-outline-variant">
        <div className="flex justify-between gap-md text-body-md">
          <span className="text-on-surface-variant">Linked candidate</span>
          <span className="text-on-surface font-medium">{lead.party?.name ?? "Not linked"}</span>
        </div>
        {isAdmin && (
          <div className="mt-sm">
            <select className={inputCls} disabled={busy} value={lead.party?.id ?? ""} onChange={(e) => linkParty(e.target.value)}>
              <option value="">Not linked</option>
              {masters.parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Comms modals ──────────────────────────────────────────────────────────────
const EMAIL_TEMPLATES: { id: string; label: string; subject: string; body: string }[] = [
  { id: "blank", label: "Blank", subject: "", body: "" },
  {
    id: "intro",
    label: "Introduction",
    subject: "DESMA — {service}",
    body: "Hi {name},\n\nThank you for your interest in {service}. I'm {consultant} from DESMA and I'll be assisting you.\n\nBest regards,\n{consultant}",
  },
  {
    id: "followup",
    label: "Follow up",
    subject: "Following up — {service}",
    body: "Hi {name},\n\nJust following up on our earlier conversation regarding {service}. Do let me know a good time to connect.\n\n{consultant}",
  },
];

function EmailModal({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const router = useRouter();
  const vars = { name: lead.candidateName, service: lead.service?.name ?? "", consultant: lead.assignedTo?.name ?? "" };
  const [tpl, setTpl] = useState("blank");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyTemplate(id: string) {
    setTpl(id);
    const t = EMAIL_TEMPLATES.find((x) => x.id === id);
    if (t) {
      setSubject(renderTemplate(t.subject, vars));
      setBody(renderTemplate(t.body, vars));
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/leads/${lead.id}/comms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: "email", subject, body }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setError(d.message || (d.error === "no_email" ? "This lead has no email address." : "Failed."));
      return;
    }
    const d = (await res.json()) as { mailtoUrl?: string };
    if (d.mailtoUrl) window.location.href = d.mailtoUrl;
    onClose();
    router.refresh();
  }

  return (
    <Modal title="Email lead" onClose={onClose} busy={busy}>
      {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">{error}</div>}
      <Field label="To">
        <input className={inputCls} value={lead.email ?? ""} disabled />
      </Field>
      <Field label="Template">
        <select className={inputCls} value={tpl} onChange={(e) => applyTemplate(e.target.value)}>
          {EMAIL_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Subject">
        <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label="Body">
        <textarea
          className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest outline-none focus:border-primary text-body-md resize-y"
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-base">
        <button type="button" className={secondaryBtn} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={primaryBtn} disabled={busy} onClick={send}>
          {busy ? "Sending…" : "Open email"}
        </button>
      </div>
    </Modal>
  );
}

function WhatsAppModal({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const router = useRouter();
  const vars = { name: lead.candidateName, service: lead.service?.name ?? "", consultant: lead.assignedTo?.name ?? "" };
  const [message, setMessage] = useState(
    renderTemplate("Hi {name}, this is {consultant} from DESMA regarding {service}.", vars),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/leads/${lead.id}/comms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: "whatsapp", body: message }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setError(d.message || (d.error === "no_phone" ? "This lead has no usable phone number." : "Failed."));
      return;
    }
    const d = (await res.json()) as { url?: string };
    if (d.url) window.open(d.url, "_blank", "noopener,noreferrer");
    onClose();
    router.refresh();
  }

  return (
    <Modal title="WhatsApp lead" onClose={onClose} busy={busy}>
      {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">{error}</div>}
      <Field label="To">
        <input className={inputCls} value={lead.phoneE164 ?? ""} disabled placeholder="No WhatsApp-capable number" />
      </Field>
      {!lead.phoneE164 && (
        <p className="text-label-sm text-on-surface-variant">
          This lead has no normalised phone number, so WhatsApp can&apos;t be opened. Add a valid phone first.
        </p>
      )}
      <Field label="Message">
        <textarea
          className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest outline-none focus:border-primary text-body-md resize-y"
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-base">
        <button type="button" className={secondaryBtn} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={primaryBtn} disabled={busy || !lead.phoneE164} onClick={send}>
          {busy ? "Opening…" : "Open WhatsApp"}
        </button>
      </div>
    </Modal>
  );
}

const CALL_OUTCOMES = [
  { value: "connected", label: "Connected" },
  { value: "no_answer", label: "No answer" },
  { value: "busy", label: "Busy" },
  { value: "wrong_number", label: "Wrong number" },
];

function CallModal({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState("connected");
  const [duration, setDuration] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const durationSec = duration.trim() ? Math.max(0, parseInt(duration, 10) || 0) : undefined;
    const res = await fetch(`/api/crm/leads/${lead.id}/comms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: "call", outcome, durationSec, note: note.trim() || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      onClose();
      router.refresh();
    }
  }

  return (
    <Modal title="Log call" onClose={onClose} busy={busy}>
      {lead.phone ? (
        <a href={`tel:${lead.phone}`} className={primaryBtn + " inline-flex items-center gap-xs w-full justify-center"}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            call
          </span>
          Call {lead.phone}
        </a>
      ) : (
        <p className="text-on-surface-variant text-body-md">No phone number on file.</p>
      )}
      <Field label="Outcome">
        <select className={inputCls} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          {CALL_OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Duration (seconds)">
        <input className={inputCls} type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
      </Field>
      <Field label="Note">
        <textarea
          className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest outline-none focus:border-primary text-body-md resize-y"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-base">
        <button type="button" className={secondaryBtn} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={primaryBtn} disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Log call"}
        </button>
      </div>
    </Modal>
  );
}

// ── Admin History tab ──────────────────────────────────────────────────────
const HISTORY_TYPES = [
  "LEAD_CREATED",
  "LEAD_IMPORTED",
  "LEAD_OPENED",
  "STATUS_CHANGED",
  "FIELD_UPDATED",
  "ASSIGNED",
  "REASSIGNED",
  "UNASSIGNED",
  "NOTE_ADDED",
  "NOTE_EDITED",
  "NOTE_DELETED",
  "EMAIL_SENT",
  "WHATSAPP_SENT",
  "CALL_LOGGED",
  "PARTY_LINKED",
  "TASK_CREATED",
  "TASK_COMPLETED",
  "TASK_REOPENED",
  "TASK_UPDATED",
  "TASK_DELETED",
];

function HistoryPanel({ leadId, bdes }: { leadId: string; bdes: BdeOpt[] }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [actor, setActor] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const inputSm =
    "h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm focus:border-primary outline-none";

  async function load() {
    setLoading(true);
    const qs = new URLSearchParams({ scope: "history" });
    if (actor) qs.set("actor", actor);
    if (type) qs.set("type", type);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const res = await fetch(`/api/crm/leads/${leadId}/activities?${qs.toString()}`);
    setLoading(false);
    if (res.ok) {
      const d = (await res.json()) as { activities: ActivityRow[] };
      setRows(d.activities);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, type, from, to]);

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between">
        <h3 className="text-h3 text-on-surface">History</h3>
        <span className="text-label-sm text-on-surface-variant">Full audit log (admin only)</span>
      </div>
      <div className="flex flex-wrap items-center gap-base">
        <select className={inputSm} value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">All actors</option>
          {bdes.map((b) => (
            <option key={b.userId} value={b.userId}>
              {b.displayName}
            </option>
          ))}
        </select>
        <select className={inputSm} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All event types</option>
          {HISTORY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input type="date" className={inputSm} value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className={inputSm} value={to} onChange={(e) => setTo(e.target.value)} />
        {(actor || type || from || to) && (
          <button
            type="button"
            onClick={() => {
              setActor("");
              setType("");
              setFrom("");
              setTo("");
            }}
            className="h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low"
          >
            Clear
          </button>
        )}
      </div>

      <div className="overflow-auto scrollbar-thin max-h-[calc(100vh-320px)] rounded-lg border border-outline-variant">
        <table className="w-full text-body-md">
          <thead className="bg-surface-container-low text-on-surface-variant sticky top-0 z-10">
            <tr>
              <th className="px-md py-sm text-label-sm uppercase tracking-wider text-left">When</th>
              <th className="px-md py-sm text-label-sm uppercase tracking-wider text-left">Actor</th>
              <th className="px-md py-sm text-label-sm uppercase tracking-wider text-left">Event</th>
              <th className="px-md py-sm text-label-sm uppercase tracking-wider text-left">Summary</th>
              <th className="px-md py-sm text-label-sm uppercase tracking-wider"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-md py-lg text-center text-on-surface-variant">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-md py-lg text-center text-on-surface-variant">
                  No history matches these filters.
                </td>
              </tr>
            )}
            {!loading &&
              rows?.map((a) => {
                const hasMeta = a.metadata != null && Object.keys(a.metadata as object).length > 0;
                return (
                  <Fragment key={a.id}>
                    <tr className="border-t border-outline-variant/60 hover:bg-surface-container-low">
                      <td className="px-md py-sm whitespace-nowrap font-mono tabular-nums text-on-surface-variant">
                        {fmtDateTime(a.occurredAt)}
                      </td>
                      <td className="px-md py-sm whitespace-nowrap">{a.actorName ?? "System"}</td>
                      <td className="px-md py-sm whitespace-nowrap">
                        <span className="inline-flex items-center gap-xs">
                          <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 16 }}>
                            {ACTIVITY_ICON[a.type] ?? "bolt"}
                          </span>
                          {a.type}
                        </span>
                      </td>
                      <td className="px-md py-sm">{a.summary ?? "—"}</td>
                      <td className="px-md py-sm text-right">
                        {hasMeta && (
                          <button
                            type="button"
                            onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                            className="text-on-surface-variant hover:text-accent"
                            title="Details"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                              {expanded === a.id ? "expand_less" : "expand_more"}
                            </span>
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === a.id && hasMeta && (
                      <tr className="bg-surface-container-low">
                        <td colSpan={5} className="px-md py-sm">
                          <pre className="text-label-sm text-on-surface-variant whitespace-pre-wrap break-words">
                            {JSON.stringify(a.metadata, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
const PRIORITY_META: Record<string, { label: string; color: string }> = {
  high: { label: "High", color: "#dc2626" },
  normal: { label: "Normal", color: "#3b82f6" },
  low: { label: "Low", color: "#6b7280" },
};

function taskDueLabel(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (diff < 0) return { text: `Overdue · ${base}`, overdue: true };
  if (diff === 0) return { text: "Due today", overdue: false };
  if (diff === 1) return { text: "Due tomorrow", overdue: false };
  return { text: `Due ${base}`, overdue: false };
}

function PriorityPill({ priority }: { priority: string }) {
  const meta = PRIORITY_META[priority] ?? PRIORITY_META.normal;
  return (
    <span
      className="px-xs py-[1px] rounded-full text-[10px] font-bold"
      style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}
    >
      {meta.label}
    </span>
  );
}

function TasksPanel({
  leadId,
  tasks,
  canEdit,
  bdes,
  defaultAssigneeId,
}: {
  leadId: string;
  tasks: TaskRow[];
  canEdit: boolean;
  bdes: BdeOpt[];
  defaultAssigneeId: string | null;
}) {
  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between">
        <h3 className="text-h3 text-on-surface">Tasks</h3>
        <span className="text-label-sm text-on-surface-variant">
          {open.length} open · {done.length} completed
        </span>
      </div>

      {canEdit ? (
        <TaskComposer leadId={leadId} bdes={bdes} defaultAssigneeId={defaultAssigneeId} />
      ) : (
        <p className="text-label-sm text-on-surface-variant inline-flex items-center gap-xs">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            lock
          </span>
          Read-only — this lead isn&apos;t assigned to you.
        </p>
      )}

      <div className="space-y-xs">
        <div className="text-label-sm uppercase tracking-wider text-on-surface-variant">Open</div>
        {open.length === 0 ? (
          <p className="text-body-md text-on-surface-variant">No open tasks.</p>
        ) : (
          <ul className="space-y-base">
            {open.map((t) => (
              <TaskItem key={t.id} leadId={leadId} task={t} canEdit={canEdit} />
            ))}
          </ul>
        )}
      </div>

      {done.length > 0 && (
        <div className="space-y-xs">
          <div className="text-label-sm uppercase tracking-wider text-on-surface-variant">Completed</div>
          <ul className="space-y-base">
            {done.map((t) => (
              <TaskItem key={t.id} leadId={leadId} task={t} canEdit={canEdit} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TaskComposer({
  leadId,
  bdes,
  defaultAssigneeId,
}: {
  leadId: string;
  bdes: BdeOpt[];
  defaultAssigneeId: string | null;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("normal");
  const [assignee, setAssignee] = useState(defaultAssigneeId ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!subject.trim() || busy) return;
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${leadId}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: subject.trim(),
        dueAt: due || null,
        priority,
        assignedToId: assignee || null,
        note: note.trim() || null,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setSubject("");
      setDue("");
      setPriority("normal");
      setNote("");
      router.refresh();
    }
  }

  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md space-y-sm">
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Add a task (e.g. Follow-up call about documents)…"
        className={inputCls}
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-base">
        <Field label="Due date">
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </Field>
        <Field label="Assign to">
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inputCls}>
            <option value="">Lead owner</option>
            {bdes.map((b) => (
              <option key={b.userId} value={b.userId}>
                {b.displayName}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)…"
        rows={2}
        className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md resize-y"
      />
      <div className="flex justify-end">
        <button type="button" disabled={!subject.trim() || busy} onClick={add} className={primaryBtn + " h-9"}>
          {busy ? "Adding…" : "Add task"}
        </button>
      </div>
    </div>
  );
}

function TaskItem({ leadId, task, canEdit }: { leadId: string; task: TaskRow; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const done = task.status === "done";
  const due = taskDueLabel(task.dueAt);

  async function toggle() {
    if (!canEdit || busy) return;
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${leadId}/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: done ? "open" : "done" }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }
  async function remove() {
    if (!canEdit || busy) return;
    if (!confirm("Delete this task?")) return;
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${leadId}/tasks/${task.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <li className="flex items-start gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-md">
      <button
        type="button"
        onClick={toggle}
        disabled={!canEdit || busy}
        title={canEdit ? (done ? "Reopen" : "Mark complete") : "Read-only"}
        className="mt-[2px] flex-shrink-0 disabled:cursor-default"
      >
        <span
          className={"material-symbols-outlined " + (done ? "text-primary-container" : "text-on-surface-variant hover:text-accent")}
          style={{ fontSize: 22 }}
        >
          {done ? "check_box" : "check_box_outline_blank"}
        </span>
      </button>
      <div className="flex-1 min-w-0">
        <p className={"text-body-md " + (done ? "line-through text-on-surface-variant" : "text-on-surface")}>{task.subject}</p>
        <div className="flex items-center flex-wrap gap-sm mt-[3px] text-label-sm">
          {done ? (
            <span className="text-on-surface-variant">
              Completed{task.completedAt ? ` ${fmtRelative(task.completedAt)}` : ""}
            </span>
          ) : (
            due && (
              <span className={due.overdue ? "text-error font-semibold" : "text-on-surface-variant"}>{due.text}</span>
            )
          )}
          <PriorityPill priority={task.priority} />
          {task.assignedToName && (
            <span className="inline-flex items-center gap-xs text-on-surface-variant">
              <Avatar name={task.assignedToName} />
              {task.assignedToName}
            </span>
          )}
        </div>
        {task.note && <p className="mt-xs text-label-sm text-on-surface-variant whitespace-pre-wrap">{task.note}</p>}
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="text-on-surface-variant hover:text-error flex-shrink-0"
          title="Delete task"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            delete
          </span>
        </button>
      )}
    </li>
  );
}
