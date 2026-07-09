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
 * Per-module identity hex — used for the "access shape" dots in the role
 * list and the module filter chips. Kept as inline colours (not Tailwind
 * classes) so a role's reach reads at a glance without a safelist.
 */
const MODULE_HEX: Record<string, string> = {
  executive: "#7C5CFF",
  finance: "#CA8A04",
  marketing: "#0891B2",
  crm: "#0D9488",
  operations: "#2563EB",
  hr: "#64748B",
  me: "#DB2777",
  "master-data": "#9333EA",
  system: "#78716C",
};
function moduleHex(id: string): string {
  return MODULE_HEX[id] ?? "#78716C";
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
 * selecting / clearing an entire module's pages. Used by the new-role
 * modal (the existing-role editor uses FilterablePageAccess).
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
                <PageCheckbox
                  key={p.href}
                  page={p}
                  moduleId={m.id}
                  moduleName={m.name}
                  checked={selected.has(p.href)}
                  onToggle={() => onToggle(p.href)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A single page-access checkbox row, shared by both editors. */
function PageCheckbox({
  page: p,
  moduleId,
  moduleName,
  checked,
  onToggle,
}: {
  page: AppPage;
  moduleId: string;
  moduleName: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={
        "flex items-center gap-sm px-md py-sm rounded-lg border cursor-pointer transition " +
        (checked
          ? "bg-primary-fixed/40 border-primary-fixed-dim"
          : "bg-surface-container-lowest border-outline-variant hover:bg-surface-container")
      }
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="w-4 h-4 accent-primary"
      />
      <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 18 }}>
        {p.icon}
      </span>
      <span className="text-body-md text-on-surface flex-1">{p.label}</span>
      <span
        className={
          "text-[10px] uppercase tracking-wider font-semibold px-xs py-[1px] rounded border " +
          moduleTagClass(moduleId)
        }
      >
        {moduleName}
      </span>
      {p.adminOnly && (
        <span className="text-[10px] uppercase tracking-widest text-accent font-bold">
          Admin
        </span>
      )}
    </label>
  );
}

/**
 * The existing-role page-access editor: module filter chips + a page
 * search + an "only granted" toggle over the module-grouped grid, with
 * per-module All/Clear. Handles a ~74-page list without the wall-of-
 * checkboxes problem.
 */
