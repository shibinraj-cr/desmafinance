"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { LeadRow } from "@/lib/crm-leads";
import { DEFAULT_STATUS_COLOR } from "@/lib/crm";

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
};
export type LeadsAccess = {
  canCreate: boolean;
  canAssign: boolean;
  canBulkImport: boolean;
  isAdmin: boolean;
  isBde: boolean;
  userId: string;
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
    sourceId: "",
    serviceId: "",
    qualificationId: "",
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
        sourceId: form.sourceId || undefined,
        serviceId: form.serviceId || undefined,
        qualificationId: form.qualificationId || undefined,
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
      sourceId: "",
      serviceId: "",
      qualificationId: "",
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
                    {masters.statuses.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
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
  { value: "name_asc", label: "Name A–Z" },
];

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

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const anyFilter =
    !!search.get("status") ||
    !!search.get("source") ||
    !!search.get("service") ||
    !!search.get("assignee") ||
    !!search.get("campaign") ||
    !!search.get("q");

  return (
    <div className="space-y-md">
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

        <select className={selectClass} value={search.get("assignee") ?? ""} onChange={(e) => update({ assignee: e.target.value || null })}>
          <option value="">All consultants</option>
          <option value="unassigned">Unassigned</option>
          {masters.bdes.map((b) => (
            <option key={b.userId} value={b.userId}>
              {b.displayName}
            </option>
          ))}
        </select>

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
            onClick={() => update({ status: null, source: null, service: null, assignee: null, campaign: null, q: null })}
            className="h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-auto scrollbar-thin max-h-[calc(100vh-240px)]">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container-low text-on-surface-variant sticky top-0 z-10 shadow-[0_1px_0_0_var(--lp-outline-variant)]">
              <tr>
                <Th className="text-left">Created</Th>
                <Th className="text-left">Source</Th>
                <Th className="text-left">Campaign</Th>
                <Th className="text-left">Status</Th>
                <Th className="text-left">Candidate</Th>
                <Th className="text-left">Email</Th>
                <Th className="text-left">Phone</Th>
                <Th className="text-left">Service</Th>
                <Th className="text-left">Qualification</Th>
                <Th className="text-left">Consultant</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-md py-lg text-center text-on-surface-variant">
                    No leads match this filter.
                  </td>
                </tr>
              ) : (
                leads.map((lead) => {
                  const canEdit = access.isAdmin || (access.isBde && lead.assignedTo?.id === access.userId);
                  return (
                    <tr key={lead.id} className="border-t border-outline-variant/60 hover:bg-surface-container-low">
                      <Td className="whitespace-nowrap font-mono tabular-nums text-on-surface-variant">
                        {fmtDateTime(lead.createdAt)}
                      </Td>
                      <Td className="whitespace-nowrap">{lead.source?.label ?? "—"}</Td>
                      <Td className="whitespace-nowrap text-on-surface-variant">
                        {lead.campaign ? (
                          <button
                            type="button"
                            onClick={() => update({ campaign: lead.campaign })}
                            className="hover:text-primary hover:underline"
                            title={`Filter by ${lead.campaign}`}
                          >
                            {lead.campaign}
                          </button>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>
                        <StatusPill status={lead.status} />
                      </Td>
                      <Td className="whitespace-nowrap font-semibold">
                        <Link href={`/crm/leads/${lead.id}`} className="text-on-surface hover:text-primary hover:underline">
                          {lead.candidateName}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap text-on-surface-variant">{lead.email ?? "—"}</Td>
                      <Td className="whitespace-nowrap text-on-surface-variant">{lead.phone ?? "—"}</Td>
                      <Td className="whitespace-nowrap">{lead.service?.name ?? "—"}</Td>
                      <Td className="whitespace-nowrap">{lead.qualification?.label ?? "—"}</Td>
                      <Td className="whitespace-nowrap">
                        {access.canAssign ? (
                          <AssignSelect lead={lead} bdes={masters.bdes} />
                        ) : (
                          <span className="inline-flex items-center gap-xs">
                            {lead.assignedTo?.name ?? <span className="text-on-surface-variant">Unassigned</span>}
                            {!canEdit && access.isBde && (
                              <span
                                className="material-symbols-outlined text-on-surface-variant"
                                style={{ fontSize: 14 }}
                                title={lead.assignedTo ? `Assigned to ${lead.assignedTo.name}` : "Unassigned"}
                              >
                                lock
                              </span>
                            )}
                          </span>
                        )}
                      </Td>
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
  return (
    <a
      href={href}
      title={title}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      onClick={onClick}
      className="inline-flex p-xs text-on-surface-variant hover:text-accent transition"
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
