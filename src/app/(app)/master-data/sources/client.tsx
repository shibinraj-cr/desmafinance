"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Source = {
  id: string;
  code: string;
  label: string;
  displayOrder: number;
  active: boolean;
  partyCount: number;
};

const errorLabels: Record<string, string> = {
  code_taken: "A source with that code already exists.",
  validation_failed: "Code must be lowercase letters, digits, or underscore.",
  not_found: "Source no longer exists.",
  in_use: "Source is referenced by parties or Lead Pulse entries — deactivate instead.",
};

export function SourcesEditor({ sources }: { sources: Source[] }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-body-md">
          <thead className="bg-surface-container-low text-on-surface-variant">
            <tr className="text-left">
              <Th>Code</Th>
              <Th>Label</Th>
              <Th className="text-right">Order</Th>
              <Th className="text-right">Parties</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 && (
              <tr>
                <td colSpan={6} className="p-lg text-center text-on-surface-variant">
                  No sources yet. Click <strong>+ Add source</strong> to create one.
                </td>
              </tr>
            )}
            {sources.map((s) => (
              <SourceRow key={s.id} source={s} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourceRow({ source }: { source: Source }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    label: source.label,
    displayOrder: source.displayOrder,
  });

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/master/sources/${source.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorLabels[(data as { error?: string }).error ?? ""] ?? "Failed to save.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function toggleActive() {
    setBusy(true);
    const res = await fetch(`/api/master/sources/${source.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !source.active }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete source "${source.label}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/master/sources/${source.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorLabels[(data as { error?: string }).error ?? ""] ?? "Failed to delete.");
      return;
    }
    router.refresh();
  }

  return (
    <tr className="border-t border-outline-variant/60 hover:bg-surface-container-low">
      <td className="px-md py-sm font-mono text-label-sm">{source.code}</td>
      <td className="px-md py-sm">
        {editing ? (
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            className="h-8 px-sm rounded border border-outline-variant text-body-md w-full"
          />
        ) : (
          source.label
        )}
      </td>
      <td className="px-md py-sm text-right tabular-nums">
        {editing ? (
          <input
            type="number"
            min={0}
            value={draft.displayOrder}
            onChange={(e) => setDraft({ ...draft, displayOrder: Number(e.target.value) || 0 })}
            className="h-8 px-sm rounded border border-outline-variant text-right w-[70px]"
          />
        ) : (
          source.displayOrder
        )}
      </td>
      <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">
        {source.partyCount}
      </td>
      <td className="px-md py-sm">
        <span
          className={
            "px-xs py-[2px] rounded-full text-[11px] font-semibold " +
            (source.active
              ? "bg-green-50 text-green-700"
              : "bg-surface-container-high text-on-surface-variant")
          }
        >
          {source.active ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="px-md py-sm text-right whitespace-nowrap">
        {editing ? (
          <span className="inline-flex items-center gap-xs">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="h-7 px-sm rounded text-label-sm font-semibold bg-primary text-on-primary disabled:opacity-50"
            >
              {busy ? "…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft({ label: source.label, displayOrder: source.displayOrder });
              }}
              className="h-7 px-sm rounded border border-outline-variant text-label-sm text-on-surface-variant"
            >
              Cancel
            </button>
          </span>
        ) : (
          <span className="inline-flex items-center gap-xs">
            <button
              type="button"
              onClick={toggleActive}
              disabled={busy}
              title={source.active ? "Deactivate" : "Activate"}
              className="p-xs text-on-surface-variant hover:text-accent disabled:opacity-40"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                {source.active ? "toggle_on" : "toggle_off"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="p-xs text-on-surface-variant hover:text-accent"
              title="Edit"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                edit
              </span>
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy || source.partyCount > 0}
              className="p-xs text-on-surface-variant hover:text-red-600 disabled:opacity-30"
              title={source.partyCount > 0 ? "Has parties — deactivate instead" : "Delete"}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                delete
              </span>
            </button>
          </span>
        )}
        {error && (
          <div className="mt-xs text-label-sm text-red-600">{error}</div>
        )}
      </td>
    </tr>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={"px-md py-sm text-label-sm uppercase tracking-wider " + className}>
      {children}
    </th>
  );
}

export function NewSourceButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", label: "", displayOrder: 100 });

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
    const res = await fetch("/api/master/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorLabels[(data as { error?: string }).error ?? ""] ?? "Failed to create.");
      return;
    }
    setForm({ code: "", label: "", displayOrder: 100 });
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
        Add source
      </button>
      {mounted &&
        open &&
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
              <h3 className="text-h3 text-on-surface">New source</h3>
              <label className="block">
                <span className="block text-label-sm text-on-surface-variant mb-xs">
                  Code (lowercase, no spaces — e.g. linkedin, walk_in)
                </span>
                <input
                  value={form.code}
                  onChange={(e) =>
                    setForm({ ...form, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })
                  }
                  required
                  autoFocus
                  className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest font-mono"
                />
              </label>
              <label className="block">
                <span className="block text-label-sm text-on-surface-variant mb-xs">
                  Display label
                </span>
                <input
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  required
                  className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest"
                />
              </label>
              <label className="block">
                <span className="block text-label-sm text-on-surface-variant mb-xs">
                  Display order (lower = earlier)
                </span>
                <input
                  type="number"
                  min={0}
                  value={form.displayOrder}
                  onChange={(e) =>
                    setForm({ ...form, displayOrder: Number(e.target.value) || 0 })
                  }
                  className="w-[120px] h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest"
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
                  className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-60"
                >
                  {busy ? "Creating…" : "Create source"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant"
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
