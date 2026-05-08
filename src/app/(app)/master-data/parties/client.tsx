"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type PartyGroup = "Candidate" | "Vendor";
type TxTypes = "Revenue" | "Expense" | "Both";

type ServiceOption = { id: string; name: string };
export type SourceOption = { id: string; code: string; label: string; active: boolean };

type Party = {
  id: string;
  name: string;
  group: PartyGroup;
  txTypes: TxTypes;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  txCount: number;
  services: ServiceOption[];
  sourceId: string | null;
  sourceLabel: string | null;
};

const errorLabels: Record<string, string> = {
  name_taken: "A party with that name already exists.",
  validation_failed: "Check the values entered.",
  forbidden: "Only admins can do that.",
  not_found: "Party no longer exists.",
  in_use: "Party has transactions — set inactive instead of deleting.",
  service_required: "Candidates must be linked to at least one service.",
  service_not_found: "One of the selected services no longer exists.",
  source_required: "Candidates must have a Source.",
  source_not_found: "The selected Source no longer exists.",
};

const groupBadge = (g: PartyGroup) =>
  g === "Candidate"
    ? "bg-primary-fixed/40 text-accent border-primary-fixed-dim"
    : "bg-surface-container-high text-on-surface border-outline-variant";

const txBadge = (t: TxTypes) =>
  t === "Revenue"
    ? "bg-green-50 text-green-700 border-green-200"
    : t === "Expense"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-amber-50 text-amber-800 border-amber-200";

