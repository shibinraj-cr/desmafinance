"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { IntegrationsCard } from "./integrations";
import { WabisWebhookCard } from "./wabis-webhook";
import { RemarketingSettingsCard } from "./remarketing";
import { WhatsAppModuleCard } from "./whatsapp-module";
import { EmailSenderCard } from "./email-sender";

type StatusRow = {
  id: string;
  code: string;
  label: string;
  kind: string;
  displayOrder: number;
  color: string | null;
  isDefault: boolean;
  parked: boolean;
  active: boolean;
  leadCount: number;
};
type QualRow = { id: string; label: string; displayOrder: number; active: boolean; leadCount: number };
type SubStatusRow = {
  id: string;
  code: string;
  label: string;
  group: string;
  displayOrder: number;
  color: string | null;
  isDefault: boolean;
  active: boolean;
  leadCount: number;
};

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
const subStatusErrors: Record<string, string> = {
  label_taken: "A status with that label already exists.",
  validation_error: "Please check the fields.",
  not_found: "Status no longer exists.",
  in_use: "Status is used by leads — deactivate instead.",
  is_default: "This is the status new leads start in — make another the default first.",
  default_required: "Every new lead has to start somewhere — promote another status instead.",
};
const qualErrors: Record<string, string> = {
  label_taken: "A qualification with that label already exists.",
  validation_error: "Please check the fields.",
  not_found: "Qualification no longer exists.",
  in_use: "Qualification is used by leads — deactivate instead.",
};

type TabKey = "statuses" | "sub_statuses" | "qualifications" | "capture" | "whatsapp" | "wa_module" | "remarketing" | "email";

// One tab per settings section. `group` is a soft caption shown above the active
// panel so the old "Reference data / Integrations" split isn't lost.
const TABS: { key: TabKey; label: string; icon: string; group: string }[] = [
  // "Stages", not "Statuses": the pipeline positions. The word "Status" now
  // belongs to the cross-stage field on the next tab, and two things called
  // Status would be one too many.
  { key: "statuses", label: "Stages", icon: "flag", group: "Reference data" },
  { key: "sub_statuses", label: "Statuses", icon: "label", group: "Reference data" },
  { key: "qualifications", label: "Qualifications", icon: "school", group: "Reference data" },
  { key: "capture", label: "Lead Capture", icon: "sync_alt", group: "Integrations" },
  { key: "whatsapp", label: "Wabis", icon: "forum", group: "Integrations" },
  { key: "wa_module", label: "WhatsApp Inbox", icon: "chat", group: "Integrations" },
  { key: "remarketing", label: "Re-marketing", icon: "campaign", group: "Integrations" },
  { key: "email", label: "Email Sender", icon: "forward_to_inbox", group: "Integrations" },
];

const TAB_KEYS = new Set<string>(TABS.map((t) => t.key));

export function SettingsClient({
  statuses,
  subStatuses,
  qualifications,
}: {
  statuses: StatusRow[];
  subStatuses: SubStatusRow[];
  qualifications: QualRow[];
}) {
  const [tab, setTab] = useState<TabKey>("statuses");

  // Deep-link / restore the active tab via the URL hash (e.g. #email), so a
  // refresh or shared link lands on the same section.
  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (TAB_KEYS.has(fromHash)) setTab(fromHash as TabKey);
  }, []);

  function select(next: TabKey) {
    setTab(next);
    if (typeof history !== "undefined") history.replaceState(null, "", `#${next}`);
  }

  const activeGroup = TABS.find((t) => t.key === tab)?.group;

  return (
    <div className="space-y-lg">
      <div className="overflow-x-auto border-b border-outline-variant">
        <div role="tablist" className="flex items-center gap-xs min-w-max">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => select(t.key)}
                className={
                  "inline-flex items-center gap-xs h-11 px-md -mb-px border-b-2 text-label-md font-semibold whitespace-nowrap transition " +
                  (active
                    ? "border-primary text-primary"
                    : "border-transparent text-on-surface-variant hover:text-on-surface hover:border-outline-variant")
                }
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  {t.icon}
                </span>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-md">
        {activeGroup && (
          <div className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">{activeGroup}</div>
        )}
        {tab === "statuses" && <StatusEditor statuses={statuses} />}
        {tab === "sub_statuses" && <SubStatusEditor subStatuses={subStatuses} />}
        {tab === "qualifications" && <QualificationEditor qualifications={qualifications} />}
        {tab === "capture" && <IntegrationsCard />}
        {tab === "whatsapp" && <WabisWebhookCard />}
        {tab === "wa_module" && <WhatsAppModuleCard />}
        {tab === "remarketing" && <RemarketingSettingsCard />}
        {tab === "email" && <EmailSenderCard />}
      </div>
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
          <p className="text-label-sm text-on-surface-variant">
            Pipeline stages &amp; dispositions shown on the stage bar. A <span className="font-semibold">parked</span> stage
            (centralised marketing / re-marketing) is nurtured centrally: its leads never appear on the Team Activity
            attention list — no SLA, stuck, abandoned or no-next-step flag — and completing their last task never forces a
            follow-up.
          </p>
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
              <Th className="text-left">Parked</Th>
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
          onClick={() => patch({ parked: !status.parked })}
          className={status.parked ? "text-accent" : "text-on-surface-variant hover:text-accent"}
          title={
            status.parked
              ? "Parked — no SLA / attention flags, no mandatory next-step task. Click to un-park."
              : "Click to park: no SLA / attention flags, no mandatory next-step task."
          }
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            {status.parked ? "local_parking" : "remove"}
          </span>
        </button>
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
  const [form, setForm] = useState({ code: "", label: "", kind: "active", displayOrder: 0, color: "", isDefault: false, parked: false });

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
    setForm({ code: "", label: "", kind: "active", displayOrder: 0, color: "", isDefault: false, parked: false });
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
              <label className="flex items-start gap-xs text-body-md">
                <input
                  type="checkbox"
                  className="mt-[3px]"
                  checked={form.parked}
                  onChange={(e) => setForm({ ...form, parked: e.target.checked })}
                />
                <span>
                  Parked stage
                  <span className="block text-label-sm text-on-surface-variant">
                    Nurtured centrally — no SLA or attention flags, and no mandatory next-step task.
                  </span>
                </span>
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


