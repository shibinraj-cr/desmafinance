"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { LeadRow, NoteRow, ActivityRow, TaskRow } from "@/lib/crm-leads";
import { isActionOnlyStatus } from "@/lib/crm-leads";
import { buildLeadMergeVars, fillTemplate, LEAD_TEMPERATURES, type MessageTemplateDTO } from "@/lib/crm";
import { ageFromDob } from "@/lib/age";
import { COUNTRIES, countryCodeFor } from "@/lib/countries";
import { StatusPill, TemperaturePill, type StatusOpt, type Opt, type BdeOpt } from "../client";
import { EnrollCelebration } from "@/components/EnrollCelebration";
import { NextStepDialog, type NextStepPayload } from "@/components/crm/NextStepDialog";

export type PartyOpt = { id: string; label: string; phone: string | null };
export type DetailMasters = {
  statuses: StatusOpt[];
  sources: Opt[];
  services: Opt[];
  qualifications: Opt[];
  bdes: BdeOpt[];
  parties: PartyOpt[];
};
export type DetailAccess = {
  isAdmin: boolean;
  canAssign: boolean;
  canViewHistory: boolean;
  /** BDE or CRM admin — may create leads, so may re-enroll an existing candidate. */
  canCreateLeads: boolean;
  userId: string;
};

// ── class strings ───────────────────────────────────────────────────────────
const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";
const primaryBtn =
  "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
const secondaryBtn =
  "h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition";
const cardCls =
  "relative bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg space-y-md " +
  "before:content-[''] before:absolute before:left-5 before:right-5 before:top-0 before:h-[3px] before:rounded-full " +
  "before:bg-gradient-to-r before:from-indigo-400 before:via-primary before:to-emerald-400";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
    </label>
  );
}

// Card heading with a colour-coded leading icon — gives each panel its own hue.
function CardHeading({ icon, color, children }: { icon: string; color: string; children: React.ReactNode }) {
  return (
    <h3 className="text-h3 text-on-surface inline-flex items-center gap-xs">
      <span
        className="material-symbols-outlined grid place-items-center h-7 w-7 rounded-lg"
        style={{ fontSize: 18, color, backgroundColor: `${color}1a` }}
      >
        {icon}
      </span>
      {children}
    </h3>
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
  RE_INQUIRY: "replay",
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
  DEAL_UPDATED: "handshake",
  ENROLLED: "verified",
  REVENUE_DRAFTED: "request_quote",
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
  emailConfigured,
  templates,
  access,
  studyAbroad,
}: {
  lead: LeadRow;
  notes: NoteRow[];
  timeline: ActivityRow[];
  tasks: TaskRow[];
  duplicates: DuplicateRow[];
  masters: DetailMasters;
  canEdit: boolean;
  emailConfigured: boolean;
  templates: MessageTemplateDTO[];
  access: DetailAccess;
  studyAbroad: { eligible: boolean; alreadySent: boolean };
}) {
  const [tab, setTab] = useState<"overview" | "tasks" | "whatsapp" | "history">("overview");
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
          <button
            type="button"
            onClick={() => setTab("whatsapp")}
            className={
              "px-md h-9 text-label-sm font-semibold transition " +
              (tab === "whatsapp"
                ? "bg-primary text-on-primary"
                : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low")
            }
          >
            WhatsApp
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
            {studyAbroad.eligible && <StudyAbroadButton leadId={lead.id} alreadySent={studyAbroad.alreadySent} />}
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
              <DealCard lead={lead} masters={masters} canEdit={canEdit} canReEnroll={access.canCreateLeads} />
              <AssignmentCard lead={lead} masters={masters} canAssign={access.canAssign} />
              <LeadInfoCard lead={lead} masters={masters} canEdit={canEdit} />
            </div>
          </div>
        </>
      )}

      {tab === "tasks" && (
        <TasksPanel
          leadId={lead.id}
          leadName={lead.candidateName}
          tasks={tasks}
          canEdit={canEdit}
          bdes={masters.bdes}
          defaultAssigneeId={lead.assignedTo?.id ?? null}
        />
      )}

      {tab === "whatsapp" && <WhatsAppThreadPanel leadId={lead.id} leadName={lead.candidateName} />}

      {tab === "history" && <HistoryPanel leadId={lead.id} bdes={masters.bdes} />}

      {comm === "email" && (
        <EmailModal lead={lead} emailConfigured={emailConfigured} templates={templates} onClose={() => setComm(null)} />
      )}
      {comm === "whatsapp" && <WhatsAppModal lead={lead} templates={templates} onClose={() => setComm(null)} />}
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

/**
 * Fires the study-abroad counsellor intro over WhatsApp, through the assigned
 * consultant's Wabis study-abroad workflow. Shown only for study-abroad services
 * on an assigned lead. One send per lead+consultant: once sent it settles into a
 * "Sent" state, and a second click reports it was already sent rather than
 * re-messaging the candidate.
 */
