"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { AppPage } from "@/lib/pages";

type Role = {
  id: string;
  name: string;
  description: string | null;
  isAdmin: boolean;
  canApprove: boolean;
  needsApproval: boolean;
  pages: string[];
  isSystem: boolean;
  userCount: number;
};

const errorLabels: Record<string, string> = {
  name_taken: "A role with that name already exists.",
  validation_failed: "Check the values entered.",
  forbidden: "Only admins can do that.",
  not_found: "Role no longer exists.",
  system_role: "System roles cannot be deleted.",
  role_in_use: "Reassign the users of this role before deleting it.",
  cannot_demote_last_admin_role: "At least one admin role must remain admin while users are assigned to it.",
  role_not_found: "Role not found.",
};

export function RolesEditor({
  roles,
  allPages,
}: {
  roles: Role[];
  allPages: AppPage[];
}) {
  return (
    <div className="space-y-lg">
      {roles.map((r) => (
        <RoleCard key={r.id} role={r} allPages={allPages} />
      ))}
    </div>
  );
}

function RoleCard({ role, allPages }: { role: Role; allPages: AppPage[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    description: role.description ?? "",
    isAdmin: role.isAdmin,
    canApprove: role.canApprove,
    needsApproval: role.needsApproval,
    pages: new Set(role.pages),
  });

  const dirty =
    draft.description !== (role.description ?? "") ||
    draft.isAdmin !== role.isAdmin ||
    draft.canApprove !== role.canApprove ||
    draft.needsApproval !== role.needsApproval ||
    !sameSet(draft.pages, new Set(role.pages));

  function toggle(href: string) {
    setDraft((d) => {
      const next = new Set(d.pages);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return { ...d, pages: next };
    });
  }

  async function save() {
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/roles/${role.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: draft.description,
        isAdmin: draft.isAdmin,
        canApprove: draft.canApprove,
        needsApproval: draft.needsApproval,
        pages: Array.from(draft.pages),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorLabels[data?.error as string] ?? "Failed to save.");
      return;
    }
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/roles/${role.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(errorLabels[data?.error as string] ?? "Failed to delete.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg space-y-md">
      <div className="flex flex-wrap items-start gap-md">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-base">
            <h3 className="text-h3 text-on-surface">{role.name}</h3>
            {role.isSystem && (
              <span className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant border border-outline-variant rounded-full px-xs py-[1px]">
                System
              </span>
            )}
          </div>
          <input
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="Description (optional)…"
            className="mt-xs w-full max-w-lg h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
          />
          <p className="text-caption text-on-surface-variant mt-xs">
            {role.userCount} user{role.userCount === 1 ? "" : "s"} assigned
          </p>
        </div>
        {!role.isSystem && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="text-error hover:bg-error/10 transition px-md h-9 rounded-lg text-label-sm font-semibold disabled:opacity-40"
          >
            Delete role
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-base">
        <ToggleRow
          label="Admin"
          hint="Full access; manages users and roles."
          checked={draft.isAdmin}
          onChange={(v) => setDraft({ ...draft, isAdmin: v })}
        />
        <ToggleRow
          label="Can approve"
          hint="Approve / reject pending changes."
          checked={draft.canApprove}
          onChange={(v) => setDraft({ ...draft, canApprove: v })}
        />
        <ToggleRow
          label="Needs approval"
          hint="Their tx changes go to the approval queue."
          checked={draft.needsApproval}
          onChange={(v) => setDraft({ ...draft, needsApproval: v })}
        />
      </div>

      <div>
        <p className="text-label-sm font-bold uppercase tracking-wider text-on-surface-variant mb-sm">
          Page access
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-base">
          {allPages.map((p) => (
            <label
              key={p.href}
              className={
                "flex items-center gap-sm px-md py-sm rounded-lg border cursor-pointer transition " +
                (draft.pages.has(p.href)
                  ? "bg-primary-fixed/40 border-primary-fixed-dim"
                  : "bg-surface-container-low border-outline-variant hover:bg-surface-container")
              }
            >
              <input
                type="checkbox"
                checked={draft.pages.has(p.href)}
                onChange={() => toggle(p.href)}
                className="w-4 h-4 accent-primary"
              />
              <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 18 }}>
                {p.icon}
              </span>
              <span className="text-body-md text-on-surface flex-1">{p.label}</span>
              {p.adminOnly && (
                <span className="text-[10px] uppercase tracking-widest text-accent font-bold">
                  Admin
                </span>
              )}
            </label>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">
          {error}
        </div>
      )}

      <div className="flex items-center gap-base pt-base">
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
        {dirty && (
          <button
            type="button"
            onClick={() =>
              setDraft({
                description: role.description ?? "",
                isAdmin: role.isAdmin,
                canApprove: role.canApprove,
                needsApproval: role.needsApproval,
                pages: new Set(role.pages),
              })
            }
            disabled={busy}
            className="h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-sm cursor-pointer rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 mt-1 accent-primary"
      />
      <span>
        <span className="block text-body-md font-semibold text-on-surface">{label}</span>
        {hint && <span className="block text-caption text-on-surface-variant">{hint}</span>}
      </span>
    </label>
  );
}

export function NewRoleButton({
  allPages,
  defaultPages,
}: {
  allPages: AppPage[];
  defaultPages: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    isAdmin: false,
    canApprove: false,
    needsApproval: true,
    pages: new Set<string>(defaultPages.filter((p) => p !== "/users" && p !== "/roles")),
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function toggle(href: string) {
    setForm((f) => {
      const next = new Set(f.pages);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return { ...f, pages: next };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch("/api/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        description: form.description,
        isAdmin: form.isAdmin,
        canApprove: form.canApprove,
        needsApproval: form.needsApproval,
        pages: Array.from(form.pages),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorLabels[data?.error as string] ?? "Failed to create role.");
      return;
    }
    setOpen(false);
    setForm({
      name: "",
      description: "",
      isAdmin: false,
      canApprove: false,
      needsApproval: true,
      pages: new Set<string>(defaultPages.filter((p) => p !== "/users" && p !== "/roles")),
    });
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
        Add role
      </button>
      {open &&
        mounted &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md"
            onClick={() => !busy && setOpen(false)}
          >
            <form
              onSubmit={submit}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
            >
              <h3 className="text-h3 text-on-surface">New role</h3>
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputCls}
                  required
                  autoFocus
                  placeholder="e.g. Junior Executive"
                />
              </Field>
              <Field label="Description (optional)">
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-base">
                <ToggleRow
                  label="Admin"
                  checked={form.isAdmin}
                  onChange={(v) => setForm({ ...form, isAdmin: v })}
                />
                <ToggleRow
                  label="Can approve"
                  checked={form.canApprove}
                  onChange={(v) => setForm({ ...form, canApprove: v })}
                />
                <ToggleRow
                  label="Needs approval"
                  checked={form.needsApproval}
                  onChange={(v) => setForm({ ...form, needsApproval: v })}
                />
              </div>
              <div>
                <p className="text-label-sm font-bold uppercase tracking-wider text-on-surface-variant mb-sm">
                  Page access
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-base">
                  {allPages.map((p) => (
                    <label
                      key={p.href}
                      className={
                        "flex items-center gap-sm px-md py-sm rounded-lg border cursor-pointer transition " +
                        (form.pages.has(p.href)
                          ? "bg-primary-fixed/40 border-primary-fixed-dim"
                          : "bg-surface-container-low border-outline-variant hover:bg-surface-container")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={form.pages.has(p.href)}
                        onChange={() => toggle(p.href)}
                        className="w-4 h-4 accent-primary"
                      />
                      <span className="text-body-md flex-1">{p.label}</span>
                      {p.adminOnly && (
                        <span className="text-[10px] uppercase tracking-widest text-accent font-bold">
                          Admin
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
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
                  {busy ? "Creating…" : "Create role"}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
    </label>
  );
}

function sameSet(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
