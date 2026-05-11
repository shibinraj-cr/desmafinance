"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type CatType = "Revenue" | "Expense" | "Both";
type SubItem = {
  id: string;
  name: string;
  isActive: boolean;
  isSystem: boolean;
  serviceId: string | null;
  serviceName: string | null;
};
type Category = {
  id: string;
  name: string;
  type: CatType;
  isActive: boolean;
  isSystem: boolean;
  subItems: SubItem[];
  txCount: number;
};
type ServiceOption = { id: string; name: string };

const SERVICE_LINK_CATEGORIES = new Set([
  "Sales - Nursing Registrations",
  "Collection - Nursing Registrations",
  "Sales - Study Abroad",
  "Collection - Study Abroad",
]);

const errorLabels: Record<string, string> = {
  name_taken: "A category with that name and type already exists.",
  validation_failed: "Check the values entered.",
  forbidden: "Only admins can do that.",
  not_found: "Category no longer exists.",
  in_use: "There are transactions using this — set inactive instead of deleting.",
  category_not_found: "Parent category not found.",
};

const typeBadge = (t: CatType) => {
  if (t === "Revenue") return "bg-green-50 text-green-700 border-green-200";
  if (t === "Expense") return "bg-red-50 text-red-700 border-red-200";
  return "bg-primary-fixed/40 text-accent border-primary-fixed-dim";
};