function StudyAbroadButton({ leadId, alreadySent }: { leadId: string; alreadySent: boolean }) {
  const [sent, setSent] = useState(alreadySent);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function send() {
    if (busy) return;
    if (sent && !confirm("The study-abroad intro was already sent to this lead. Send it again anyway?")) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/crm/leads/${leadId}/wabis/study-abroad`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        state?: string;
        message?: string;
      };
      // Any outcome that means "Wabis has it" flips the button to Sent.
      if (data.ok && (data.state === "sent" || data.state === "queued" || data.state === "already_sent")) setSent(true);
      setNote(data.message ?? (res.ok ? "Done." : "Couldn't send."));
    } catch {
      setNote("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="relative inline-flex flex-col items-start">
      <button
        type="button"
        onClick={send}
        disabled={busy}
        title="Send the study-abroad counsellor intro over WhatsApp"
        className={
          "inline-flex items-center gap-xs h-9 px-md rounded-lg text-label-sm font-semibold transition disabled:opacity-60 " +
          (sent
            ? "border border-green-300 bg-green-50 text-green-800 hover:bg-green-100"
            : "border border-primary bg-primary text-on-primary hover:bg-primary-container")
        }
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          {sent ? "check_circle" : "travel_explore"}
        </span>
        {busy ? "Sending…" : sent ? "Study-abroad sent" : "Study-abroad WhatsApp"}
      </button>
      {note && (
        <span className="absolute top-full mt-xs right-0 z-10 whitespace-nowrap rounded-md bg-surface-container-highest px-sm py-[2px] text-label-sm text-on-surface shadow">
          {note}
        </span>
      )}
    </span>
  );
}

// ── Stage bar (Dynamics BPF style) ──────────────────────────────────────────
// Vivid fallback palette so stages without an explicit colour still read in
// colour — cycles by position across the pipeline.
const STAGE_PALETTE = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#ef4444", "#14b8a6"];
function stageColor(s: StatusOpt, idx: number): string {
  return s.color || STAGE_PALETTE[idx % STAGE_PALETTE.length];
}

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
        const isCurrent = !isEndState && i === currentIdx;
        const color = stageColor(s, i);
        // "Pipeline" shows on the bar as a milestone but is set only by the
        // Set-deal action — never clickable.
        const locked = isActionOnlyStatus(s.code);
        // Reached stages wear their stage colour; the current stage gets a
        // brighter fill + glow ring; upcoming stages stay tinted-but-muted.
        const style: React.CSSProperties = reached
          ? {
              backgroundColor: color,
              color: "#fff",
              boxShadow: isCurrent ? `0 0 0 3px ${color}40, 0 4px 12px ${color}55` : `0 2px 6px ${color}33`,
            }
          : { backgroundColor: `${color}14`, color, border: `1px solid ${color}40` };
        return (
          <button
            key={s.id}
            type="button"
            disabled={!canEdit || busy || locked}
            onClick={() => {
              if (!locked) setStatus(s.id);
            }}
            style={style}
            className={
              "inline-flex items-center gap-xs h-9 px-md text-label-sm font-semibold rounded-lg transition disabled:cursor-default " +
              (canEdit && !locked ? " cursor-pointer hover:brightness-105" : "")
            }
            title={
              locked
                ? `${s.label} is set by an action (Set deal), not the status picker`
                : canEdit
                  ? `Set status: ${s.label}`
                  : s.label
            }
          >
            {reached && (
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                {isCurrent ? "radio_button_checked" : "check_circle"}
              </span>
            )}
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
    altPhone: lead.altPhone ?? "",
    sourceId: lead.source?.id ?? "",
    serviceId: lead.service?.id ?? "",
    qualificationId: lead.qualification?.id ?? "",
    dob: lead.dob ?? "",
    country: lead.country ?? "",
    studyDestination: lead.studyDestination ?? "",
    temperature: lead.temperature ?? "",
    statusId: lead.status.id,
  });

  // Live age preview from the entered DOB (auto-derived; never sent to the server).
  const draftAge = ageFromDob(draft.dob || null, new Date());

  // Study destination only applies to the Study Abroad service.
  const selectedServiceLabel = masters.services.find((s) => s.id === draft.serviceId)?.label ?? "";
  const isStudyAbroad = /study abroad/i.test(selectedServiceLabel);

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
        altPhone: draft.altPhone.trim(),
        sourceId: draft.sourceId,
        serviceId: draft.serviceId,
        qualificationId: draft.qualificationId,
        dob: draft.dob,
        country: draft.country,
        studyDestination: isStudyAbroad ? draft.studyDestination : undefined,
        temperature: draft.temperature,
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
        <CardHeading icon="person" color="#6366f1">Summary</CardHeading>
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
          <Field label="Alternative phone">
            <input className={inputCls} value={draft.altPhone} onChange={(e) => setDraft({ ...draft, altPhone: e.target.value })} />
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
          <Field label={`Date of birth${draftAge !== null ? ` — age ${draftAge}` : ""}`}>
            <input
              className={inputCls}
              type="date"
              value={draft.dob}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDraft({ ...draft, dob: e.target.value })}
            />
          </Field>
          <Field label="Country">
            <select className={inputCls} value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })}>
              <option value="">—</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          {/* Auto-derived ISO alpha-2 code for the selected country (AU, IN, …).
              Display-only: disabled, not held in draft state, never saved. */}
          <Field label="Country Code">
            <input
              className={inputCls}
              value={countryCodeFor(draft.country)}
              readOnly
              disabled
              placeholder="—"
              aria-label="Country code (auto-filled from the selected country)"
            />
          </Field>
          {isStudyAbroad && (
            <Field label="Study Destination">
              <select className={inputCls} value={draft.studyDestination} onChange={(e) => setDraft({ ...draft, studyDestination: e.target.value })}>
                <option value="">—</option>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Status">
            <select className={inputCls} value={draft.statusId} onChange={(e) => setDraft({ ...draft, statusId: e.target.value })}>
              {/* Pipeline & Enrolled are set by actions (Set deal / Enroll), not here.
                  If the lead is already in one, show it as a disabled current value. */}
              {isActionOnlyStatus(lead.status.code) && (
                <option value={lead.status.id} disabled>
                  {lead.status.label} (set by action)
                </option>
              )}
              {masters.statuses
                .filter((s) => !isActionOnlyStatus(s.code))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Temperature">
            <select className={inputCls} value={draft.temperature} onChange={(e) => setDraft({ ...draft, temperature: e.target.value })}>
              <option value="">— Unrated</option>
              {LEAD_TEMPERATURES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
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
          <Row label="Alt. phone" value={lead.altPhone ?? "—"} />
          <Row label="Source" value={lead.source?.label ?? "—"} />
          <Row label="Service" value={lead.service?.name ?? "—"} />
          <Row label="Qualification" value={lead.qualification?.label ?? "—"} />
          <Row label="Temperature" value={<TemperaturePill temperature={lead.temperature} />} />
          {lead.dob && <Row label="Date of birth" value={lead.dob} />}
          {lead.age !== null && <Row label="Age" value={`${lead.age} yrs`} />}
          <Row label="Country" value={lead.country ?? "—"} />
          <Row label="Country Code" value={countryCodeFor(lead.country ?? "") || "—"} />
          {(/study abroad/i.test(lead.service?.name ?? "") || lead.studyDestination) && (
            <Row label="Study Destination" value={lead.studyDestination ?? "—"} />
          )}
          <Row label="Consultant" value={lead.assignedTo?.name ?? "Unassigned"} />
          {lead.assignedTo && lead.assignedAt && (
            <Row label="Assigned on" value={fmtDateTime(lead.assignedAt)} />
          )}
          <Row label="Created" value={fmtDateTime(lead.createdAt)} />
          {lead.extra &&
            Object.entries(lead.extra).map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}
        </dl>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
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
      <CardHeading icon="timeline" color="#06b6d4">Timeline</CardHeading>
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
        {activity.note && (
          <p className="mt-xs border-l-2 border-outline-variant pl-sm text-body-md text-on-surface-variant whitespace-pre-wrap">
            {activity.note}
          </p>
        )}
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
      <CardHeading icon="badge" color="#8b5cf6">Consultant</CardHeading>
      <div className="flex items-center gap-sm">
        <Avatar name={lead.assignedTo?.name ?? null} />
        <div className="flex flex-col">
          <span className="text-body-md text-on-surface font-medium">{lead.assignedTo?.name ?? "Unassigned"}</span>
          {lead.assignedTo && lead.assignedAt && (
            <span className="text-label-sm text-on-surface-variant">Assigned {fmtDateTime(lead.assignedAt)}</span>
          )}
        </div>
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

// ── Deal & enrollment ───────────────────────────────────────────────────────
function pipelineBadgeStyle(status: string): React.CSSProperties {
  const c = status === "closed_won" ? "#16a34a" : status === "lost" ? "#dc2626" : "#3b82f6";
  return { backgroundColor: `${c}22`, color: c, border: `1px solid ${c}66` };
}
function DealRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-base">
      <dt className="text-label-sm text-on-surface-variant">{label}</dt>
      <dd className="text-on-surface text-right">{value}</dd>
    </div>
  );
}

function DealCard({
  lead,
  masters,
  canEdit,
  canReEnroll,
}: {
  lead: LeadRow;
  masters: DetailMasters;
  canEdit: boolean;
  /** Any consultant (BDE/CRM admin) — may enroll this candidate in a further service. */
  canReEnroll: boolean;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<null | "deal" | "enroll">(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [celebrateName, setCelebrateName] = useState<string | null>(null);
  const isEnrolled = lead.status.code === "enrolled";
  const hasDeal = lead.expectedValue != null || lead.expectedCloseDate != null;

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between">
        <CardHeading icon="handshake" color="#10b981">Deal</CardHeading>
        {lead.pipelineStatus && (
          <span
            className="px-xs py-[2px] rounded-full text-[10px] font-bold uppercase tracking-wider"
            style={pipelineBadgeStyle(lead.pipelineStatus)}
          >
            {lead.pipelineStatus === "closed_won" ? "Won" : lead.pipelineStatus === "lost" ? "Lost" : "In forecast"}
          </span>
        )}
      </div>

      <dl className="space-y-xs">
        <DealRow label="Service" value={lead.service?.name ?? "—"} />
        <DealRow
          label="Expected value"
          value={lead.expectedValue != null ? `₹${lead.expectedValue.toLocaleString("en-IN")}` : "—"}
        />
        <DealRow
          label="Expected close"
          value={lead.expectedCloseDate ? new Date(lead.expectedCloseDate).toLocaleDateString("en-IN") : "—"}
        />
        <DealRow
          label="Candidate"
          value={
            lead.party ? (
              <span className="inline-flex items-center gap-xs text-green-700">
                {lead.party.name}
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                  verified
                </span>
              </span>
            ) : (
              "Not enrolled"
            )
          }
        />
      </dl>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-base pt-xs">
          <button type="button" className={secondaryBtn + " h-9"} onClick={() => setModal("deal")}>
            {hasDeal ? "Edit deal" : "Set deal"}
          </button>
          {isEnrolled ? (
            <span className="inline-flex items-center gap-xs text-green-700 font-semibold text-label-sm">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                verified
              </span>
              Enrolled
            </span>
          ) : (
            <button type="button" className={primaryBtn + " h-9"} onClick={() => setModal("enroll")}>
              Enroll
            </button>
          )}
        </div>
      )}

      {/* Re-enrollment: a candidate whose service is done comes back for another.
          Opens a follow-up lead for the second service (worked + enrolled via the
          normal flow). Available to any consultant, not just this lead's owner. */}
      {isEnrolled && canReEnroll && (
        <div className="pt-xs">
          <button
            type="button"
            className={secondaryBtn + " h-9 inline-flex items-center gap-xs"}
            onClick={() => setReopenOpen(true)}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              replay
            </span>
            Reopen for another service
          </button>
        </div>
      )}

      {modal && (
        <DealModal
          lead={lead}
          masters={masters}
          mode={modal}
          onClose={() => setModal(null)}
          onEnrolled={(name) => {
            setModal(null);
            setCelebrateName(name);
          }}
        />
      )}

      {reopenOpen && (
        <ReopenServiceModal
          lead={lead}
          masters={masters}
          onClose={() => setReopenOpen(false)}
          onReopened={(leadId) => {
            setReopenOpen(false);
            // Land the consultant on the new follow-up lead so they can work it.
            router.push(`/crm/leads/${leadId}`);
          }}
        />
      )}

      {celebrateName && (
        <EnrollCelebration
          name={celebrateName}
          onDone={() => {
            setCelebrateName(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function DealModal({
  lead,
  masters,
  mode,
  onClose,
  onEnrolled,
}: {
  lead: LeadRow;
  masters: DetailMasters;
  mode: "deal" | "enroll";
  onClose: () => void;
  /** Fired on a successful enroll — hands the candidate name to the celebration. */
  onEnrolled?: (name: string) => void;
}) {
  const router = useRouter();
  const l2Bdes = masters.bdes.filter((b) => b.role === "l2");
  const assigneeIsL2 = !!lead.assignedTo && l2Bdes.some((b) => b.userId === lead.assignedTo!.id);
  const [serviceId, setServiceId] = useState(lead.service?.id ?? "");
  const [value, setValue] = useState(lead.expectedValue != null ? String(lead.expectedValue) : "");
  const [closeDate, setCloseDate] = useState(lead.expectedCloseDate ? lead.expectedCloseDate.slice(0, 10) : "");
  // Enroll: the date the close counts against in the CRM metrics. Defaults to
  // the lead's expected close date when it's already set and not in the future
  // (a month-end deal keyed the next morning dates back to when it closed),
  // else today (IST). Never defaults to a future date.
  const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const expClose = lead.expectedCloseDate ? lead.expectedCloseDate.slice(0, 10) : "";
  const [enrollDate, setEnrollDate] = useState(expClose && expClose <= todayIst ? expClose : todayIst);
  const [ownerId, setOwnerId] = useState(assigneeIsL2 ? lead.assignedTo!.id : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!serviceId) return setError("Pick a service.");
    if (!(Number(value) > 0)) return setError("Enter an expected value.");
    if (mode === "deal" && !closeDate) return setError("Pick an expected close date.");
    if (mode === "enroll" && !enrollDate) return setError("Pick the enrollment date.");
    if (!assigneeIsL2 && !ownerId) return setError("Choose an L2 BDE as the deal owner.");
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${lead.id}/${mode === "enroll" ? "enroll" : "deal"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serviceId,
        expectedValue: Number(value),
        // On enroll, the enrollment date is the actual close — send it as both
        // the close date (drives the CRM month bucket) and the expected close so
        // the lead's displayed deal date matches.
        expectedCloseDate: (mode === "enroll" ? enrollDate : closeDate) || undefined,
        ...(mode === "enroll" ? { closedDate: enrollDate || undefined } : {}),
        ownerUserId: assigneeIsL2 ? undefined : ownerId,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setError(d.message || d.error || "Could not save.");
      return;
    }
    // Enroll → hand off to the celebration (it triggers the refresh once the
    // party is done). Set deal → close + refresh immediately, as before.
    if (mode === "enroll" && onEnrolled) {
      onEnrolled(lead.candidateName);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Modal title={mode === "enroll" ? "Enroll candidate" : "Set deal"} onClose={onClose} busy={busy}>
      {mode === "enroll" && (
        <p className="text-label-sm text-on-surface-variant">
          Marks the lead <b>Enrolled</b>, adds the candidate to the Candidate Master (Finance can transact), and records
          the deal as won.
        </p>
      )}
      <Field label="Service">
        <select className={inputCls} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">Select…</option>
          {masters.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Expected value (₹)">
        <input className={inputCls} type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      {mode === "enroll" ? (
        <Field label="Enrollment date">
          <input className={inputCls} type="date" value={enrollDate} onChange={(e) => setEnrollDate(e.target.value)} />
          <p className="mt-xs text-label-sm text-on-surface-variant">
            The date this enrollment counts against in the reports. Defaults to today — set it back (e.g. to the last of the
            month) if the deal actually closed earlier.
          </p>
        </Field>
      ) : (
        <Field label="Expected close date">
          <input className={inputCls} type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
        </Field>
      )}
      {!assigneeIsL2 && (
        <Field label="Deal owner (L2 BDE)">
          <select className={inputCls} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Select an L2 BDE…</option>
            {l2Bdes.map((b) => (
              <option key={b.userId} value={b.userId}>
                {b.displayName}
              </option>
            ))}
          </select>
        </Field>
      )}
      {error && <p className="text-label-sm text-error">{error}</p>}
      <div className="flex justify-end gap-base pt-xs">
        <button type="button" className={secondaryBtn} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={primaryBtn} disabled={busy} onClick={submit}>
          {busy ? "Saving…" : mode === "enroll" ? "Enroll" : "Save deal"}
        </button>
      </div>
    </Modal>
  );
}

// Reopen an existing candidate for a FURTHER service. Does NOT enroll — it opens
// a new Follow-up lead for the second service (pre-linked to the same candidate,
// primary source "Existing Candidate", original source preserved) plus a
// follow-up task. The consultant then works it and enrolls via the normal
// Set-deal → Enroll flow, which is where counts + the finance draft happen.
function ReopenServiceModal({
  lead,
  masters,
  onClose,
  onReopened,
}: {
  lead: LeadRow;
  masters: DetailMasters;
  onClose: () => void;
  /** Fired on success — hands the NEW follow-up lead id so the caller can navigate. */
  onReopened: (newLeadId: string) => void;
}) {
  const [serviceId, setServiceId] = useState("");
  // Preserved original source — defaults to the candidate's current source.
  const [originalSourceId, setOriginalSourceId] = useState(lead.source?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!serviceId) return setError("Pick a service.");
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${lead.id}/reenroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serviceId,
        originalSourceId: originalSourceId || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setError(d.message || d.error || "Could not reopen.");
      return;
    }
    const d = (await res.json().catch(() => ({}))) as { leadId?: string };
    if (d.leadId) onReopened(d.leadId);
    else onClose();
  }

  return (
    <Modal title="Reopen for another service" onClose={onClose} busy={busy}>
      <p className="text-label-sm text-on-surface-variant">
        Opens a <b>new follow-up lead</b> for {lead.candidateName} in the chosen service and raises a follow-up task — work
        it like any lead and <b>Enroll</b> it once the deal closes (that&apos;s when it counts as an enrollment and drafts
        the revenue). The new lead&apos;s source is recorded as <b>&ldquo;Existing Candidate,&rdquo;</b> keeping their
        original source for attribution.
      </p>
      <Field label="Service">
        <select className={inputCls} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">Select…</option>
          {masters.services
            .filter((s) => s.id !== lead.service?.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Original source (kept for attribution)">
        <select className={inputCls} value={originalSourceId} onChange={(e) => setOriginalSourceId(e.target.value)}>
          <option value="">— None —</option>
          {masters.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      {error && <p className="text-label-sm text-error">{error}</p>}
      <div className="flex justify-end gap-base pt-xs">
        <button type="button" className={secondaryBtn} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={primaryBtn} disabled={busy} onClick={submit}>
          {busy ? "Reopening…" : "Reopen for follow-up"}
        </button>
      </div>
    </Modal>
  );
}

// ── Lead info (right rail) ──────────────────────────────────────────────────
// `canEdit` (admin OR the assigned consultant) may link/unlink the lead to an
// existing candidate record — e.g. a husband's enquiry for his wife, whose
// candidate record already exists, gets linked to her.
function LeadInfoCard({ lead, masters, canEdit }: { lead: LeadRow; masters: DetailMasters; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function linkParty(value: string | null) {
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
      <CardHeading icon="info" color="#3b82f6">Lead detail</CardHeading>
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
        {canEdit && (
          <CandidateLinkPicker
            current={lead.party ? { id: lead.party.id, name: lead.party.name } : null}
            parties={masters.parties}
            busy={busy}
            onLink={linkParty}
          />
        )}
      </div>
    </div>
  );
}

// Searchable candidate linker. Filters the (already-loaded) candidate list by
// name or phone so a consultant can quickly find an existing record to link.
function CandidateLinkPicker({
  current,
  parties,
  busy,
  onLink,
}: {
  current: { id: string; name: string } | null;
  parties: PartyOpt[];
  busy: boolean;
  onLink: (id: string | null) => void | Promise<void>;
  }) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return parties.slice(0, 25);
    const digits = q.replace(/\D/g, "");
    return parties
      .filter((p) => {
        if (p.label.toLowerCase().includes(q)) return true;
        return digits.length >= 3 && (p.phone ?? "").replace(/\D/g, "").includes(digits);
      })
      .slice(0, 25);
  }, [query, parties]);

  if (!editing) {
    return (
      <div className="mt-sm flex items-center gap-base">
        <button
          type="button"
          className={secondaryBtn + " h-9 text-label-sm"}
          disabled={busy}
          onClick={() => {
            setEditing(true);
            setQuery("");
          }}
        >
          {current ? "Change linked candidate" : "Link a candidate"}
        </button>
        {current && (
          <button
            type="button"
            className="h-9 px-md text-label-sm text-error hover:underline disabled:opacity-60"
            disabled={busy}
            onClick={() => onLink(null)}
          >
            Unlink
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-sm space-y-xs">
      <input
        autoFocus
        className={inputCls}
        placeholder="Search candidate by name or phone…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-56 overflow-auto rounded-lg border border-outline-variant divide-y divide-outline-variant/60">
        {matches.length === 0 ? (
          <p className="px-md py-sm text-label-sm text-on-surface-variant">No matching candidates.</p>
        ) : (
          matches.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy || p.id === current?.id}
              onClick={async () => {
                await onLink(p.id);
                setEditing(false);
              }}
              className="w-full text-left px-md py-sm hover:bg-surface-container-low disabled:opacity-50 flex items-center justify-between gap-md"
            >
              <span className="text-body-md text-on-surface">
                {p.label}
                {p.id === current?.id && <span className="text-label-sm text-on-surface-variant"> · linked</span>}
              </span>
              {p.phone && <span className="text-label-sm text-on-surface-variant font-mono whitespace-nowrap">{p.phone}</span>}
            </button>
          ))
        )}
      </div>
      <div className="flex justify-end">
        <button type="button" className="text-label-sm text-on-surface-variant hover:text-on-surface" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Comms modals ──────────────────────────────────────────────────────────────

/** Merge-field values for a single lead's email / WhatsApp templates. */
function leadCommsVars(lead: LeadRow) {
  return buildLeadMergeVars({
    candidateName: lead.candidateName,
    service: lead.service?.name,
    consultant: lead.assignedTo?.name,
    consultantPhone: lead.assignedTo?.phone,
    campaign: lead.campaign,
    qualification: lead.qualification?.label,
  });
}

// "Blank" is the only built-in; all real templates are DB-managed on
// /crm/templates and appended below (seeded via db:seed-crm-templates).
const EMAIL_TEMPLATES: { id: string; label: string; subject: string; body: string }[] = [
  { id: "blank", label: "Blank", subject: "", body: "" },
];

function EmailModal({
  lead,
  emailConfigured,
  templates,
  onClose,
}: {
  lead: LeadRow;
  emailConfigured: boolean;
  templates: MessageTemplateDTO[];
  onClose: () => void;
}) {
  const router = useRouter();
  const vars = leadCommsVars(lead);
  // Built-in defaults first, then the team's saved email templates.
  const options = [
    ...EMAIL_TEMPLATES,
    ...templates
      .filter((t) => t.channel === "email")
      .map((t) => ({ id: t.id, label: t.name, subject: t.subject ?? "", body: t.body })),
  ];
  const [tpl, setTpl] = useState("blank");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyTemplate(id: string) {
    setTpl(id);
    const t = options.find((x) => x.id === id);
    if (t) {
      setSubject(fillTemplate(t.subject, vars));
      setBody(fillTemplate(t.body, vars));
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
    if (!res.ok) {
      setBusy(false);
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setError(d.message || (d.error === "no_email" ? "This lead has no email address." : "Failed."));
      return;
    }
    // delivery==="gmail": sent server-side (a copy is in the mailbox's Sent).
    // Otherwise we got a mailto: link to open the desktop mail client.
    const d = (await res.json()) as { mailtoUrl?: string; delivery?: string };
    setBusy(false);
    if (d.mailtoUrl) window.location.href = d.mailtoUrl;
    onClose();
    router.refresh();
  }

  return (
    <Modal title="Email lead" onClose={onClose} busy={busy}>
      {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">{error}</div>}
      {!emailConfigured && (
        <div className="rounded-lg bg-amber-50 text-amber-800 border border-amber-200 px-md py-sm text-label-sm">
          No email sender is configured, so this opens your desktop mail app. Admins can enable in-app sending in Settings → Integrations.
        </div>
      )}
      <Field label="To">
        <input className={inputCls} value={lead.email ?? ""} disabled />
      </Field>
      <Field label="Template">
        <select className={inputCls} value={tpl} onChange={(e) => applyTemplate(e.target.value)}>
          {options.map((t) => (
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
        <button
          type="button"
          className={primaryBtn}
          disabled={busy || (emailConfigured && !subject.trim() && !body.trim())}
          onClick={send}
        >
          {busy ? "Sending…" : emailConfigured ? "Send email" : "Open email"}
        </button>
      </div>
    </Modal>
  );
}

function WhatsAppModal({
  lead,
  templates,
  onClose,
}: {
  lead: LeadRow;
  templates: MessageTemplateDTO[];
  onClose: () => void;
}) {
  const router = useRouter();
  const vars = leadCommsVars(lead);
  // Blank + the team's saved WhatsApp templates (DB-managed on /crm/templates).
  const options = [
    { id: "blank", label: "Blank", body: "" },
    ...templates.filter((t) => t.channel === "whatsapp").map((t) => ({ id: t.id, label: t.name, body: t.body })),
  ];
  // Pre-select the first real template if there is one; otherwise start blank.
  const initial = options.find((o) => o.id !== "blank") ?? options[0];
  const [tpl, setTpl] = useState(initial.id);
  const [message, setMessage] = useState(fillTemplate(initial.body, vars));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyTemplate(id: string) {
    setTpl(id);
    const t = options.find((x) => x.id === id);
    if (t) setMessage(fillTemplate(t.body, vars));
  }

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
      {options.length > 1 && (
        <Field label="Template">
          <select className={inputCls} value={tpl} onChange={(e) => applyTemplate(e.target.value)}>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
      )}
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
          rows={12}
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

// ── WhatsApp thread tab ────────────────────────────────────────────────────
//
// Phase 1 of moving the shared inbox into the CRM: the conversation is READ
// here, still replied to in Wabis. That split is stated on screen rather than
// hidden, because a thread you can read but not answer looks broken unless the
// UI says why.

type WaMessageRow = {
  id: string;
  direction: string;
  type: string;
  body: string | null;
  mediaMime: string | null;
  fileName: string | null;
  templateName: string | null;
  waStatus: string | null;
  waErrorCode: string | null;
  occurredAt: string;
  sentByName: string | null;
};

type WaConversationDTO = {
  id: string;
  phoneE164: string;
  status: string;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  sessionExpiresAt: string | null;
  sessionOpen: boolean;
  messages: WaMessageRow[];
  truncated: boolean;
};

/** Meta's delivery states, shown as a single glyph so they never crowd the text. */
const WA_STATUS_GLYPH: Record<string, { icon: string; cls: string; label: string }> = {
  sent: { icon: "done", cls: "text-on-surface-variant", label: "Sent" },
  delivered: { icon: "done_all", cls: "text-on-surface-variant", label: "Delivered" },
  read: { icon: "done_all", cls: "text-primary", label: "Read" },
  failed: { icon: "error", cls: "text-error", label: "Failed" },
};

function WhatsAppThreadPanel({ leadId, leadName }: { leadId: string; leadName: string }) {
  const [data, setData] = useState<{ conversation: WaConversationDTO | null; canReply: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFailed(false);
      const res = await fetch(`/api/crm/leads/${leadId}/wa`).catch(() => null);
      if (cancelled) return;
      setLoading(false);
      if (!res?.ok) {
        setFailed(true);
        return;
      }
      setData((await res.json()) as { conversation: WaConversationDTO | null; canReply: boolean });
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  const conversation = data?.conversation ?? null;

  return (
    <div className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-base">
        <CardHeading icon="chat" color="#25a244">
          WhatsApp
        </CardHeading>
        {conversation && (
          <span className="text-label-sm text-on-surface-variant font-mono tabular-nums">{conversation.phoneE164}</span>
        )}
      </div>

      {loading && <p className="text-body-md text-on-surface-variant">Loading conversation…</p>}

      {failed && !loading && (
        <p className="text-body-md text-error">
          Couldn’t load the conversation. Refresh the page to try again.
        </p>
      )}

      {!loading && !failed && !conversation && (
        <div className="space-y-xs">
          <p className="text-body-md text-on-surface-variant">No WhatsApp conversation yet.</p>
          <p className="text-label-sm text-on-surface-variant">
            Messages appear here once {leadName || "this candidate"} writes to the business number and the conversation
            mirror is switched on in CRM → Settings.
          </p>
        </div>
      )}

      {conversation && (
        <>
          <div className="flex flex-wrap items-center gap-sm text-label-sm">
            {conversation.sessionOpen ? (
              <span className="inline-flex items-center gap-xs px-sm h-6 rounded-full bg-emerald-500/10 text-emerald-600 font-semibold">
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                  schedule
                </span>
                Reply window open
              </span>
            ) : (
              <span className="inline-flex items-center gap-xs px-sm h-6 rounded-full bg-surface-container-low text-on-surface-variant font-semibold">
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                  lock_clock
                </span>
                Reply window closed — template only
              </span>
            )}
            {conversation.lastInboundAt && (
              <span className="text-on-surface-variant">Last reply {fmtRelative(conversation.lastInboundAt)}</span>
            )}
          </div>

          {conversation.truncated && (
            <p className="text-label-sm text-on-surface-variant">
              Showing the most recent {conversation.messages.length} messages.
            </p>
          )}

          <div className="overflow-auto scrollbar-thin max-h-[calc(100vh-420px)] rounded-lg border border-outline-variant bg-surface-container-low p-md space-y-sm">
            {conversation.messages.length === 0 && (
              <p className="text-body-md text-on-surface-variant text-center py-lg">This thread has no messages yet.</p>
            )}
            {conversation.messages.map((m) => (
              <WaBubble key={m.id} message={m} />
            ))}
          </div>

          <p className="text-label-sm text-on-surface-variant">
            {data?.canReply
              ? "Read-only for now — reply in Wabis. Sending from the CRM arrives with the inbox."
              : "Read-only — only the assigned consultant or an admin can reply to this lead."}
          </p>
        </>
      )}
    </div>
  );
}

function WaBubble({ message }: { message: WaMessageRow }) {
  const outbound = message.direction === "out";
  const status = message.waStatus ? WA_STATUS_GLYPH[message.waStatus] : null;
  // A media message with no caption still has to render as something — the type
  // plus filename is more use than an empty bubble.
  const text = message.body?.trim() || (message.type !== "text" ? `[${message.type}]` : "");

  return (
    <div className={"flex " + (outbound ? "justify-end" : "justify-start")}>
      <div
        className={
          "max-w-[80%] rounded-xl px-md py-sm space-y-xs " +
          (outbound
            ? "bg-primary/10 border border-primary/20"
            : "bg-surface-container-lowest border border-outline-variant")
        }
      >
        {message.templateName && (
          <span className="block text-label-sm text-on-surface-variant font-mono">{message.templateName}</span>
        )}
        <p className="text-body-md text-on-surface whitespace-pre-wrap break-words">{text}</p>
        {message.fileName && (
          <span className="block text-label-sm text-on-surface-variant">
            {message.fileName}
            {message.mediaMime ? ` · ${message.mediaMime}` : ""}
          </span>
        )}
        <div className="flex items-center justify-end gap-xs text-label-sm text-on-surface-variant">
          {outbound && message.sentByName && <span>{message.sentByName}</span>}
          <span className="tabular-nums">{fmtDateTime(message.occurredAt)}</span>
          {status && (
            <span
              className={"material-symbols-outlined " + status.cls}
              style={{ fontSize: 14 }}
              title={message.waErrorCode ? `${status.label} (${message.waErrorCode})` : status.label}
            >
              {status.icon}
            </span>
          )}
        </div>
      </div>
    </div>
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
  "RE_INQUIRY",
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
        <CardHeading icon="history" color="#f59e0b">History</CardHeading>
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
  leadName,
  tasks,
  canEdit,
  bdes,
  defaultAssigneeId,
}: {
  leadId: string;
  leadName: string;
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
        <CardHeading icon="checklist" color="#ec4899">Tasks</CardHeading>
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
              <TaskItem key={t.id} leadId={leadId} leadName={leadName} task={t} canEdit={canEdit} />
            ))}
          </ul>
        )}
      </div>

      {done.length > 0 && (
        <div className="space-y-xs">
          <div className="text-label-sm uppercase tracking-wider text-on-surface-variant">Completed</div>
          <ul className="space-y-base">
            {done.map((t) => (
              <TaskItem key={t.id} leadId={leadId} leadName={leadName} task={t} canEdit={canEdit} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Fixed task types for the lead task composer — a closed list keeps subjects
// consistent so they read cleanly on the board and in the tasks export.
const TASK_TYPES = ["Follow-up Call", "WhatsApp Message", "Document Request", "Payment Request"] as const;

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
      <select value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls}>
        <option value="">Select a task…</option>
        {TASK_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
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

function TaskItem({ leadId, task, canEdit, leadName }: { leadId: string; task: TaskRow; canEdit: boolean; leadName?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [nextError, setNextError] = useState<string | null>(null);
  const done = task.status === "done";
  const due = taskDueLabel(task.dueAt);

  // Complete the task; if it's the active lead's last open task the API returns
  // 422 next_task_required, so we collect the next follow-up and retry with it.
  async function complete(nextTask?: NextStepPayload) {
    setBusy(true);
    setNextError(null);
    const res = await fetch(`/api/crm/leads/${leadId}/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(nextTask ? { status: "done", nextTask } : { status: "done" }),
    });
    if (res.status === 422) {
      const j = await res.json().catch(() => null);
      if (j?.error === "next_task_required") {
        setBusy(false);
        if (nextTask) setNextError("Couldn’t complete the task. Please try again.");
        else setShowNext(true);
        return;
      }
    }
    setBusy(false);
    if (res.ok) {
      setShowNext(false);
      router.refresh();
    }
  }

  async function toggle() {
    if (!canEdit || busy) return;
    if (!done) {
      await complete();
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${leadId}/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "open" }),
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
      {showNext && (
        <NextStepDialog
          leadName={leadName}
          busy={busy}
          error={nextError}
          onCancel={() => {
            setShowNext(false);
            setNextError(null);
          }}
          onSubmit={(p) => complete(p)}
        />
      )}
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