function FilterablePageAccess({
  allPages,
  selected,
  onToggle,
  onSetMany,
}: {
  allPages: AppPage[];
  selected: Set<string>;
  onToggle: (href: string) => void;
  onSetMany: (hrefs: string[], on: boolean) => void;
}) {
  const groups = useMemo(() => groupPagesByModule(allPages), [allPages]);
  const [modFilter, setModFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [onlyGranted, setOnlyGranted] = useState(false);

  const q = query.trim().toLowerCase();
  const total = allPages.length;

  const visibleGroups = groups
    .filter((g) => modFilter === "all" || g.module.id === modFilter)
    .map((g) => ({
      module: g.module,
      pages: g.pages.filter((p) => {
        if (onlyGranted && !selected.has(p.href)) return false;
        if (
          q &&
          !p.label.toLowerCase().includes(q) &&
          !p.href.toLowerCase().includes(q)
        )
          return false;
        return true;
      }),
    }))
    .filter((g) => g.pages.length > 0);

  return (
    <div className="space-y-sm">
      <div className="flex items-center gap-base flex-wrap">
        <p className="text-label-sm font-bold uppercase tracking-wider text-on-surface-variant">
          Page access
        </p>
        <span className="text-caption text-on-surface-variant">
          {selected.size} of {total} pages granted
        </span>
        <div className="ml-auto flex items-center gap-base">
          <label className="inline-flex items-center gap-xs text-caption font-semibold text-on-surface-variant cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyGranted}
              onChange={(e) => setOnlyGranted(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            Only granted
          </label>
          <div className="relative">
            <span
              className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
              style={{ fontSize: 16 }}
            >
              search
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter pages…"
              className="h-8 w-[200px] max-w-[46vw] pl-8 pr-md rounded-lg border border-outline-variant bg-surface-container-lowest text-caption focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
            />
          </div>
        </div>
      </div>

      {/* module filter chips */}
      <div className="flex gap-xs overflow-x-auto pb-xs border-b border-outline-variant/60">
        <ModChip
          active={modFilter === "all"}
          onClick={() => setModFilter("all")}
          label="All modules"
          frac={`${selected.size}/${total}`}
        />
        {groups.map(({ module: m, pages }) => {
          const n = pages.filter((p) => selected.has(p.href)).length;
          return (
            <ModChip
              key={m.id}
              active={modFilter === m.id}
              onClick={() => setModFilter(m.id)}
              color={moduleHex(m.id)}
              label={m.name}
              frac={`${n}/${pages.length}`}
            />
          );
        })}
      </div>

      {visibleGroups.length === 0 ? (
        <div className="py-lg text-center text-caption text-on-surface-variant">
          No pages match this filter.
        </div>
      ) : (
        <div className="space-y-md pt-xs">
          {visibleGroups.map(({ module: m, pages }) => {
            const moduleHrefs = groups.find((g) => g.module.id === m.id)!.pages.map((p) => p.href);
            const selectedInModule = moduleHrefs.filter((h) => selected.has(h)).length;
            const allChecked = selectedInModule === moduleHrefs.length;
            const noneChecked = selectedInModule === 0;
            return (
              <div key={m.id}>
                <div className="flex items-center gap-sm pb-sm">
                  <span
                    className="w-2.5 h-2.5 rounded-[3px]"
                    style={{ backgroundColor: moduleHex(m.id) }}
                  />
                  <span className="text-label-sm font-bold uppercase tracking-wider text-on-surface">
                    {m.name}
                  </span>
                  <span className="text-caption text-on-surface-variant">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-base">
                  {pages.map((p) => (
                    <PageCheckbox
                      key={p.href}
                      page={p}
                      moduleId={m.id}
                      moduleName={m.name}
                      checked={selected.has(p.href)}
                      onToggle={() => onToggle(p.href)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ModChip({
  active,
  onClick,
  label,
  frac,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  frac: string;
  color?: string;
}) {
  // Colour-tinted active state for module chips; the colourless "All modules"
  // chip falls back to the gold primary-fixed classes.
  const activeColorless = active && !color;
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-none inline-flex items-center gap-xs h-8 px-sm rounded-full border text-caption font-semibold whitespace-nowrap transition " +
        (active
          ? activeColorless
            ? "bg-primary-fixed/50 border-primary-fixed-dim text-on-surface"
            : "text-on-surface"
          : "bg-surface-container-low border-outline-variant text-on-surface-variant hover:text-on-surface")
      }
      style={
        active && color
          ? { backgroundColor: `${color}22`, borderColor: color }
          : undefined
      }
    >
      {color && (
        <span className="w-2 h-2 rounded-[2px]" style={{ backgroundColor: color }} />
      )}
      {label}
      <span className="text-[10px] text-on-surface-variant font-bold">{frac}</span>
    </button>
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

/** Count how many of a role's granted pages fall in each module. */
function moduleCounts(role: Role): Array<{ module: AppModule; granted: number; total: number }> {
  const granted = new Set(role.pages);
  return MODULES.map((m) => ({
    module: m,
    granted: m.pages.filter((p) => granted.has(p.href)).length,
    total: m.pages.length,
  }));
}

/**
 * Master–detail role manager: a searchable, filterable list of roles on
 * the left; the selected role's editor on the right. Only one role's
 * page-access grid renders at a time.
 */
export function RolesEditor({
  roles,
  allPages,
}: {
  roles: Role[];
  allPages: AppPage[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(roles[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "admin" | "approve" | "custom" | "system">("all");

  const total = allPages.length;

  // Keep the selection valid across refreshes (e.g. after a delete).
  const selected =
    roles.find((r) => r.id === selectedId) ?? roles[0] ?? null;
  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  const q = query.trim().toLowerCase();
  const filtered = roles.filter((r) => {
    if (typeFilter === "admin" && !r.isAdmin) return false;
    if (typeFilter === "approve" && !r.canApprove) return false;
    if (typeFilter === "custom" && r.isSystem) return false;
    if (typeFilter === "system" && !r.isSystem) return false;
    if (
      q &&
      !r.name.toLowerCase().includes(q) &&
      !(r.description ?? "").toLowerCase().includes(q)
    )
      return false;
    return true;
  });

  const counts = {
    all: roles.length,
    admin: roles.filter((r) => r.isAdmin).length,
    approve: roles.filter((r) => r.canApprove).length,
    custom: roles.filter((r) => !r.isSystem).length,
    system: roles.filter((r) => r.isSystem).length,
  };
  const usersAssigned = roles.reduce((a, r) => a + r.userCount, 0);

  return (
    <div className="space-y-md">
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-base">
      <StatTile label="Roles" value={counts.all} />
      <StatTile label="Admin roles" value={counts.admin} hint="full access" />
      <StatTile label="Users assigned" value={usersAssigned} hint="across all roles" />
      <StatTile label="Custom roles" value={counts.custom} hint={`${counts.system} system`} />
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-md items-start">
      {/* LEFT — role list */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden lg:sticky lg:top-md">
        <div className="p-sm">
          <div className="relative">
            <span
              className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
              style={{ fontSize: 18 }}
            >
              search
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search roles…"
              className="w-full h-10 pl-10 pr-md rounded-lg border border-outline-variant bg-surface-container-low text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
            />
          </div>
          <div className="flex flex-wrap gap-xs pt-sm">
            {([
              ["all", "All"],
              ["admin", "Admin"],
              ["approve", "Approvers"],
              ["custom", "Custom"],
              ["system", "System"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTypeFilter(id)}
                className={
                  "inline-flex items-center gap-xs h-7 px-sm rounded-full border text-[12px] font-semibold transition " +
                  (typeFilter === id
                    ? "bg-primary-fixed/50 border-primary-fixed-dim text-on-surface"
                    : "bg-surface-container-low border-outline-variant text-on-surface-variant hover:text-on-surface")
                }
              >
                {label}
                <span className="text-[10px] opacity-70">{counts[id]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-outline-variant/70 p-xs max-h-[calc(100vh-220px)] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-lg text-center text-caption text-on-surface-variant">
              No roles match.
            </div>
          ) : (
            filtered.map((r) => (
              <RoleListItem
                key={r.id}
                role={r}
                total={total}
                active={r.id === selected?.id}
                onSelect={() => setSelectedId(r.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* RIGHT — detail editor */}
      {selected ? (
        <RoleDetail key={selected.id} role={selected} allPages={allPages} />
      ) : (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg text-center text-on-surface-variant">
          No roles yet. Use “Add role” to create one.
        </div>
      )}
    </div>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm px-md py-sm">
      <div className="text-label-sm font-bold uppercase tracking-wider text-on-surface-variant">
        {label}
      </div>
      <div className="text-h2 text-on-surface font-semibold leading-tight mt-xs tabular-nums">
        {value}
        {hint && (
          <span className="text-caption font-medium text-on-surface-variant ml-xs align-middle">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

function RoleListItem({
  role,
  total,
  active,
  onSelect,
}: {
  role: Role;
  total: number;
  active: boolean;
  onSelect: () => void;
}) {
  const counts = useMemo(() => moduleCounts(role), [role]);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active}
      className={
        "w-full text-left rounded-lg px-sm py-sm mb-[2px] border transition " +
        (active
          ? "bg-primary-fixed/40 border-primary-fixed-dim"
          : "border-transparent hover:bg-surface-container-low")
      }
    >
      <div className="flex items-center gap-sm">
        <span className="font-semibold text-body-md text-on-surface truncate">{role.name}</span>
        {role.isAdmin ? (
          <span className="text-[9px] uppercase tracking-wider font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-xs py-[1px]">
            Admin
          </span>
        ) : role.isSystem ? (
          <span className="text-[9px] uppercase tracking-wider font-bold text-on-surface-variant border border-outline-variant rounded-full px-xs py-[1px]">
            System
          </span>
        ) : (
          <span className="text-[9px] uppercase tracking-wider font-bold text-accent border border-primary-fixed-dim rounded-full px-xs py-[1px]">
            Custom
          </span>
        )}
      </div>
      <div className="flex items-center gap-xs text-caption text-on-surface-variant mt-xs">
        <span>{role.pages.length} of {total} pages</span>
        <span className="w-[3px] h-[3px] rounded-full bg-current opacity-50" />
        <span>{role.userCount} user{role.userCount === 1 ? "" : "s"}</span>
      </div>
      {/* access shape — one dot per module: solid = full, tint = partial, hollow = none */}
      <div className="flex gap-[3px] mt-sm">
        {counts.map(({ module: m, granted, total: t }) => {
          const hex = moduleHex(m.id);
          const style =
            granted === 0
              ? undefined
              : granted === t
                ? { backgroundColor: hex, borderColor: hex }
                : { backgroundColor: `${hex}66`, borderColor: hex };
          return (
            <span
              key={m.id}
              title={`${m.name}: ${granted}/${t}`}
              className={
                "w-[9px] h-[9px] rounded-[3px] border " +
                (granted === 0 ? "bg-surface-container-high border-outline-variant" : "")
              }
              style={style}
            />
          );
        })}
      </div>
    </button>
  );
}

function RoleDetail({ role, allPages }: { role: Role; allPages: AppPage[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
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

      <FilterablePageAccess
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
        {dirty && !busy && (
          <span className="text-caption text-accent font-semibold">Unsaved changes</span>
        )}
        {saved && (
          <span className="inline-flex items-center gap-xs text-caption text-green-700 font-semibold">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              check_circle
            </span>
            Saved
          </span>
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
