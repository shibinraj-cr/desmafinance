"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useMemo } from "react";
import { PAYMENT_MODES } from "@/lib/catalog";

export type FilterBandCategory = {
  id: string;
  name: string;
  type: "Revenue" | "Expense" | "Both";
  isActive: boolean;
  subItems: { id: string; name: string; isActive: boolean }[];
};

export type FilterBandParty = {
  id: string;
  name: string;
  group: "Candidate" | "Vendor";
  txTypes: "Revenue" | "Expense" | "Both";
  isActive: boolean;
};

/**
 * Inline filter row for the Daily Tracker. Mirrors `DateFilter`'s
 * router-driven pattern: each select rebuilds the URLSearchParams
 * (preserving every other key) and pushes a new route. The page is a
 * server component that re-renders against the new where clause.
 *
 * Cascading: changing `category` clears `sub` because the previously
 * selected sub-item likely doesn't belong to the new category. Changing
 * the page-level `type` filter (handled by the existing chips outside
 * this component) is what re-narrows the Category and Party lists, so
 * we just consume the active type as a prop.
 */
export function FilterBand({
  categories,
  parties,
  type,
}: {
  categories: FilterBandCategory[];
  parties: FilterBandParty[];
  type: string | undefined;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const category = search.get("category") ?? "";
  const sub = search.get("sub") ?? "";
  const partyId = search.get("party") ?? "";
  const mode = search.get("mode") ?? "";
  const flow = search.get("flow") ?? "";

  const visibleCategories = useMemo(() => {
    if (!type) return categories.filter((c) => c.isActive);
    return categories.filter(
      (c) => c.isActive && (c.type === type || c.type === "Both"),
    );
  }, [categories, type]);

  const currentCategory = useMemo(
    () => visibleCategories.find((c) => c.name === category) ?? null,
    [visibleCategories, category],
  );

  const visibleSubItems = useMemo(() => {
    if (!currentCategory) return [];
    return currentCategory.subItems.filter((s) => s.isActive);
  }, [currentCategory]);

  const visibleParties = useMemo(() => {
    if (!type) return parties.filter((p) => p.isActive);
    return parties.filter(
      (p) => p.isActive && (p.txTypes === type || p.txTypes === "Both"),
    );
  }, [parties, type]);

  // Hide the sub-item selector when there's no category picked yet —
  // an "All sub-items" select with the union of every category's sub-
  // items would be a giant and confusing list.
  const subItemDisabled = !category;

  function update(patch: Record<string, string | null>) {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    // Cascading: when category changes, clear sub even if caller didn't.
    if ("category" in patch && patch.category !== category) {
      if (!("sub" in patch)) params.delete("sub");
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const anyActive = category || sub || partyId || mode || flow;

  function clearAll() {
    const params = new URLSearchParams(search.toString());
    params.delete("category");
    params.delete("sub");
    params.delete("party");
    params.delete("mode");
    params.delete("flow");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const selectClass =
    "h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition";

  return (
    <div className="flex flex-wrap items-center gap-base">
      <select
        aria-label="Filter by category"
        value={category}
        onChange={(e) => update({ category: e.target.value || null, sub: null })}
        className={selectClass}
      >
        <option value="">All categories</option>
        {visibleCategories.map((c) => (
          <option key={c.id} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by sub-item"
        value={sub}
        onChange={(e) => update({ sub: e.target.value || null })}
        disabled={subItemDisabled}
        className={selectClass + (subItemDisabled ? " opacity-50 cursor-not-allowed" : "")}
      >
        <option value="">{subItemDisabled ? "Pick a category first" : "All sub-items"}</option>
        {visibleSubItems.map((s) => (
          <option key={s.id} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by party"
        value={partyId}
        onChange={(e) => update({ party: e.target.value || null })}
        className={selectClass}
      >
        <option value="">All parties</option>
        {visibleParties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.group === "Candidate" ? " (Candidate)" : " (Vendor)"}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by payment mode"
        value={mode}
        onChange={(e) => update({ mode: e.target.value || null })}
        className={selectClass}
      >
        <option value="">All modes</option>
        {PAYMENT_MODES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by flow"
        value={flow}
        onChange={(e) => update({ flow: e.target.value || null })}
        className={selectClass}
      >
        <option value="">All flow</option>
        <option value="Inflow">Inflow</option>
        <option value="Outflow">Outflow</option>
      </select>

      {anyActive && (
        <button
          type="button"
          onClick={clearAll}
          className="h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
