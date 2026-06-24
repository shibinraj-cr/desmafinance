"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { type LeadRow, isActionOnlyStatus } from "@/lib/crm-leads";
import { DEFAULT_STATUS_COLOR, BULK_EMAIL_MERGE_FIELDS, fillTemplate } from "@/lib/crm";
import { COUNTRIES } from "@/lib/countries";

// ── Shared prop shapes ──────────────────────────────────────────────────────
export type StatusOpt = { id: string; code: string; label: string; kind: string; color: string | null };
export type Opt = { id: string; label: string };
export type BdeOpt = { userId: string; displayName: string; username: string; role: string };
export type Masters = {
  statuses: StatusOpt[];
  sources: Opt[];
  services: Opt[];
  qualifications: Opt[];
  bdes: BdeOpt[];
  campaigns: string[];
  /** Distinct, non-empty country values present in the data (drives the filter). */
  countries: string[];
};
export type LeadsAccess = {
  canCreate: boolean;
  canAssign: boolean;
  canBulkImport: boolean;
  canBulkEmail: boolean;
  emailConfigured: boolean;
  isAdmin: boolean;
  isBde: boolean;
  userId: string;
  /** Count of fresh (Not Yet Started) leads assigned to the signed-in BDE. */
  newLeadsCount: number;
};

// ── Reusable class strings (verbatim from the design system) ────────────────
const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";
const selectClass =
  "h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition";
const primaryBtn =
  "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
const secondaryBtn =
  "h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
    </label>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={"px-md py-sm text-label-sm uppercase tracking-wider " + className}>{children}</th>;
}
function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={"px-md py-sm align-middle " + className}>{children}</td>;
}

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-xs h-8 px-md rounded-full border text-label-sm font-semibold transition " +
        (active
          ? "bg-primary text-on-primary border-primary"
          : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
      }
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span
          className={
            "text-[10px] font-bold px-xs py-[1px] rounded-full min-w-[18px] text-center " +
            (active ? "bg-on-primary/20" : "bg-primary text-on-primary")
          }
        >
          {count}
        </span>
      )}
    </button>
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

export function StatusPill({ status }: { status: { label: string; color: string | null } }) {
  const color = status.color || DEFAULT_STATUS_COLOR;
  return (
    <span
      className="px-xs py-[2px] rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
      style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}66` }}
    >
      {status.label}
    </span>
  );
}

function waLink(phoneE164: string): string {
  return `https://wa.me/${phoneE164.replace(/[^0-9]/g, "")}`;
}

