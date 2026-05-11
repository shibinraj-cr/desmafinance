"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { AppPage } from "@/lib/pages";
import { MODULES, moduleForPath, type AppModule } from "@/lib/modules";

/**
 * Per-module tag style for the small badge that sits next to each page
 * label. Subtle tints — Finance gold, Marketing cyan, Master Data
 * amber, HR slate, System neutral.
 */
function moduleTagClass(moduleId: string): string {
  switch (moduleId) {
    case "finance":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "marketing":
      return "bg-cyan-50 text-cyan-800 border-cyan-200";
    case "master-data":
      return "bg-purple-50 text-purple-800 border-purple-200";
    case "hr":
      return "bg-slate-50 text-slate-700 border-slate-200";
    case "system":
    default:
      return "bg-surface-container-high text-on-surface-variant border-outline-variant";
  }
}

/**
 * Group all pages by their owning module so the role-access UI is
 * scannable. Pages whose href doesn't resolve to any module (rare)
 * land under the System module.
 */
function groupPagesByModule(
  pages: AppPage[],
): Array<{ module: AppModule; pages: AppPage[] }> {
  const buckets = new Map<string, { module: AppModule; pages: AppPage[] }>();
  // Preserve MODULES order
  for (const m of MODULES) buckets.set(m.id, { module: m, pages: [] });
  const systemMod =
    MODULES.find((m) => m.id === "system") ??
    MODULES[MODULES.length - 1]!;
  for (const p of pages) {
    const m = moduleForPath(p.href) ?? systemMod;
    const bucket = buckets.get(m.id);
    if (bucket) bucket.pages.push(p);
    else
      buckets.set(m.id, {
        module: m,
        pages: [p],
      });
  }
  return Array.from(buckets.values()).filter((g) => g.pages.length > 0);
}

/**
 * Per-module collapsible page-access section with quick-actions for
 * selecting / clearing an entire module's pages. Shared between the
 * existing-role edit panel and the new-role modal.
 */
function ModuleGroupedPageAccess({
  allPages,
  selected,
  onToggle,
  onSetMany,
  size = "md",
}: {
  allPages: AppPage[];
  selected: Set<string>;
  onToggle: (href: string) => void;
  onSetMany: (hrefs: string[], on: boolean) => void;
  size?: "sm" | "md";
}) {
  const groups = useMemo(() => groupPagesByModule(allPages), [allPages]);
  const gridCols =
    size === "sm"
      ? "grid-cols-1 sm:grid-cols-2"
      : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
  return (
    <div className="space-y-md">
      {groups.map(({ module: m, pages }) => {
        const moduleHrefs = pages.map((p) => p.href);
        const selectedInModule = moduleHrefs.filter((h) => selected.has(h)).length;
        const allChecked = selectedInModule === moduleHrefs.length;
        const noneChecked = selectedInModule === 0;
        return (
          <div
            key={m.id}
            className="rounded-lg border border-outline-variant bg-surface-container-low"
          >
            <div className="flex items-center gap-sm px-md py-sm border-b border-outline-variant/70">
              <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 18 }}>
                {m.icon}
              </span>
              <span className="text-label-sm font-bold uppercase tracking-wider text-on-surface">
                {m.name}
              </span>
              <span className="text-caption text-on-surface-variant ml-xs">
                {selectedInModule}/{moduleHrefs.length}
              </span>
              <div className="ml-auto inline-flex items-center gap-xs">
                <button
                  type="button"
                  onClick={() => onSetMany(moduleHrefs, true)}
                  disabled={allChecked}
                  className="h-7 px-sm rounded text-[11px] font-semibold border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container disabled:opacity-40"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => onSetMany(moduleHrefs, false)}
                  disabled={noneChecked}
                  className="h-7 px-sm rounded text-[11px] font-semibold border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className={`grid ${gridCols} gap-base p-md`}>
              {pages.map((p) => (
                <label
                  key={p.href}
                  className={
                    "flex items-center gap-sm px-md py-sm rounded-lg border cursor-pointer transition " +
                    (selected.has(p.href)
                      ? "bg-primary-fixed/40 border-primary-fixed-dim"
                      : "bg-surface-container-lowest border-outline-variant hover:bg-surface-container")
                  }
                >
                  <input
                    type="checkbox"
                    checked={selected.has(p.href)}
                    onChange={() => onToggle(p.href)}
                    className="w-4 h-4 accent-primary"
                  />
                  <span
                    className="material-symbols-outlined text-on-surface-variant"
                    style={{ fontSize: 18 }}
                  >
                    {p.icon}
                  </span>
                  <span className="text-body-md text-on-surface flex-1">{p.label}</span>
                  <span
                    className={
                      "text-[10px] uppercase tracking-wider font-semibold px-xs py-[1px] rounded border " +
                      moduleTagClass(m.id)
                    }
                  >
                    {m.name}
                  </span>
                  {p.adminOnly && (
                    <span className="text-[10px] uppercase tracking-widest text-accent font-bold">
                      Admin
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

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
    name: role.name,
    description: role.description ?? "",
    isAdmin: role.isAdmin,
    canApprove: role.canApprove,
    needsApproval: role.needsApproval,
    pages: new Set(role.pages),
  });

  const dirty =
    draft.name !== role.name ||
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
        name: draft.name.trim(),
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
        <div className="min-w-0 flex-1 space-y-xs">
          <div className="flex items-center gap-base flex-wrap">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Role name"
              className="text-h3 text-on-surface font-semibold bg-transparent border-b border-transparent hover:border-outline-variant focus:border-primary focus:outline-none transition w-full max-w-md"
            />
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
            className="w-full max-w-lg h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
          />
          <p className="text-caption text-on-surface-variant">
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
        <ModuleGroupedPageAccess
          allPages={allPages}
          selected={draft.pages}
          onToggle={toggle}
          onSetMany={(hrefs, on) => {
            setDraft((d) => {
              const next = new Set(d.pages);
              for (const h of hrefs) {
                if (on) next.add(h);
                else next.delete(h);
              }
              return { ...d, pages: next };
            });
          }}
        />
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
                name: role.name,
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
                <ModuleGroupedPageAccess
                  allPages={allPages}
                  selected={form.pages}
                  onToggle={toggle}
                  onSetMany={(hrefs, on) => {
                    setForm((f) => {
                      const next = new Set(f.pages);
                      for (const h of hrefs) {
                        if (on) next.add(h);
                        else next.delete(h);
                      }
                      return { ...f, pages: next };
                    });
                  }}
                  size="sm"
                />
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
