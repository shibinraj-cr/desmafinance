"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { IntegrationsCard } from "./integrations";

type StatusRow = {
  id: string;
  code: string;
  label: string;
  kind: string;
  displayOrder: number;
  color: string | null;
  isDefault: boolean;
  active: boolean;
  leadCount: number;
};
type QualRow = { id: string; label: string; displayOrder: number; active: boolean; leadCount: number };

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";
const smInput = "h-8 px-sm rounded border border-outline-variant bg-surface-container-lowest outline-none focus:border-primary";
const primaryBtn = "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
const secondaryBtn = "h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition";

const KINDS = [
  { value: "active", label: "Active stage" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

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

const statusErrors: Record<string, string> = {
  code_taken: "A status with that code already exists.",
  validation_error: "Code must be lowercase letters, digits, or underscore.",
  not_found: "Status no longer exists.",
  in_use: "Status is used by leads — deactivate instead.",
};
const qualErrors: Record<string, string> = {
  label_taken: "A qualification with that label already exists.",
  validation_error: "Please check the fields.",
  not_found: "Qualification no longer exists.",
  in_use: "Qualification is used by leads — deactivate instead.",
};

export function SettingsClient({ statuses, qualifications }: { statuses: StatusRow[]; qualifications: QualRow[] }) {
  return (
    <div className="space-y-lg">
      <IntegrationsCard />
      <StatusEditor statuses={statuses} />
      <QualificationEditor qualifications={qualifications} />
    </div>
  );
}

// ── Statuses ─────────────────────────────────────────────────────────────────
function StatusEditor({ statuses }: { statuses: StatusRow[] }) {
  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant">
        <div>
          <h3 className="text-h3 text-on-surface">Lead statuses</h3>
          <p className="text-label-sm text-on-surface-variant">Pipeline stages & dispositions shown on the stage bar.</p>
        </div>
        <NewStatusButton />
      </div>
      <div className="overflow-auto">
        <table className="w-full text-body-md">
          <thead className="bg-surface-container-low text-on-surface-variant">
            <tr>
              <Th className="text-left">Order</Th>
              <Th className="text-left">Code</Th>
              <Th className="text-left">Label</Th>
              <Th className="text-left">Kind</Th>
              <Th className="text-left">Colour</Th>
              <Th className="text-left">Default</Th>
              <Th className="text-left">Active</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((s) => (
              <StatusRowView key={s.id} status={s} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusRowView({ status }: { status: StatusRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    label: status.label,
    kind: status.kind,
    displayOrder: status.displayOrder,
    color: status.color ?? "",
    isDefault: status.isDefault,
  });

  async function patch(body: Record<string, unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/statuses/${status.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(statusErrors[d.error ?? ""] ?? "Failed to save.");
      return;
    }
    after?.();
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete status "${status.label}"?`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/statuses/${status.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(statusErrors[d.error ?? ""] ?? "Failed to delete.");
      return;
    }
    router.refresh();
  }

  return (
    <tr className="border-t border-outline-variant/60">
      <Td>
        {editing ? (
          <input
            type="number"
            min={0}
            className={smInput + " w-[64px] text-right"}
            value={draft.displayOrder}
            onChange={(e) => setDraft({ ...draft, displayOrder: Number(e.target.value) || 0 })}
          />
        ) : (
          status.displayOrder
        )}
      </Td>
      <Td className="font-mono text-label-sm text-on-surface-variant">{status.code}</Td>
      <Td>
        {editing ? (
          <input className={smInput + " w-full"} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        ) : (
          status.label
        )}
        {error && <div className="text-label-sm text-error mt-xs">{error}</div>}
      </Td>
      <Td>
        {editing ? (
          <select className={smInput} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        ) : (
          KINDS.find((k) => k.value === status.kind)?.label ?? status.kind
        )}
      </Td>
      <Td>
        {editing ? (
          <input
            className={smInput + " w-[110px]"}
            placeholder="#16a34a"
            value={draft.color}
            onChange={(e) => setDraft({ ...draft, color: e.target.value })}
          />
        ) : status.color ? (
          <span className="inline-flex items-center gap-xs">
            <span className="h-4 w-4 rounded-full border border-outline-variant" style={{ backgroundColor: status.color }} />
            {status.color}
          </span>
        ) : (
          "—"
        )}
      </Td>
      <Td>
        {editing ? (
          <input type="checkbox" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />
        ) : status.isDefault ? (
          <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>
            check_circle
          </span>
        ) : (
          "—"
        )}
      </Td>
      <Td>
        <button
          type="button"
          disabled={busy}
          onClick={() => patch({ active: !status.active })}
          className="text-on-surface-variant hover:text-accent"
          title={status.active ? "Deactivate" : "Activate"}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            {status.active ? "toggle_on" : "toggle_off"}
          </span>
        </button>
      </Td>
      <Td className="text-right">
        {editing ? (
          <span className="inline-flex gap-xs">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                patch(
                  {
                    label: draft.label,
                    kind: draft.kind,
                    displayOrder: draft.displayOrder,
                    color: draft.color.trim() || null,
                    isDefault: draft.isDefault,
                  },
                  () => setEditing(false),
                )
              }
              className="text-primary hover:underline text-label-sm font-semibold"
            >
              Save
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)} className="text-on-surface-variant text-label-sm">
              Cancel
            </button>
          </span>
        ) : (
          <span className="inline-flex gap-xs">
            <button type="button" onClick={() => setEditing(true)} className="text-on-surface-variant hover:text-accent" title="Edit">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                edit
              </span>
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy || status.leadCount > 0}
              title={status.leadCount > 0 ? `Used by ${status.leadCount} leads — deactivate instead` : "Delete"}
              className="text-on-surface-variant hover:text-error disabled:opacity-40"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                delete
              </span>
            </button>
          </span>
        )}
      </Td>
    </tr>
  );
}

function NewStatusButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", label: "", kind: "active", displayOrder: 0, color: "", isDefault: false });

  useEffect(() => setMounted(true), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch("/api/crm/statuses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, color: form.color.trim() || null }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(statusErrors[d.error ?? ""] ?? "Failed to create.");
      return;
    }
    setForm({ code: "", label: "", kind: "active", displayOrder: 0, color: "", isDefault: false });
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
        New status
      </button>
      {open &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md" onClick={() => !busy && setOpen(false)}>
            <form
              onClick={(e) => e.stopPropagation()}
              onSubmit={submit}
              className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
            >
              <h3 className="text-h3 text-on-surface">New status</h3>
              {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">{error}</div>}
              <Field label="Code (slug)">
                <input
                  className={inputCls}
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                  placeholder="e.g. in_review"
                />
              </Field>
              <Field label="Label">
                <input className={inputCls} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-md">
                <Field label="Kind">
                  <select className={inputCls} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Display order">
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={form.displayOrder}
                    onChange={(e) => setForm({ ...form, displayOrder: Number(e.target.value) || 0 })}
                  />
                </Field>
              </div>
              <Field label="Colour (hex)">
                <input className={inputCls} value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="#3b82f6" />
              </Field>
              <label className="flex items-center gap-xs text-body-md">
                <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
                Make this the default status for new leads
              </label>
              <div className="flex justify-end gap-base">
                <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className={primaryBtn} disabled={busy}>
                  {busy ? "Saving…" : "Create"}
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}

// ── Qualifications ─────────────────────────────────────────────────────────
function QualificationEditor({ qualifications }: { qualifications: QualRow[] }) {
  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant">
        <div>
          <h3 className="text-h3 text-on-surface">Qualifications</h3>
          <p className="text-label-sm text-on-surface-variant">Education levels available on leads.</p>
        </div>
        <NewQualificationButton />
      </div>
      <div className="overflow-auto">
        <table className="w-full text-body-md">
          <thead className="bg-surface-container-low text-on-surface-variant">
            <tr>
              <Th className="text-left">Order</Th>
              <Th className="text-left">Label</Th>
              <Th className="text-left">Active</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {qualifications.map((q) => (
              <QualRowView key={q.id} qual={q} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function QualRowView({ qual }: { qual: QualRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ label: qual.label, displayOrder: qual.displayOrder });

  async function patch(body: Record<string, unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/qualifications/${qual.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(qualErrors[d.error ?? ""] ?? "Failed to save.");
      return;
    }
    after?.();
    router.refresh();
  }
  async function remove() {
    if (!confirm(`Delete qualification "${qual.label}"?`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/qualifications/${qual.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(qualErrors[d.error ?? ""] ?? "Failed to delete.");
      return;
    }
    router.refresh();
  }

  return (
    <tr className="border-t border-outline-variant/60">
      <Td>
        {editing ? (
          <input
            type="number"
            min={0}
            className={smInput + " w-[64px] text-right"}
            value={draft.displayOrder}
            onChange={(e) => setDraft({ ...draft, displayOrder: Number(e.target.value) || 0 })}
          />
        ) : (
          qual.displayOrder
        )}
      </Td>
      <Td>
        {editing ? (
          <input className={smInput + " w-full"} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        ) : (
          qual.label
        )}
        {error && <div className="text-label-sm text-error mt-xs">{error}</div>}
      </Td>
      <Td>
        <button
          type="button"
          disabled={busy}
          onClick={() => patch({ active: !qual.active })}
          className="text-on-surface-variant hover:text-accent"
          title={qual.active ? "Deactivate" : "Activate"}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            {qual.active ? "toggle_on" : "toggle_off"}
          </span>
        </button>
      </Td>
      <Td className="text-right">
        {editing ? (
          <span className="inline-flex gap-xs">
            <button
              type="button"
              disabled={busy}
              onClick={() => patch({ label: draft.label, displayOrder: draft.displayOrder }, () => setEditing(false))}
              className="text-primary hover:underline text-label-sm font-semibold"
            >
              Save
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)} className="text-on-surface-variant text-label-sm">
              Cancel
            </button>
          </span>
        ) : (
          <span className="inline-flex gap-xs">
            <button type="button" onClick={() => setEditing(true)} className="text-on-surface-variant hover:text-accent" title="Edit">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                edit
              </span>
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy || qual.leadCount > 0}
              title={qual.leadCount > 0 ? `Used by ${qual.leadCount} leads — deactivate instead` : "Delete"}
              className="text-on-surface-variant hover:text-error disabled:opacity-40"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                delete
              </span>
            </button>
          </span>
        )}
      </Td>
    </tr>
  );
}

function NewQualificationButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", displayOrder: 0 });

  useEffect(() => setMounted(true), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch("/api/crm/qualifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(qualErrors[d.error ?? ""] ?? "Failed to create.");
      return;
    }
    setForm({ label: "", displayOrder: 0 });
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
        New qualification
      </button>
      {open &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md" onClick={() => !busy && setOpen(false)}>
            <form
              onClick={(e) => e.stopPropagation()}
              onSubmit={submit}
              className="w-full max-w-md bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
            >
              <h3 className="text-h3 text-on-surface">New qualification</h3>
              {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">{error}</div>}
              <Field label="Label">
                <input className={inputCls} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} autoFocus />
              </Field>
              <Field label="Display order">
                <input
                  type="number"
                  min={0}
                  className={inputCls}
                  value={form.displayOrder}
                  onChange={(e) => setForm({ ...form, displayOrder: Number(e.target.value) || 0 })}
                />
              </Field>
              <div className="flex justify-end gap-base">
                <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className={primaryBtn} disabled={busy}>
                  {busy ? "Saving…" : "Create"}
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}