export function CategoriesEditor({
  categories,
  services,
}: {
  categories: Category[];
  services: ServiceOption[];
}) {
  const [filter, setFilter] = useState<"Revenue" | "Expense">("Revenue");

  // 'Both' categories show under whichever side the user has toggled.
  const visible = categories.filter(
    (c) => c.type === filter || c.type === "Both",
  );
  const counts = {
    Revenue: categories.filter((c) => c.type === "Revenue" || c.type === "Both").length,
    Expense: categories.filter((c) => c.type === "Expense" || c.type === "Both").length,
  };

  return (
    <div className="space-y-lg">
      <div className="flex items-center gap-base">
        <div className="inline-flex rounded-lg border border-outline-variant overflow-hidden">
          {(["Revenue", "Expense"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilter(t)}
              className={
                "px-md h-9 text-label-sm font-semibold transition flex items-center gap-xs " +
                (filter === t
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              {t}
              <span
                className={
                  "text-[10px] font-bold rounded-full px-xs py-[1px] " +
                  (filter === t
                    ? "bg-on-primary/20 text-on-primary"
                    : "bg-surface-container text-on-surface-variant")
                }
              >
                {counts[t]}
              </span>
            </button>
          ))}
        </div>
        <p className="text-caption text-on-surface-variant">
          Showing {filter} categories. Categories tagged for both Revenue & Expense appear in either view.
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg text-center text-on-surface-variant">
          No categories yet. Click <strong>+ Add category</strong> to create one.
        </div>
      ) : (
        <div className="space-y-base">
          {visible.map((c) => (
            <CategoryCard key={c.id} category={c} services={services} />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryCard({
  category,
  services,
}: {
  category: Category;
  services: ServiceOption[];
}) {
  const showServiceLink = SERVICE_LINK_CATEGORIES.has(category.name);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: category.name,
    type: category.type,
    isActive: category.isActive,
  });
  const [newSubName, setNewSubName] = useState("");

  async function save() {
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/master/categories/${category.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorLabels[data?.error as string] ?? "Failed to save.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete category "${category.name}"? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/master/categories/${category.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(errorLabels[data?.error as string] ?? "Failed to delete.");
      return;
    }
    router.refresh();
  }

  async function toggleActive() {
    setBusy(true);
    const res = await fetch(`/api/master/categories/${category.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !category.isActive }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  async function addSubItem() {
    const name = newSubName.trim();
    if (!name) return;
    setBusy(true);
    const res = await fetch("/api/master/sub-categories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ categoryId: category.id, name }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(errorLabels[data?.error as string] ?? "Failed to add sub-category.");
      return;
    }
    setNewSubName("");
    router.refresh();
  }

  return (
    <div
      className={
        "bg-surface-container-lowest border rounded-xl shadow-sm p-md " +
        (category.isActive ? "border-outline-variant" : "border-outline-variant opacity-60")
      }
    >
      <div className="flex flex-wrap items-center gap-base">
        {editing ? (
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="text-h3 font-semibold bg-transparent border-b border-outline-variant focus:border-primary outline-none transition flex-1 min-w-0"
            autoFocus
          />
        ) : (
          <h4 className="text-h3 text-on-surface flex-1 min-w-0 truncate">{category.name}</h4>
        )}
        {editing ? (
          <select
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value as CatType })}
            className="h-8 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm"
          >
            <option value="Revenue">Revenue</option>
            <option value="Expense">Expense</option>
            <option value="Both">Both</option>
          </select>
        ) : (
          <span
            className={`px-sm py-xs rounded-full border text-[11px] font-bold uppercase tracking-wider ${typeBadge(category.type)}`}
          >
            {category.type}
          </span>
        )}
        <span className="text-caption text-on-surface-variant">
          {category.subItems.length} sub-item{category.subItems.length === 1 ? "" : "s"}
          {category.txCount > 0 ? ` · ${category.txCount} txn${category.txCount === 1 ? "" : "s"}` : ""}
        </span>
        <div className="flex items-center gap-xs ml-auto">
          {editing ? (
            <>
              <button
                onClick={save}
                disabled={busy}
                className="h-8 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setDraft({
                    name: category.name,
                    type: category.type,
                    isActive: category.isActive,
                  });
                  setError(null);
                }}
                disabled={busy}
                className="h-8 px-md rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={toggleActive}
                disabled={busy}
                title={category.isActive ? "Retire this category" : "Reactivate"}
                className="text-on-surface-variant hover:text-accent p-xs disabled:opacity-40"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  {category.isActive ? "toggle_on" : "toggle_off"}
                </span>
              </button>
              <button
                onClick={() => setEditing(true)}
                className="text-on-surface-variant hover:text-accent p-xs"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  edit
                </span>
              </button>
              <button
                onClick={remove}
                disabled={busy || category.txCount > 0}
                title={
                  category.txCount > 0
                    ? "Has transactions — set inactive instead"
                    : "Delete category"
                }
                className="text-on-surface-variant hover:text-error p-xs disabled:opacity-30"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  delete
                </span>
              </button>
            </>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-base rounded-lg bg-error-container text-on-error-container px-md py-sm text-body-md">
          {error}
        </div>
      )}

      <div className={"mt-md grid grid-cols-1 gap-base " + (showServiceLink ? "" : "sm:grid-cols-2 lg:grid-cols-3")}>
        {category.subItems.map((s) => (
          <SubItemRow
            key={s.id}
            sub={s}
            services={showServiceLink ? services : null}
          />
        ))}
      </div>

      <div className="mt-md flex items-center gap-xs">
        <input
          value={newSubName}
          onChange={(e) => setNewSubName(e.target.value)}
          placeholder="New sub-category…"
          onKeyDown={(e) => e.key === "Enter" && addSubItem()}
          className="flex-1 h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
        />
        <button
          onClick={addSubItem}
          disabled={busy || !newSubName.trim()}
          className="h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function SubItemRow({
  sub,
  services,
}: {
  sub: SubItem;
  services: ServiceOption[] | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sub.name);

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/master/sub-categories/${sub.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(errorLabels[data?.error as string] ?? "Failed.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function toggleActive() {
    setBusy(true);
    await fetch(`/api/master/sub-categories/${sub.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !sub.isActive }),
    });
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete sub-category "${sub.name}"?`)) return;
    setBusy(true);
    const res = await fetch(`/api/master/sub-categories/${sub.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(errorLabels[data?.error as string] ?? "Failed.");
      return;
    }
    router.refresh();
  }

  async function linkService(serviceId: string | null) {
    setBusy(true);
    const res = await fetch(`/api/master/sub-categories/${sub.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serviceId: serviceId ?? null }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(errorLabels[data?.error as string] ?? "Failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div
      className={
        "flex flex-wrap items-center gap-xs px-sm py-xs rounded-lg border " +
        (sub.isActive
          ? "bg-surface-container-low border-outline-variant"
          : "bg-surface-container border-outline-variant opacity-50")
      }
    >
      {editing ? (
        <>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 min-w-0 h-7 px-xs rounded border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary"
            autoFocus
          />
          <button
            onClick={save}
            disabled={busy}
            className="text-accent text-[11px] font-bold uppercase tracking-wider"
          >
            Save
          </button>
          <button
            onClick={() => {
              setEditing(false);
              setName(sub.name);
            }}
            className="text-on-surface-variant text-[11px] uppercase tracking-wider"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 min-w-0 text-body-md text-on-surface truncate" title={sub.name}>
            {sub.name}
          </span>
          {services !== null && (
            <select
              value={sub.serviceId ?? ""}
              onChange={(e) => linkService(e.target.value || null)}
              disabled={busy}
              title={sub.serviceName ? `Linked to service: ${sub.serviceName}` : "No service linked"}
              className={
                "h-7 px-xs rounded border text-caption max-w-[180px] " +
                (sub.serviceId
                  ? "bg-primary-fixed/40 border-primary-fixed-dim text-accent font-semibold"
                  : "bg-surface-container-lowest border-outline-variant text-on-surface-variant")
              }
            >
              <option value="">— No service —</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={toggleActive}
            disabled={busy}
            className="text-on-surface-variant hover:text-accent disabled:opacity-40"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              {sub.isActive ? "toggle_on" : "toggle_off"}
            </span>
          </button>
          <button
            onClick={() => setEditing(true)}
            className="text-on-surface-variant hover:text-accent"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              edit
            </span>
          </button>
          <button onClick={remove} disabled={busy} className="text-on-surface-variant hover:text-error disabled:opacity-40">
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              delete
            </span>
          </button>
        </>
      )}
    </div>
  );
}

export function NewCategoryButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "Revenue" as CatType });

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
    const res = await fetch("/api/master/categories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorLabels[data?.error as string] ?? "Failed to create.");
      return;
    }
    setOpen(false);
    setForm({ name: "", type: "Revenue" });
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
        Add category
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
              <h3 className="text-h3 text-on-surface">New category</h3>
              <label className="block">
                <span className="block text-label-sm text-on-surface-variant mb-xs">Name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  autoFocus
                  className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md"
                />
              </label>
              <label className="block">
                <span className="block text-label-sm text-on-surface-variant mb-xs">Type</span>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as CatType })}
                  className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md"
                >
                  <option value="Revenue">Revenue</option>
                  <option value="Expense">Expense</option>
                  <option value="Both">Both (Revenue + Expense)</option>
                </select>
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
                  {busy ? "Creating…" : "Create category"}
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

/**
 * Admin-only button that POSTs to /api/master/expense-master-migration.
 * Reshapes the live Expense master to the new 15-category list (plus
 * Commissions). Idempotent — re-clicks are safe and result in a no-op
 * once the master is in the desired state.
 */
export function ExpenseMasterMigrationButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{
    summary: Record<string, number>;
    log: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/master/expense-master-migration", { method: "POST" });
    setBusy(false);
    setConfirming(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? "migration_failed");
      return;
    }
    const data = (await res.json()) as {
      summary: Record<string, number>;
      log: string[];
    };
    setResult(data);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md space-y-sm">
      <div className="flex items-start gap-md">
        <div className="flex-1 min-w-0">
          <h3 className="text-label-md font-semibold text-on-surface">
            Expense master migration
          </h3>
          <p className="text-label-sm text-on-surface-variant mt-xs">
            One-shot reshape of the Expense category list to the new 15-category
            structure (Salary with team sub-items, Marketing with the Digital
            Marketing Management Fee, Staff Welfare with EPFO/ESIC/Meals, etc).
            Safe to re-run — deactivates rather than deletes, leaves Commissions
            and existing Transaction rows untouched.
          </p>
        </div>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="shrink-0 h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60"
          >
            Run migration
          </button>
        ) : (
          <div className="shrink-0 flex items-center gap-xs">
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60"
            >
              {busy ? "Running…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-label-sm">
          {errorLabels[error] ?? `Migration failed: ${error}`}
        </div>
      )}
      {result && (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm text-label-sm space-y-xs">
          <p className="font-semibold text-on-surface">Migration complete:</p>
          <ul className="text-on-surface-variant grid grid-cols-2 gap-x-md gap-y-[2px]">
            {Object.entries(result.summary).map(([k, v]) => (
              <li key={k}>
                <span className="font-mono">{v}</span> {humanizeKey(k)}
              </li>
            ))}
          </ul>
          {result.log.length > 0 && (
            <details className="mt-xs">
              <summary className="cursor-pointer text-on-surface-variant">
                Detail ({result.log.length} action{result.log.length === 1 ? "" : "s"})
              </summary>
              <ul className="mt-xs text-[12px] font-mono text-on-surface-variant space-y-[2px]">
                {result.log.map((l, i) => (
                  <li key={i}>· {l}</li>
                ))}
              </ul>
            </details>
          )}
          {result.log.length === 0 && (
            <p className="text-on-surface-variant">
              No changes — master already in the desired state.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function humanizeKey(k: string): string {
  return k
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toLowerCase())
    .trim();
}

/**
 * Admin-only button that POSTs to /api/admin/sync-role-pages.
 * Re-fills every Role's `pages` array with the current module
 * registry — fixes the case where new pages added in modules.ts
 * silently don't show in the sidebar for existing role records.
 */
export function SyncRolePagesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{
    summary: Record<string, number>;
    log: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/admin/sync-role-pages", { method: "POST" });
    setBusy(false);
    setConfirming(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? "sync_failed");
      return;
    }
    const data = (await res.json()) as {
      summary: Record<string, number>;
      log: string[];
    };
    setResult(data);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md space-y-sm">
      <div className="flex items-start gap-md">
        <div className="flex-1 min-w-0">
          <h3 className="text-label-md font-semibold text-on-surface">
            Sync role pages (sidebar nav)
          </h3>
          <p className="text-label-sm text-on-surface-variant mt-xs">
            Refreshes every Role.pages array against the current module
            registry. Admin roles get every page; non-admins additionally
            get /finance/parties, /marketing/parties, /master-data/sources,
            and the BDE-facing Lead Pulse trio (/marketing/lead-pulse,
            /marketing/lead-pulse/daily-entry,
            /marketing/lead-pulse/bde-performance). Run this whenever the
            sidebar doesn&apos;t show a freshly-added page. Idempotent.
          </p>
        </div>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="shrink-0 h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-60"
          >
            Sync pages
          </button>
        ) : (
          <div className="shrink-0 flex items-center gap-xs">
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-60"
            >
              {busy ? "Running…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-label-sm">
          {error === "forbidden_admin_only" ? "Admin-only action." : `Failed: ${error}`}
        </div>
      )}
      {result && (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm text-label-sm space-y-xs">
          <p className="font-semibold text-on-surface">Sync complete:</p>
          <ul className="text-on-surface-variant grid grid-cols-2 gap-x-md gap-y-[2px]">
            {Object.entries(result.summary).map(([k, v]) => (
              <li key={k}>
                <span className="font-mono">{v}</span>{" "}
                {k.replace(/([A-Z])/g, " $1").toLowerCase()}
              </li>
            ))}
          </ul>
          <details className="mt-xs">
            <summary className="cursor-pointer text-on-surface-variant">
              Per-role detail ({result.log.length} role
              {result.log.length === 1 ? "" : "s"})
            </summary>
            <ul className="mt-xs text-[12px] font-mono text-on-surface-variant space-y-[2px]">
              {result.log.map((l, i) => (
                <li key={i}>· {l}</li>
              ))}
            </ul>
          </details>
          <p className="text-caption text-on-surface-variant pt-xs">
            Note: you&apos;ll need to sign out and back in for the new nav
            entries to appear in your own sidebar (the session caches the
            permissions list).
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Admin-only button that POSTs to /api/master/parties-schema-sync.
 * Runs the additive DDL needed for the Source/Service/Profile feature
 * (Party.sourceId column + PartyService table) and copies any legacy
 * Party↔Service M:M rows into PartyService.
 *
 * Idempotent — re-clicks are safe and report "already in place" for
 * everything that's done.
 */
export function PartiesSchemaSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{
    log: string[];
    legacyCopied: number;
    legacySkipped: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/master/parties-schema-sync", { method: "POST" });
    setBusy(false);
    setConfirming(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg = (data as { error?: string; message?: string }).message ?? (data as { error?: string }).error ?? "sync_failed";
      setError(msg);
      return;
    }
    const data = (await res.json()) as {
      log: string[];
      legacyCopied: number;
      legacySkipped: number;
    };
    setResult(data);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md space-y-sm">
      <div className="flex items-start gap-md">
        <div className="flex-1 min-w-0">
          <h3 className="text-label-md font-semibold text-on-surface">
            Sync Parties schema (Source + per-service amounts)
          </h3>
          <p className="text-label-sm text-on-surface-variant mt-xs">
            One-shot DDL: adds <code>Party.sourceId</code> column and the new{" "}
            <code>PartyService</code> table to the live DB, then copies any
            legacy Party↔Service tags into the new table with{" "}
            <code>totalAmount = 0</code>. Run this once after deploy — the
            Candidates &amp; Vendors pages need it. Safe to re-run.
          </p>
        </div>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="shrink-0 h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60"
          >
            Sync schema
          </button>
        ) : (
          <div className="shrink-0 flex items-center gap-xs">
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60"
            >
              {busy ? "Running…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-label-sm">
          {error}
        </div>
      )}
      {result && (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm text-label-sm space-y-xs">
          <p className="font-semibold text-on-surface">Sync complete:</p>
          <p className="text-on-surface-variant">
            Legacy M:M copied: <span className="font-mono">{result.legacyCopied}</span>{" "}
            · skipped (already present):{" "}
            <span className="font-mono">{result.legacySkipped}</span>
          </p>
          <details className="mt-xs">
            <summary className="cursor-pointer text-on-surface-variant">
              DDL detail ({result.log.length} step{result.log.length === 1 ? "" : "s"})
            </summary>
            <ul className="mt-xs text-[12px] font-mono text-on-surface-variant space-y-[2px]">
              {result.log.map((l, i) => (
                <li key={i}>· {l}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
