"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Service = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isStudyAbroad: boolean;
  subItems: { id: string; name: string; categoryName: string }[];
  txCount: number;
};

const errorLabels: Record<string, string> = {
  name_taken: "A service with that name already exists.",
  validation_failed: "Check the values entered.",
  forbidden: "Only admins can do that.",
  not_found: "Service no longer exists.",
  in_use: "Service still has linked sub-items — unlink them first.",
};

export function ServicesEditor({ services }: { services: Service[] }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    return services.filter((s) =>
      search ? s.name.toLowerCase().includes(search.toLowerCase()) : true,
    );
  }, [services, search]);

  return (
    <div className="space-y-md">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search services…"
        className="h-9 w-full sm:w-72 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
      />
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container-low text-on-surface-variant">
              <tr className="text-left">
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Name</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">
                  Linked sub-items
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
                  <td colSpan={4} className="p-lg text-center text-on-surface-variant">
                    No services match. Click <strong>+ Add service</strong> to create one.
                  </td>
                </tr>
              )}
              {filtered.map((s) => (
                <ServiceRow key={s.id} service={s} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ServiceRow({ service }: { service: Service }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    name: service.name,
    description: service.description ?? "",
    isActive: service.isActive,
    isStudyAbroad: service.isStudyAbroad,
  });
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/master/services/${service.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
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
    await fetch(`/api/master/services/${service.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !service.isActive }),
    });
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete service "${service.name}"?`)) return;
    setBusy(true);
    const res = await fetch(`/api/master/services/${service.id}`, { method: "DELETE" });
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
          (service.isActive ? "" : "opacity-50")
        }
      >
        <td className="px-md py-sm align-top">
          {editing ? (
            <div className="space-y-xs">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full h-8 px-sm rounded border border-outline-variant bg-surface-container-lowest font-semibold"
              />
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Description (optional)"
                rows={2}
                className="w-full px-sm py-xs rounded border border-outline-variant bg-surface-container-lowest text-body-md"
              />
              <label className="flex items-center gap-xs text-body-md">
                <input
                  type="checkbox"
                  checked={draft.isStudyAbroad}
                  onChange={(e) => setDraft({ ...draft, isStudyAbroad: e.target.checked })}
                />
                Study-abroad service (shows the study-abroad WhatsApp button on its leads)
              </label>
            </div>
          ) : (
            <div>
              <div className="font-semibold text-on-surface flex items-center gap-xs">
                {service.name}
                {service.isStudyAbroad && (
                  <span className="px-xs py-[1px] rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">
                    STUDY ABROAD
                  </span>
                )}
              </div>
              {service.description && (
                <div className="text-caption text-on-surface-variant mt-xs">
                  {service.description}
                </div>
              )}
            </div>
          )}
        </td>
        <td className="px-md py-sm align-top">
          {service.subItems.length === 0 ? (
            <span className="text-caption text-on-surface-variant">— none —</span>
          ) : (
            <ul className="text-caption space-y-xs">
              {service.subItems.map((sub) => (
                <li key={sub.id} className="flex items-center gap-xs">
                  <span className="text-on-surface-variant">{sub.categoryName} ::</span>
                  <span className="text-on-surface font-medium">{sub.name}</span>
                </li>
              ))}
            </ul>
          )}
        </td>
        <td className="px-md py-sm text-right font-mono align-top">{service.txCount}</td>
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
                onClick={() => {
                  setEditing(false);
                  setDraft({
                    name: service.name,
                    description: service.description ?? "",
                    isActive: service.isActive,
                    isStudyAbroad: service.isStudyAbroad,
                  });
                  setError(null);
                }}
                className="h-8 px-md rounded border border-outline-variant text-on-surface-variant"
              >
                Cancel
              </button>
            </span>
          ) : (
            <span className="inline-flex items-center gap-xs">
              <button onClick={toggleActive} disabled={busy} className="text-on-surface-variant hover:text-accent p-xs">
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  {service.isActive ? "toggle_on" : "toggle_off"}
                </span>
              </button>
              <button onClick={() => setEditing(true)} className="text-on-surface-variant hover:text-accent p-xs">
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  edit
                </span>
              </button>
              <button
                onClick={remove}
                disabled={busy || service.subItems.length > 0}
                title={
                  service.subItems.length > 0
                    ? "Has linked sub-items — unlink first"
                    : "Delete"
                }
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
      {editing && error && (
        <tr>
          <td colSpan={4} className="px-md pb-sm">
            <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-body-md">
              {error}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function NewServiceButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });

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
    setBusy(true);
    const res = await fetch("/api/master/services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorLabels[data?.error as string] ?? "Failed.");
      return;
    }
    setOpen(false);
    setForm({ name: "", description: "" });
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
        Add service
      </button>
      {open &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md"
            onClick={() => !busy && setOpen(false)}
          >
            <form
              onSubmit={submit}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
            >
              <h3 className="text-h3 text-on-surface">New service</h3>
              <label className="block">
                <span className="block text-label-sm text-on-surface-variant mb-xs">Name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  autoFocus
                  className={inputCls}
                  placeholder="e.g. AHPRA OBA Pathway"
                />
              </label>
              <label className="block">
                <span className="block text-label-sm text-on-surface-variant mb-xs">
                  Description (optional)
                </span>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  className={inputCls + " py-sm"}
                />
              </label>
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
                  {busy ? "Creating…" : "Create service"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
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

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";