export function PartiesEditor({
  parties,
  services,
  sources,
  basePath = "/master-data/parties",
}: {
  parties: Party[];
  services: ServiceOption[];
  sources: SourceOption[];
  basePath?: string;
}) {
  const [filter, setFilter] = useState<"all" | "Candidate" | "Vendor">("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return parties.filter((p) => {
      if (filter !== "all" && p.group !== filter) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [parties, filter, search]);

  return (
    <div className="space-y-md">
      <div className="flex flex-wrap items-center gap-base">
        {(["all", "Candidate", "Vendor"] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setFilter(g)}
            className={
              "h-8 inline-flex items-center px-md rounded-full text-label-sm border transition " +
              (filter === g
                ? "bg-primary text-on-primary border-primary"
                : "bg-surface-container-lowest text-on-surface-variant border-outline-variant hover:bg-surface-container-low")
            }
          >
            {g === "all" ? "All" : g + "s"}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search parties…"
          className="ml-auto h-9 w-full sm:w-72 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
        />
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container-low text-on-surface-variant">
              <tr className="text-left">
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Name</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Group</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Tx Types</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">
                  Source
                </th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">
                  Services
                </th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">
                  Email / Phone
                </th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider text-right">
                  Txns
                </th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-lg text-center text-on-surface-variant">
                    No parties match. Click <strong>+ Add party</strong> to create one.
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <PartyRow
                  key={p.id}
                  party={p}
                  services={services}
                  sources={sources}
                  basePath={basePath}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PartyRow({
  party,
  services,
  sources,
  basePath,
}: {
  party: Party;
  services: ServiceOption[];
  sources: SourceOption[];
  basePath: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(party);
  const initialServiceIds = useMemo(
    () => new Set(party.services.map((s) => s.id)),
    [party.services],
  );
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(
    initialServiceIds,
  );
  const [draftSourceId, setDraftSourceId] = useState<string>(party.sourceId ?? "");
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraft(party);
    setSelectedServiceIds(new Set(party.services.map((s) => s.id)));
    setDraftSourceId(party.sourceId ?? "");
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(party);
    setSelectedServiceIds(new Set(party.services.map((s) => s.id)));
    setDraftSourceId(party.sourceId ?? "");
    setError(null);
  }

  async function save() {
    setError(null);
    if (draft.group === "Candidate" && selectedServiceIds.size === 0) {
      setError(errorLabels.service_required);
      return;
    }
    if (draft.group === "Candidate" && !draftSourceId) {
      setError(errorLabels.source_required);
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/master/parties/${party.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        group: draft.group,
        txTypes: draft.txTypes,
        email: draft.email ?? "",
        phone: draft.phone ?? "",
        notes: draft.notes ?? "",
        isActive: draft.isActive,
        ...(draft.group === "Candidate"
          ? {
              serviceIds: Array.from(selectedServiceIds),
              sourceId: draftSourceId,
            }
          : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorLabels[data?.error as string] ?? "Failed.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function toggleActive() {
    setBusy(true);
    await fetch(`/api/master/parties/${party.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !party.isActive }),
    });
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete party "${party.name}"?`)) return;
    setBusy(true);
    const res = await fetch(`/api/master/parties/${party.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(errorLabels[data?.error as string] ?? "Failed.");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <tr
        className={
          "border-t border-outline-variant/60 hover:bg-surface-container-low " +
          (party.isActive ? "" : "opacity-50")
        }
      >
        <td className="px-md py-sm font-semibold align-top">
          {editing ? (
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full h-8 px-sm rounded border border-outline-variant bg-surface-container-lowest"
            />
          ) : (
            <span className="truncate" title={party.name}>
              {party.name}
            </span>
          )}
        </td>
        <td className="px-md py-sm align-top">
          {editing ? (
            <select
              value={draft.group}
              onChange={(e) => setDraft({ ...draft, group: e.target.value as PartyGroup })}
              className="h-8 px-sm rounded border border-outline-variant bg-surface-container-lowest text-label-sm"
            >
              <option value="Candidate">Candidate</option>
              <option value="Vendor">Vendor</option>
            </select>
          ) : (
            <span
              className={`px-sm py-xs rounded-full border text-[11px] font-bold uppercase tracking-wider ${groupBadge(party.group)}`}
            >
              {party.group}
            </span>
          )}
        </td>
        <td className="px-md py-sm align-top">
          {editing ? (
            <select
              value={draft.txTypes}
              onChange={(e) => setDraft({ ...draft, txTypes: e.target.value as TxTypes })}
              className="h-8 px-sm rounded border border-outline-variant bg-surface-container-lowest text-label-sm"
            >
              <option value="Revenue">Revenue</option>
              <option value="Expense">Expense</option>
              <option value="Both">Both</option>
            </select>
          ) : (
            <span
              className={`px-sm py-xs rounded-full border text-[11px] font-bold uppercase tracking-wider ${txBadge(party.txTypes)}`}
            >
              {party.txTypes}
            </span>
          )}
        </td>
        <td className="px-md py-sm align-top">
          {party.group === "Vendor" ? (
            <span className="text-caption text-on-surface-variant">—</span>
          ) : editing && draft.group === "Candidate" ? (
            <select
              value={draftSourceId}
              onChange={(e) => setDraftSourceId(e.target.value)}
              className="h-8 px-sm rounded border border-outline-variant bg-surface-container-lowest text-label-sm w-full"
            >
              <option value="">— pick source —</option>
              {sources
                .filter((s) => s.active || s.id === party.sourceId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
            </select>
          ) : party.sourceLabel ? (
            <span className="px-sm py-[2px] rounded-full border border-outline-variant bg-surface-container-low text-[11px] font-semibold text-on-surface-variant">
              {party.sourceLabel}
            </span>
          ) : (
            <span className="text-caption text-on-surface-variant italic">none</span>
          )}
        </td>
        <td className="px-md py-sm align-top">
          {party.group === "Vendor" ? (
            <span className="text-caption text-on-surface-variant">—</span>
          ) : party.services.length === 0 ? (
            <span className="text-caption text-on-surface-variant italic">
              none — edit to assign
            </span>
          ) : (
            <div className="flex flex-wrap gap-xs max-w-[260px]">
              {party.services.map((s) => (
                <span
                  key={s.id}
                  className="px-sm py-[2px] rounded-full border border-primary-fixed-dim bg-primary-fixed/40 text-accent text-[11px] font-semibold"
                  title={s.name}
                >
                  {s.name}
                </span>
              ))}
            </div>
          )}
        </td>
        <td className="px-md py-sm text-on-surface-variant align-top">
          {editing ? (
            <div className="space-y-xs">
              <input
                placeholder="Email"
                type="email"
                value={draft.email ?? ""}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                className="w-full h-8 px-sm rounded border border-outline-variant bg-surface-container-lowest text-body-md"
              />
              <input
                placeholder="Phone"
                value={draft.phone ?? ""}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                className="w-full h-8 px-sm rounded border border-outline-variant bg-surface-container-lowest text-body-md"
              />
            </div>
          ) : (
            <span className="text-caption">
              {party.email ?? "—"}
              {party.phone ? <> · {party.phone}</> : null}
            </span>
          )}
        </td>
        <td className="px-md py-sm text-right font-mono align-top">{party.txCount}</td>
        <td className="px-md py-sm text-right align-top">
          {editing ? (
            <span className="inline-flex items-center gap-xs">
              <button
                onClick={save}
                disabled={busy}
                className="h-8 px-md rounded bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-60"
              >
                {busy ? "…" : "Save"}
              </button>
              <button
                onClick={cancelEdit}
                className="h-8 px-md rounded border border-outline-variant text-on-surface-variant"
              >
                Cancel
              </button>
            </span>
          ) : (
            <span className="inline-flex items-center gap-xs">
              <Link
                href={`${basePath}/${party.id}`}
                className="text-on-surface-variant hover:text-accent p-xs"
                title="Open profile"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  open_in_new
                </span>
              </Link>
              <button onClick={toggleActive} disabled={busy} className="text-on-surface-variant hover:text-accent p-xs">
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  {party.isActive ? "toggle_on" : "toggle_off"}
                </span>
              </button>
              <button
                onClick={startEdit}
                className="text-on-surface-variant hover:text-accent p-xs"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  edit
                </span>
              </button>
              <button
                onClick={remove}
                disabled={busy || party.txCount > 0}
                title={party.txCount > 0 ? "Has transactions — set inactive instead" : "Delete"}
                className="text-on-surface-variant hover:text-error p-xs disabled:opacity-30"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  delete
                </span>
              </button>
            </span>
          )}
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={8} className="px-md pb-md bg-surface-container-low/40">
            <div className="space-y-sm pt-sm">
              {draft.group === "Candidate" && (
                <ServicePicker
                  services={services}
                  selected={selectedServiceIds}
                  onChange={setSelectedServiceIds}
                />
              )}
              {draft.group === "Vendor" && party.services.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-md py-sm text-caption">
                  Switching to Vendor will remove the {party.services.length} linked
                  service{party.services.length === 1 ? "" : "s"} on save.
                </div>
              )}
              {error && (
                <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-body-md">
                  {error}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function NewPartyButton({
  services,
  sources,
}: {
  services: ServiceOption[];
  sources: SourceOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    group: "Candidate" as PartyGroup,
    txTypes: "Both" as TxTypes,
    email: "",
    phone: "",
    notes: "",
    sourceId: "",
  });
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function close() {
    setOpen(false);
    setForm({
      name: "",
      group: "Candidate",
      txTypes: "Both",
      email: "",
      phone: "",
      notes: "",
      sourceId: "",
    });
    setSelectedServiceIds(new Set());
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.group === "Candidate" && selectedServiceIds.size === 0) {
      setError(errorLabels.service_required);
      return;
    }
    if (form.group === "Candidate" && !form.sourceId) {
      setError(errorLabels.source_required);
      return;
    }
    setBusy(true);
    const res = await fetch("/api/master/parties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...form,
        ...(form.group === "Candidate"
          ? {
              serviceIds: Array.from(selectedServiceIds),
              sourceId: form.sourceId,
            }
          : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorLabels[data?.error as string] ?? "Failed.");
      return;
    }
    close();
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
        Add party
      </button>
      {open &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md"
            onClick={() => !busy && close()}
          >
            <form
              onSubmit={submit}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
            >
              <h3 className="text-h3 text-on-surface">New party</h3>
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  autoFocus
                  className={inputCls}
                />
              </Field>
              <div className="grid grid-cols-2 gap-md">
                <Field label="Group">
                  <select
                    value={form.group}
                    onChange={(e) => {
                      const next = e.target.value as PartyGroup;
                      setForm({ ...form, group: next });
                      if (next === "Vendor") setSelectedServiceIds(new Set());
                    }}
                    className={inputCls}
                  >
                    <option value="Candidate">Candidate</option>
                    <option value="Vendor">Vendor</option>
                  </select>
                </Field>
                <Field label="Transaction types">
                  <select
                    value={form.txTypes}
                    onChange={(e) => setForm({ ...form, txTypes: e.target.value as TxTypes })}
                    className={inputCls}
                  >
                    <option value="Revenue">Revenue</option>
                    <option value="Expense">Expense</option>
                    <option value="Both">Both</option>
                  </select>
                </Field>
              </div>
              {form.group === "Candidate" && (
                <Field label="Source (where the lead came from)">
                  <select
                    value={form.sourceId}
                    onChange={(e) => setForm({ ...form, sourceId: e.target.value })}
                    required
                    className={inputCls}
                  >
                    <option value="">— pick source —</option>
                    {sources
                      .filter((s) => s.active)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              {form.group === "Candidate" && (
                <ServicePicker
                  services={services}
                  selected={selectedServiceIds}
                  onChange={setSelectedServiceIds}
                />
              )}
              <Field label="Email (optional)">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Phone (optional)">
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Notes (optional)">
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className={inputCls + " py-sm"}
                />
              </Field>
              {error && (
                <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">
                  {error}
                </div>
              )}
              <div className="flex items-center gap-base pt-base">
                <button
                  type="submit"
                  disabled={busy}
                  className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60"
                >
                  {busy ? "Creating…" : "Create party"}
                </button>
                <button
                  type="button"
                  onClick={close}
                  disabled={busy}
                  className="h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}

function ServicePicker({
  services,
  selected,
  onChange,
}: {
  services: ServiceOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  if (services.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-outline-variant px-md py-sm text-caption text-on-surface-variant">
        No active services exist yet. Create one under Master Data → Services first.
      </div>
    );
  }

  return (
    <div className="space-y-xs">
      <div className="flex items-baseline justify-between">
        <span className="block text-label-sm text-on-surface-variant">
          Linked services <span className="text-error">*</span>
        </span>
        <span className="text-caption text-on-surface-variant">
          {selected.size} selected
        </span>
      </div>
      <div className="rounded-lg border border-outline-variant bg-surface-container-lowest max-h-56 overflow-y-auto p-xs">
        <ul className="space-y-[2px]">
          {services.map((svc) => {
            const checked = selected.has(svc.id);
            return (
              <li key={svc.id}>
                <label className="flex items-center gap-sm px-sm py-[6px] rounded cursor-pointer hover:bg-surface-container-low">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(svc.id)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="flex-1 text-body-md text-on-surface">{svc.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-caption text-on-surface-variant">
        Candidates must be linked to at least one service.
      </p>
    </div>
  );
}

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
    </label>
  );
}