// ── Statuses (the cross-stage state) ────────────────────────────────────────
// Distinct from the Stages tab above: a lead has a STAGE (where it sits in the
// pipeline) and a STATUS (what is actually happening to it). The status filter
// on the leads list cuts across every stage, which is the whole point.
function SubStatusEditor({ subStatuses }: { subStatuses: SubStatusRow[] }) {
  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant">
        <div>
          <h3 className="text-h3 text-on-surface">Statuses</h3>
          <p className="text-label-sm text-on-surface-variant">
            What is happening to a candidate right now — independent of their stage. The{" "}
            <span className="font-semibold">group</span> only sets the heading it appears under in the
            picker; the <span className="font-semibold">default</span> is what new leads start in.
          </p>
        </div>
        <NewSubStatusButton />
      </div>
      <div className="overflow-auto">
        <table className="w-full text-body-md">
          <thead className="bg-surface-container-low text-on-surface-variant">
            <tr>
              <Th className="text-left">Order</Th>
              <Th className="text-left">Label</Th>
              <Th className="text-left">Group</Th>
              <Th className="text-left">Default</Th>
              <Th className="text-left">Active</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {subStatuses.map((r) => (
              <SubStatusRowView key={r.id} row={r} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SubStatusRowView({ row }: { row: SubStatusRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ label: row.label, group: row.group, displayOrder: row.displayOrder });

  async function patch(body: Record<string, unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/sub-statuses/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(subStatusErrors[d.error ?? ""] ?? "Failed to save.");
      return;
    }
    after?.();
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete status "${row.label}"?`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/sub-statuses/${row.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(subStatusErrors[d.error ?? ""] ?? "Failed to delete.");
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
          row.displayOrder
        )}
      </Td>
      <Td>
        {editing ? (
          <input className={smInput + " w-full"} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        ) : (
          <span className="inline-flex items-center gap-xs">
            {row.color && (
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: row.color }} />
            )}
            {row.label}
          </span>
        )}
        {error && <div className="text-label-sm text-error mt-xs">{error}</div>}
      </Td>
      <Td className="text-on-surface-variant">
        {editing ? (
          <input className={smInput + " w-full"} value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value })} />
        ) : (
          row.group || "—"
        )}
      </Td>
      <Td>
        <button
          type="button"
          disabled={busy || row.isDefault}
          onClick={() => patch({ isDefault: true })}
          title={row.isDefault ? "New leads start here" : "Make this the status new leads start in"}
          className="text-on-surface-variant hover:text-accent disabled:opacity-100 disabled:text-primary"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            {row.isDefault ? "radio_button_checked" : "radio_button_unchecked"}
          </span>
        </button>
      </Td>
      <Td>
        <button
          type="button"
          disabled={busy}
          onClick={() => patch({ active: !row.active })}
          className="text-on-surface-variant hover:text-accent"
          title={row.active ? "Deactivate" : "Activate"}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            {row.active ? "toggle_on" : "toggle_off"}
          </span>
        </button>
      </Td>
      <Td className="text-right">
        {editing ? (
          <span className="inline-flex gap-xs">
            <button
              type="button"
              disabled={busy}
              onClick={() => patch({ label: draft.label, group: draft.group, displayOrder: draft.displayOrder }, () => setEditing(false))}
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
              disabled={busy || row.leadCount > 0 || row.isDefault}
              title={
                row.isDefault
                  ? "New leads start here — make another status the default first"
                  : row.leadCount > 0
                    ? `Used by ${row.leadCount} leads — deactivate instead`
                    : "Delete"
              }
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

function NewSubStatusButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", group: "", displayOrder: 0 });

  useEffect(() => setMounted(true), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch("/api/crm/sub-statuses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(subStatusErrors[d.error ?? ""] ?? "Failed to create.");
      return;
    }
    setForm({ label: "", group: "", displayOrder: 0 });
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
              className="w-full max-w-md bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
            >
              <h3 className="text-h3 text-on-surface">New status</h3>
              {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">{error}</div>}
              <Field label="Label">
                <input className={inputCls} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} autoFocus />
              </Field>
              <Field label="Group (heading in the picker)">
                <input
                  className={inputCls}
                  value={form.group}
                  placeholder="e.g. Waiting on candidate"
                  onChange={(e) => setForm({ ...form, group: e.target.value })}
                />
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