// Best-effort logging for the list-grid quick actions: fire the comms POST
// without blocking, so the anchor's deep link still opens natively (no popup
// block). Only used for rows the current user may edit.
function logQuickComm(leadId: string, channel: "email" | "whatsapp") {
  void fetch(`/api/crm/leads/${leadId}/comms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channel }),
  }).catch(() => {});
}

// ── Toolbar: New lead + Import (lives in the TopBar action) ─────────────────
export function LeadsToolbar({ masters, access }: { masters: Masters; access: LeadsAccess }) {
  return (
    <div className="flex items-center gap-base">
      {access.canBulkImport && <ImportControl />}
      {access.canCreate && <NewLeadButton masters={masters} access={access} />}
    </div>
  );
}

function ImportControl() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function onUpload(file: File) {
    setMsg(null);
    setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = await fetch("/api/crm/leads/import", { method: "POST", body: fd });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setErr(d.message || d.error || "Import failed.");
        return;
      }
      const d = (await res.json()) as {
        totalRows: number;
        insertedRows: number;
        duplicateRows: number;
        errorRows: number;
      };
      setMsg(
        `Imported ${d.totalRows.toLocaleString("en-IN")} — ${d.insertedRows.toLocaleString("en-IN")} new, ` +
          `${d.duplicateRows.toLocaleString("en-IN")} duplicate${d.duplicateRows === 1 ? "" : "s"}` +
          (d.errorRows ? `, ${d.errorRows} error${d.errorRows === 1 ? "" : "s"}` : "") +
          ".",
      );
      router.refresh();
    });
  }

  return (
    <div className="relative flex items-center gap-xs">
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-xs h-9 px-md rounded-lg border border-outline-variant text-on-surface-variant text-label-sm font-semibold hover:bg-surface-container-low transition disabled:opacity-60"
        title="Import leads from .xlsx or .csv"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          upload
        </span>
        {busy ? "Importing…" : "Import"}
      </button>
      {(msg || err) && (
        <div className="absolute right-0 top-11 z-40 w-80 rounded-lg border px-md py-sm text-label-sm shadow-lg bg-surface-container-lowest border-outline-variant">
          <div className="flex items-start gap-xs">
            <span className={err ? "text-error" : "text-green-700"}>{err || msg}</span>
            <button
              type="button"
              className="ml-auto text-on-surface-variant hover:text-on-surface"
              onClick={() => {
                setMsg(null);
                setErr(null);
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                close
              </span>
            </button>
          </div>
          <a
            href="/api/crm/leads/import/template"
            className="mt-xs inline-block text-primary hover:underline text-label-sm"
          >
            Download import template
          </a>
        </div>
      )}
    </div>
  );
}

function NewLeadButton({ masters, access }: { masters: Masters; access: LeadsAccess }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    candidateName: "",
    email: "",
    phone: "",
    altPhone: "",
    sourceId: "",
    serviceId: "",
    qualificationId: "",
    country: "",
    statusId: "",
    assignedToId: "",
  });

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.candidateName.trim()) {
      setError("Candidate name is required.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/crm/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        candidateName: form.candidateName.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        altPhone: form.altPhone.trim() || undefined,
        sourceId: form.sourceId || undefined,
        serviceId: form.serviceId || undefined,
        qualificationId: form.qualificationId || undefined,
        country: form.country || undefined,
        statusId: form.statusId || undefined,
        assignedToId: access.canAssign ? form.assignedToId || undefined : undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      setError(d.message || (d.error === "validation_error" ? "Please check the fields." : "Failed to create lead."));
      return;
    }
    setForm({
      candidateName: "",
      email: "",
      phone: "",
      altPhone: "",
      sourceId: "",
      serviceId: "",
      qualificationId: "",
      country: "",
      statusId: "",
      assignedToId: "",
    });
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-xs h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          add
        </span>
        New lead
      </button>
      {open &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md"
            onClick={() => !busy && setOpen(false)}
          >
            <form
              onClick={(e) => e.stopPropagation()}
              onSubmit={submit}
              className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
            >
              <h3 className="text-h3 text-on-surface">New lead</h3>
              {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">{error}</div>}
              <Field label="Candidate name *">
                <input
                  className={inputCls}
                  value={form.candidateName}
                  onChange={(e) => setForm({ ...form, candidateName: e.target.value })}
                  autoFocus
                />
              </Field>
              <div className="grid grid-cols-2 gap-md">
                <Field label="Email">
                  <input
                    className={inputCls}
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </Field>
                <Field label="Phone">
                  <input
                    className={inputCls}
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Alternative phone">
                <input
                  className={inputCls}
                  value={form.altPhone}
                  onChange={(e) => setForm({ ...form, altPhone: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-md">
                <Field label="Source">
                  <select
                    className={inputCls}
                    value={form.sourceId}
                    onChange={(e) => setForm({ ...form, sourceId: e.target.value })}
                  >
                    <option value="">—</option>
                    {masters.sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Service">
                  <select
                    className={inputCls}
                    value={form.serviceId}
                    onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
                  >
                    <option value="">—</option>
                    {masters.services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-md">
                <Field label="Qualification">
                  <select
                    className={inputCls}
                    value={form.qualificationId}
                    onChange={(e) => setForm({ ...form, qualificationId: e.target.value })}
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
                  <select
                    className={inputCls}
                    value={form.statusId}
                    onChange={(e) => setForm({ ...form, statusId: e.target.value })}
                  >
                    <option value="">Default</option>
                    {/* Pipeline & Enrolled are set by actions (Set deal / Enroll), not at
                        creation — exclude them here (server also rejects them). */}
                    {masters.statuses
                      .filter((s) => !isActionOnlyStatus(s.code))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
              <Field label="Country">
                <select
                  className={inputCls}
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                >
                  <option value="">—</option>
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              {access.canAssign && (
                <Field label="Consultant (BDE)">
                  <select
                    className={inputCls}
                    value={form.assignedToId}
                    onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}
                  >
                    <option value="">Unassigned</option>
                    {masters.bdes.map((b) => (
                      <option key={b.userId} value={b.userId}>
                        {b.displayName}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="flex justify-end gap-base pt-xs">
                <button type="button" className={secondaryBtn} onClick={() => setOpen(false)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className={primaryBtn} disabled={busy}>
                  {busy ? "Saving…" : "Create lead"}
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}

// ── Filters + table ─────────────────────────────────────────────────────────
const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "created_desc", label: "Newest first" },
  { value: "created_asc", label: "Oldest first" },
  { value: "activity_desc", label: "Recent activity" },
  { value: "assigned_desc", label: "Recently assigned" },
  { value: "name_asc", label: "Name A–Z" },
];

// Reorderable leads-table data columns (the selection + Actions columns stay
// fixed). Order is remembered per browser in localStorage.
const LEADS_COL_ORDER_KEY = "crm.leads.columnOrder.v1";
const LEADS_DEFAULT_COLUMNS = [
  "created", "source", "campaign", "status", "candidate", "email", "phone", "country", "service", "qualification", "consultant", "assigned",
] as const;

export function LeadsTable({
  leads,
  total,
  page,
  pageSize,
  masters,
  access,
}: {
  leads: LeadRow[];
  total: number;
  page: number;
  pageSize: number;
  masters: Masters;
  access: LeadsAccess;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [q, setQ] = useState(search.get("q") ?? "");

  useEffect(() => {
    setQ(search.get("q") ?? "");
  }, [search]);

  function update(patch: Record<string, string | null>, keepPage = false) {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    if (!keepPage && !("page" in patch)) params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  // ── Bulk selection (admins only) ────────────────────────────────────────────
  const bulk = access.canBulkEmail;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [matchedAll, setMatchedAll] = useState<{ emailable: number; total: number; truncated: boolean } | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  // Reset the selection whenever the FILTER (not just the page) changes, so a
  // "select all matching" set can never leak onto a different filter.
  const filterKey = useMemo(() => {
    const p = new URLSearchParams(search.toString());
    p.delete("page");
    return p.toString();
  }, [search]);
  useEffect(() => {
    setSelected(new Set());
    setMatchedAll(null);
  }, [filterKey]);

  const pageEmailableIds = useMemo(() => leads.filter((l) => l.email).map((l) => l.id), [leads]);
  const allPageSelected = pageEmailableIds.length > 0 && pageEmailableIds.every((id) => selected.has(id));
  const somePageSelected = pageEmailableIds.some((id) => selected.has(id));

  // ── Reorderable columns (drag headers; persisted per browser) ───────────────
  const [colOrder, setColOrder] = useState<string[]>([...LEADS_DEFAULT_COLUMNS]);
  const [dragCol, setDragCol] = useState<string | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LEADS_COL_ORDER_KEY) || "null");
      if (Array.isArray(saved)) {
        const known = new Set<string>(LEADS_DEFAULT_COLUMNS);
        const kept = saved.filter((id: unknown): id is string => typeof id === "string" && known.has(id));
        const missing = LEADS_DEFAULT_COLUMNS.filter((id) => !kept.includes(id));
        setColOrder([...kept, ...missing]);
      }
    } catch {
      /* ignore malformed localStorage */
    }
  }, []);
  function saveColOrder(order: string[]) {
    setColOrder(order);
    try {
      localStorage.setItem(LEADS_COL_ORDER_KEY, JSON.stringify(order));
    } catch {
      /* ignore */
    }
  }
  function dropCol(targetId: string) {
    if (!dragCol || dragCol === targetId) {
      setDragCol(null);
      return;
    }
    const next = colOrder.filter((id) => id !== dragCol);
    next.splice(next.indexOf(targetId), 0, dragCol);
    saveColOrder(next);
    setDragCol(null);
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMatchedAll(null);
  }
  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageEmailableIds.forEach((id) => next.delete(id));
      else pageEmailableIds.forEach((id) => next.add(id));
      return next;
    });
    setMatchedAll(null);
  }
  function clearSelection() {
    setSelected(new Set());
    setMatchedAll(null);
  }
  async function selectAllMatching() {
    setSelectingAll(true);
    const params = new URLSearchParams(search.toString());
    params.delete("page");
    params.delete("pageSize");
    const res = await fetch(`/api/crm/leads/ids${params.toString() ? `?${params.toString()}` : ""}`);
    setSelectingAll(false);
    if (!res.ok) return;
    const d = (await res.json()) as { ids: string[]; emailable: number; total: number; truncated: boolean };
    setSelected(new Set(d.ids));
    setMatchedAll({ emailable: d.emailable, total: d.total, truncated: d.truncated });
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // "all" is the BDE "All leads" opt-out, not a narrowing filter, so it doesn't
  // count toward anyFilter (which gates the "Clear filters" affordance).
  const rawAssignee = search.get("assignee");
  const assigneeIsFilter = !!rawAssignee && rawAssignee !== "all";
  const anyFilter =
    !!search.get("status") ||
    !!search.get("source") ||
    !!search.get("service") ||
    assigneeIsFilter ||
    !!search.get("campaign") ||
    !!search.get("country") ||
    !!search.get("assignedOn") ||
    !!search.get("q");

  // Export link mirrors the current filters (drop pagination — export all matches).
  const exportParams = new URLSearchParams(search.toString());
  exportParams.delete("page");
  exportParams.delete("pageSize");
  const exportHref = "/api/crm/leads/export" + (exportParams.toString() ? `?${exportParams.toString()}` : "");

  // "My leads" / "My new leads" quick filters for BDEs. "New" = Not Yet Started
  // leads assigned to me (fresh, not-yet-worked).
  // Effective assignee mirrors the server default: a BDE with no explicit
  // assignee lands on their own queue, so the list opens on "my leads". Non-BDEs
  // (and the explicit "All leads" / "all" choice) see everyone.
  const effectiveAssignee = rawAssignee ?? (access.isBde ? access.userId : "all");
  const newStatusId = masters.statuses.find((s) => s.code === "not_yet_started")?.id ?? null;
  const mineAssignee = effectiveAssignee === access.userId;
  const isAllLeads = effectiveAssignee === "all";
  const isMyNew = mineAssignee && !!newStatusId && search.get("status") === newStatusId;
  const isMyLeads = mineAssignee && !isMyNew;
  const showMine = access.isBde;

  // Column definitions (selection + Actions are rendered separately and fixed).
  const dataColumns: {
    id: string;
    label: string;
    className: string;
    render: (lead: LeadRow, canEdit: boolean) => React.ReactNode;
  }[] = [
    { id: "created", label: "Created", className: "whitespace-nowrap font-mono tabular-nums text-on-surface-variant", render: (l) => fmtDateTime(l.createdAt) },
    { id: "source", label: "Source", className: "whitespace-nowrap", render: (l) => l.source?.label ?? "—" },
    {
      id: "campaign",
      label: "Campaign",
      className: "whitespace-nowrap text-on-surface-variant",
      render: (l) =>
        l.campaign ? (
          <button type="button" onClick={() => update({ campaign: l.campaign })} className="hover:text-primary hover:underline" title={`Filter by ${l.campaign}`}>
            {l.campaign}
          </button>
        ) : (
          "—"
        ),
    },
    { id: "status", label: "Status", className: "", render: (l) => <StatusPill status={l.status} /> },
    {
      id: "candidate",
      label: "Candidate",
      className: "whitespace-nowrap font-semibold",
      render: (l) => (
        <Link href={`/crm/leads/${l.id}`} className="text-on-surface hover:text-primary hover:underline">
          {l.candidateName}
        </Link>
      ),
    },
    { id: "email", label: "Email", className: "whitespace-nowrap text-on-surface-variant", render: (l) => l.email ?? "—" },
    { id: "phone", label: "Phone", className: "whitespace-nowrap text-on-surface-variant", render: (l) => l.phone ?? "—" },
    {
      id: "country",
      label: "Country",
      className: "whitespace-nowrap text-on-surface-variant",
      render: (l) =>
        l.country ? (
          <button type="button" onClick={() => update({ country: l.country })} className="hover:text-primary hover:underline" title={`Filter by ${l.country}`}>
            {l.country}
          </button>
        ) : (
          "—"
        ),
    },
    { id: "service", label: "Service", className: "whitespace-nowrap", render: (l) => l.service?.name ?? "—" },
    { id: "qualification", label: "Qualification", className: "whitespace-nowrap", render: (l) => l.qualification?.label ?? "—" },
    {
      id: "consultant",
      label: "Consultant",
      className: "whitespace-nowrap",
      render: (l, canEdit) =>
        access.canAssign ? (
          <AssignSelect lead={l} bdes={masters.bdes} />
        ) : (
          <span className="inline-flex items-center gap-xs">
            {l.assignedTo?.name ?? <span className="text-on-surface-variant">Unassigned</span>}
            {!canEdit && access.isBde && (
              <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 14 }} title={l.assignedTo ? `Assigned to ${l.assignedTo.name}` : "Unassigned"}>
                lock
              </span>
            )}
          </span>
        ),
    },
    {
      id: "assigned",
      label: "Assigned",
      className: "whitespace-nowrap font-mono tabular-nums text-on-surface-variant",
      render: (l) => (l.assignedAt ? fmtDateTime(l.assignedAt) : "—"),
    },
  ];
  const orderedColumns = colOrder
    .map((id) => dataColumns.find((c) => c.id === id))
    .filter((c): c is (typeof dataColumns)[number] => !!c);
  const columnsCustomized = colOrder.join(",") !== [...LEADS_DEFAULT_COLUMNS].join(",");

  return (
    <div className="space-y-md">
      {showMine && (
        <div className="flex flex-wrap items-center gap-xs">
          <Chip label="All leads" active={isAllLeads} onClick={() => update({ assignee: "all", status: null })} />
          <Chip label="My leads" active={isMyLeads} onClick={() => update({ assignee: access.userId, status: null })} />
          <Chip
            label="My new leads"
            count={access.newLeadsCount}
            active={isMyNew}
            onClick={() => update({ assignee: access.userId, status: newStatusId })}
          />
        </div>
      )}
      {/* Filter band */}
      <div className="flex flex-wrap items-center gap-base">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: q.trim() || null });
          }}
          className="flex items-center"
        >
          <div className="relative">
            <span
              className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant"
              style={{ fontSize: 18 }}
            >
              search
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, email, phone…"
              className="h-9 pl-9 pr-md rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition w-64"
            />
          </div>
        </form>

        <select className={selectClass} value={search.get("status") ?? ""} onChange={(e) => update({ status: e.target.value || null })}>
          <option value="">All statuses</option>
          {masters.statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

        <select className={selectClass} value={search.get("source") ?? ""} onChange={(e) => update({ source: e.target.value || null })}>
          <option value="">All sources</option>
          {masters.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

        <select className={selectClass} value={search.get("service") ?? ""} onChange={(e) => update({ service: e.target.value || null })}>
          <option value="">All services</option>
          {masters.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

        <select className={selectClass} value={effectiveAssignee} onChange={(e) => update({ assignee: e.target.value })}>
          <option value="all">All consultants</option>
          <option value="unassigned">Unassigned</option>
          {masters.bdes.map((b) => (
            <option key={b.userId} value={b.userId}>
              {b.displayName}
            </option>
          ))}
        </select>

        <label
          className={selectClass + " inline-flex items-center gap-xs text-on-surface-variant"}
          title="Show only leads assigned (to a consultant) on this date"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            person_add
          </span>
          <span className="whitespace-nowrap">Assigned</span>
          <input
            type="date"
            value={search.get("assignedOn") ?? ""}
            onChange={(e) => update({ assignedOn: e.target.value || null })}
            className="bg-transparent outline-none text-on-surface"
          />
        </label>

        {masters.campaigns.length > 0 && (
          <select className={selectClass} value={search.get("campaign") ?? ""} onChange={(e) => update({ campaign: e.target.value || null })}>
            <option value="">All campaigns</option>
            {masters.campaigns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}

        {masters.countries.length > 0 && (
          <select className={selectClass} value={search.get("country") ?? ""} onChange={(e) => update({ country: e.target.value || null })}>
            <option value="">All countries</option>
            {masters.countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}

        <select className={selectClass} value={search.get("sort") ?? "created_desc"} onChange={(e) => update({ sort: e.target.value })}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {anyFilter && (
          <button
            type="button"
            onClick={() => update({ status: null, source: null, service: null, assignee: null, campaign: null, country: null, assignedOn: null, q: null })}
            className="h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition"
          >
            Clear all
          </button>
        )}

        <a
          href={exportHref}
          className="ml-auto h-9 px-md rounded-lg border border-outline-variant text-label-sm font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition inline-flex items-center gap-xs"
          title="Download the filtered leads as an Excel file"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            download
          </span>
          Export Excel
        </a>

        {columnsCustomized && (
          <button
            type="button"
            onClick={() => saveColOrder([...LEADS_DEFAULT_COLUMNS])}
            className="h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition inline-flex items-center gap-xs"
            title="Reset the column order to default"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              restart_alt
            </span>
            Reset columns
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {bulk && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-base rounded-xl border border-primary/40 bg-primary/5 px-md py-sm">
          <span className="text-label-md font-semibold text-on-surface">
            {selected.size.toLocaleString()} selected
          </span>
          {!matchedAll && total > pageEmailableIds.length && (
            <button type="button" onClick={selectAllMatching} disabled={selectingAll} className="text-label-sm text-primary hover:underline disabled:opacity-60">
              {selectingAll ? "Selecting…" : "Select every emailable lead matching the filter"}
            </button>
          )}
          {matchedAll && (
            <span className="text-label-sm text-on-surface-variant">
              All {matchedAll.emailable.toLocaleString()} emailable lead{matchedAll.emailable === 1 ? "" : "s"} selected
              {matchedAll.truncated ? " (capped at 5,000)" : ""}
              {matchedAll.total > matchedAll.emailable ? ` · ${(matchedAll.total - matchedAll.emailable).toLocaleString()} have no email` : ""}
            </span>
          )}
          <div className="ml-auto flex items-center gap-base">
            <button type="button" onClick={clearSelection} className="text-label-sm text-on-surface-variant hover:text-on-surface">
              Clear
            </button>
            <button
              type="button"
              onClick={() => setComposeOpen(true)}
              className="inline-flex items-center gap-xs h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                mail
              </span>
              Send email
            </button>
          </div>
        </div>
      )}

      {composeOpen && (
        <BulkEmailModal
          leadIds={Array.from(selected)}
          truncated={matchedAll?.truncated ?? false}
          emailConfigured={access.emailConfigured}
          onClose={() => setComposeOpen(false)}
          onDone={() => {
            setComposeOpen(false);
            clearSelection();
            router.refresh();
          }}
        />
      )}

      {/* Table */}
      <div className="relative bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-1 before:z-20 before:bg-gradient-to-r before:from-indigo-400 before:via-primary before:to-emerald-400">
        <div className="overflow-auto scrollbar-thin max-h-[calc(100vh-240px)]">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container-low text-on-surface-variant sticky top-0 z-10 shadow-[0_1px_0_0_var(--lp-outline-variant)]">
              <tr>
                {bulk && (
                  <Th className="w-10">
                    <Checkbox
                      checked={allPageSelected}
                      indeterminate={somePageSelected && !allPageSelected}
                      disabled={pageEmailableIds.length === 0}
                      onChange={togglePage}
                      title="Select all emailable on this page"
                    />
                  </Th>
                )}
                {orderedColumns.map((col) => (
                  <th
                    key={col.id}
                    draggable
                    onDragStart={() => setDragCol(col.id)}
                    onDragEnd={() => setDragCol(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropCol(col.id)}
                    title="Drag to reorder"
                    className={
                      "px-md py-sm text-label-sm uppercase tracking-wider text-left whitespace-nowrap cursor-move select-none hover:bg-surface-container transition " +
                      (dragCol === col.id ? "opacity-40" : "")
                    }
                  >
                    <span className="inline-flex items-center gap-xs">
                      <span className="material-symbols-outlined opacity-40" style={{ fontSize: 14 }}>
                        drag_indicator
                      </span>
                      {col.label}
                    </span>
                  </th>
                ))}
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={(bulk ? 1 : 0) + orderedColumns.length + 1} className="px-md py-lg text-center text-on-surface-variant">
                    No leads match this filter.
                  </td>
                </tr>
              ) : (
                leads.map((lead) => {
                  const canEdit = access.isAdmin || (access.isBde && lead.assignedTo?.id === access.userId);
                  return (
                    <tr key={lead.id} className={"border-t border-outline-variant/60 hover:bg-surface-container-low" + (bulk && selected.has(lead.id) ? " bg-primary/5" : "")}>
                      {bulk && (
                        <Td>
                          <Checkbox
                            checked={selected.has(lead.id)}
                            disabled={!lead.email}
                            onChange={() => toggleOne(lead.id)}
                            title={lead.email ? "Select" : "No email address"}
                          />
                        </Td>
                      )}
                      {orderedColumns.map((col) => (
                        <Td key={col.id} className={col.className}>
                          {col.render(lead, canEdit)}
                        </Td>
                      ))}
                      <Td>
                        <div className="flex items-center justify-end gap-xs">
                          <CommLink
                            href={lead.email ? `mailto:${lead.email}` : undefined}
                            icon="mail"
                            title="Email"
                            onClick={canEdit && lead.email ? () => logQuickComm(lead.id, "email") : undefined}
                          />
                          <CommLink
                            href={lead.phoneE164 ? waLink(lead.phoneE164) : undefined}
                            icon="chat"
                            title="WhatsApp"
                            external
                            onClick={canEdit && lead.phoneE164 ? () => logQuickComm(lead.id, "whatsapp") : undefined}
                          />
                          <CommLink href={lead.phone ? `tel:${lead.phone}` : undefined} icon="call" title="Call" />
                          <Link
                            href={`/crm/leads/${lead.id}`}
                            className="inline-flex p-xs text-on-surface-variant hover:text-accent transition"
                            title="Open"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                              open_in_new
                            </span>
                          </Link>
                        </div>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-label-sm text-on-surface-variant">
        <span>
          {total === 0 ? "No leads" : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
        </span>
        <div className="flex items-center gap-base">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => update({ page: String(page - 1) }, true)}
            className="h-8 px-md rounded-lg border border-outline-variant disabled:opacity-40 hover:bg-surface-container-low transition"
          >
            Prev
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => update({ page: String(page + 1) }, true)}
            className="h-8 px-md rounded-lg border border-outline-variant disabled:opacity-40 hover:bg-surface-container-low transition"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function CommLink({
  href,
  icon,
  title,
  external,
  onClick,
}: {
  href?: string;
  icon: string;
  title: string;
  external?: boolean;
  onClick?: () => void;
}) {
  if (!href) {
    return (
      <span className="inline-flex p-xs text-on-surface-variant/30" title={`${title} (no contact)`}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          {icon}
        </span>
      </span>
    );
  }
  // Each channel keeps its familiar hue on hover (mail = blue, WhatsApp =
  // green, call = indigo) so the action column reads at a glance.
  const hoverColor =
    icon === "chat"
      ? "hover:text-emerald-600"
      : icon === "mail"
        ? "hover:text-blue-600"
        : "hover:text-indigo-600";
  return (
    <a
      href={href}
      title={title}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      onClick={onClick}
      className={"inline-flex p-xs text-on-surface-variant transition " + hoverColor}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
        {icon}
      </span>
    </a>
  );
}

function AssignSelect({ lead, bdes }: { lead: LeadRow; bdes: BdeOpt[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onChange(value: string) {
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
    <select
      disabled={busy}
      value={lead.assignedTo?.id ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm focus:border-primary outline-none disabled:opacity-50"
    >
      <option value="">Unassigned</option>
      {bdes.map((b) => (
        <option key={b.userId} value={b.userId}>
          {b.displayName}
        </option>
      ))}
    </select>
  );
}

// ── Bulk email ──────────────────────────────────────────────────────────────
function Checkbox({
  checked,
  indeterminate,
  disabled,
  onChange,
  title,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: () => void;
  title?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      title={title}
      className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-2 focus:ring-primary/40 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed align-middle"
    />
  );
}

const BULK_TEMPLATES: { id: string; label: string; subject: string; body: string }[] = [
  { id: "blank", label: "Blank", subject: "", body: "" },
  {
    id: "intro",
    label: "Introduction",
    subject: "DESMA — {service}",
    body: "Hi {first_name},\n\nThank you for your interest in {service}. I'm {consultant} from DESMA and I'll be happy to help you with the next steps.\n\nWarm regards,\n{consultant}\nDESMA",
  },
  {
    id: "followup",
    label: "Follow up",
    subject: "Following up — {service}",
    body: "Hi {first_name},\n\nJust following up on your interest in {service}. Do let me know a good time to connect.\n\n{consultant}\nDESMA",
  },
];

const SAMPLE_VARS: Record<string, string> = {
  name: "Priya Menon",
  first_name: "Priya",
  service: "AHPRA Direct",
  consultant: "Your name",
  campaign: "Meta — RN Australia",
  qualification: "BSN",
};

type BulkProgress = { done: number; sent: number; failed: number; skippedNoEmail: number; skippedCap: number; capReached: boolean };

const ZERO_PROGRESS: BulkProgress = { done: 0, sent: 0, failed: 0, skippedNoEmail: 0, skippedCap: 0, capReached: false };

function BulkEmailModal({
  leadIds,
  truncated,
  emailConfigured,
  onClose,
  onDone,
}: {
  leadIds: string[];
  truncated: boolean;
  emailConfigured: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [tpl, setTpl] = useState("blank");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [progress, setProgress] = useState<BulkProgress>(ZERO_PROGRESS);
  const [cursor, setCursor] = useState(0); // next leadIds index to attempt (enables Retry remaining)
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function applyTemplate(id: string) {
    setTpl(id);
    const t = BULK_TEMPLATES.find((x) => x.id === id);
    if (t) {
      setSubject(t.subject);
      setBody(t.body);
    }
  }

  // Send leadIds[startIdx..] in chunks, accumulating onto `base`. On any chunk
  // failure it stops at that index (so "Retry remaining" can resume) and never
  // shows a false success.
  async function runFrom(startIdx: number, base: BulkProgress) {
    setError(null);
    setStatus("sending");
    const agg: BulkProgress = { ...base };
    const CHUNK = 50; // must stay ≤ MAX_PER_REQUEST on the server
    let i = startIdx;
    for (; i < leadIds.length; i += CHUNK) {
      const chunk = leadIds.slice(i, i + CHUNK);
      let res: Response | null = null;
      try {
        res = await fetch("/api/crm/leads/bulk-email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leadIds: chunk, subject, body }),
        });
      } catch {
        res = null; // network error
      }
      if (!res || !res.ok) {
        const d = res ? ((await res.json().catch(() => ({}))) as { message?: string; error?: string }) : {};
        setError(
          (d.message || d.error || "Sending was interrupted.") +
            " Some emails in this batch may already have been sent — they're logged on the leads' timelines, so review before retrying to avoid duplicates.",
        );
        setProgress({ ...agg });
        setCursor(i); // resume here
        setStatus("error");
        return;
      }
      const d = (await res.json()) as { sent: number; failed: number; skippedNoEmail: number; skippedCap: number; capReached: boolean; rateLimited: boolean; remaining: number };
      agg.done += chunk.length;
      agg.sent += d.sent;
      agg.failed += d.failed;
      agg.skippedNoEmail += d.skippedNoEmail;
      agg.skippedCap += d.skippedCap;
      agg.capReached = agg.capReached || d.capReached;
      setProgress({ ...agg });
      // remaining<=0 → daily cap or a throttle was hit; stop sending further chunks.
      if (d.remaining <= 0) {
        agg.capReached = agg.capReached || agg.done < leadIds.length;
        setProgress({ ...agg });
        break;
      }
    }
    setCursor(leadIds.length);
    setStatus("done");
  }

  function start() {
    if (!subject.trim() || !body.trim()) {
      setError("Both a subject and a message are required.");
      return;
    }
    setProgress(ZERO_PROGRESS);
    void runFrom(0, ZERO_PROGRESS);
  }

  if (!mounted) return null;
  const total = leadIds.length;
  const pct = total === 0 ? 0 : Math.round((progress.done / total) * 100);
  const terminal = status === "done" || status === "error";

  return createPortal(
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md" onClick={() => (status === "idle" ? onClose() : terminal ? onDone() : undefined)}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-h3 text-on-surface">Send email to {total.toLocaleString()} lead{total === 1 ? "" : "s"}</h3>
          <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 24 }}>
            mail
          </span>
        </div>

        {!emailConfigured && (
          <div className="rounded-lg bg-amber-50 text-amber-800 border border-amber-200 px-md py-sm text-label-sm">
            No email sender is configured. Ask an admin to set it up in <span className="font-semibold">CRM → Settings → Integrations → Email sender</span> before sending.
          </div>
        )}

        {status === "idle" && (
          <>
            <p className="text-label-sm text-on-surface-variant">
              Each lead receives its own individual email (no shared To/CC). A copy lands in the team mailbox&apos;s Sent
              folder and on each lead&apos;s timeline.
            </p>
            {truncated && (
              <div className="rounded-lg bg-amber-50 text-amber-800 border border-amber-200 px-md py-sm text-label-sm">
                More than 5,000 leads match this filter; only the first 5,000 are selected. Narrow the filter to reach the rest.
              </div>
            )}

            <Field label="Template">
              <select className={inputCls} value={tpl} onChange={(e) => applyTemplate(e.target.value)}>
                {BULK_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Subject">
              <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line…" />
            </Field>

            <Field label="Message">
              <textarea
                className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest outline-none focus:border-primary text-body-md resize-y"
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message…"
              />
            </Field>

            <div className="text-label-sm text-on-surface-variant">
              Merge fields:{" "}
              {BULK_EMAIL_MERGE_FIELDS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setBody((b) => `${b}{${f}}`)}
                  className="inline-block mr-xs mb-xs px-xs py-[1px] rounded bg-surface-container-high font-mono text-[11px] hover:bg-surface-container-highest"
                  title={`Insert {${f}}`}
                >
                  {`{${f}}`}
                </button>
              ))}
            </div>

            <button type="button" onClick={() => setShowPreview((v) => !v)} className="text-label-sm text-primary hover:underline">
              {showPreview ? "Hide" : "Show"} preview (sample data)
            </button>
            {showPreview && (
              <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md space-y-xs">
                <div className="text-label-sm font-semibold text-on-surface">{fillTemplate(subject, SAMPLE_VARS) || "(no subject)"}</div>
                <div className="text-body-md text-on-surface whitespace-pre-wrap">{fillTemplate(body, SAMPLE_VARS) || "(empty)"}</div>
              </div>
            )}

            {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-label-sm">{error}</div>}

            <div className="flex justify-end gap-base pt-xs">
              <button type="button" className={secondaryBtn} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className={primaryBtn} disabled={!emailConfigured || !subject.trim() || !body.trim()} onClick={start}>
                Send to {total.toLocaleString()}
              </button>
            </div>
          </>
        )}

        {status === "sending" && (
          <div className="space-y-sm py-md">
            <p className="text-body-md text-on-surface">
              Sending… {progress.done.toLocaleString()} / {total.toLocaleString()}
            </p>
            <div className="h-2 w-full rounded-full bg-surface-container-high overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-label-sm text-on-surface-variant">
              {progress.sent.toLocaleString()} sent{progress.failed ? `, ${progress.failed} failed` : ""}. Please keep this window open.
            </p>
          </div>
        )}

        {status === "done" && (
          <div className="space-y-md py-sm">
            <div className="flex items-center gap-sm">
              <span className="material-symbols-outlined text-green-600" style={{ fontSize: 28 }}>
                check_circle
              </span>
              <div>
                <p className="text-body-md font-semibold text-on-surface">{progress.sent.toLocaleString()} email{progress.sent === 1 ? "" : "s"} sent</p>
                <p className="text-label-sm text-on-surface-variant">
                  {progress.failed > 0 && `${progress.failed} failed · `}
                  {progress.skippedNoEmail > 0 && `${progress.skippedNoEmail} had no email · `}
                  {progress.skippedCap > 0 && `${progress.skippedCap} skipped (daily limit) · `}
                  logged on each lead&apos;s timeline.
                </p>
              </div>
            </div>
            {progress.capReached && (
              <div className="rounded-lg bg-amber-50 text-amber-800 border border-amber-200 px-md py-sm text-label-sm">
                The daily send limit (or a Gmail throttle) was reached, so some leads weren&apos;t emailed. Try the rest later.
              </div>
            )}
            <div className="flex justify-end">
              <button type="button" className={primaryBtn} onClick={onDone}>
                Done
              </button>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-md py-sm">
            <div className="flex items-start gap-sm">
              <span className="material-symbols-outlined text-error" style={{ fontSize: 28 }}>
                error
              </span>
              <div>
                <p className="text-body-md font-semibold text-on-surface">Sending stopped</p>
                <p className="text-label-sm text-on-surface-variant">
                  {progress.sent.toLocaleString()} of {total.toLocaleString()} sent so far
                  {progress.failed > 0 ? ` · ${progress.failed} failed` : ""}. {total - cursor} not yet attempted.
                </p>
              </div>
            </div>
            {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-label-sm">{error}</div>}
            <div className="flex justify-end gap-base">
              <button type="button" className={secondaryBtn} onClick={onDone}>
                Close
              </button>
              <button type="button" className={primaryBtn} onClick={() => void runFrom(cursor, progress)}>
                Retry remaining ({(total - cursor).toLocaleString()})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
