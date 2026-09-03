"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useMemo } from "react";
import { PAYMENT_MODES } from "@/lib/catalog";
import { MultiSelect } from "@/components/MultiSelect";
import { listParam, applyFilterPatch } from "@/lib/filter-params";

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
 * router-driven pattern: each control rebuilds the URLSearchParams
 * (preserving every other key) and pushes a new route. The page is a
 * server component that re-renders against the new where clause.
 *
 * Every control takes several values, written as repeated query keys
 * (`?mode=Cash&mode=UPI`), which the page turns into a Prisma `IN`.
 *
 * Cascading: changing `category` drops any selected sub-items that no longer
 * belong to the picked categories. Changing the page-level `type` filter
 * (handled by the existing chips outside this component) is what re-narrows the
 * Category and Party lists, so we just consume the active type as a prop.
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

  const category = listParam(search.getAll("category"));
  const sub = listParam(search.getAll("sub"));
  const partyId = listParam(search.getAll("party"));
  const mode = listParam(search.getAll("mode"));
  const flow = listParam(search.getAll("flow"));

  const visibleCategories = useMemo(() => {
    if (!type) return categories.filter((c) => c.isActive);
    return categories.filter(
      (c) => c.isActive && (c.type === type || c.type === "Both"),
    );
  }, [categories, type]);

  // Sub-items of every picked category, de-duplicated by name (two categories
  // can share a sub-item name, and the filter matches on name).
  const visibleSubItems = useMemo(() => {
    const picked = visibleCategories.filter((c) => category.includes(c.name));
    const names = new Set<string>();
    for (const c of picked) {
      for (const s of c.subItems) if (s.isActive) names.add(s.name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [visibleCategories, category]);

  const visibleParties = useMemo(() => {
    if (!type) return parties.filter((p) => p.isActive);
    return parties.filter(
      (p) => p.isActive && (p.txTypes === type || p.txTypes === "Both"),
    );
  }, [parties, type]);

  // Hide the sub-item selector when there's no category picked yet — an
  // "All sub-items" list with the union of every category's sub-items would be
  // a giant and confusing list.
  const subItemDisabled = category.length === 0;

  function update(patch: Record<string, string | string[] | null>) {
    const params = new URLSearchParams(search.toString());
    applyFilterPatch(params, patch);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  /**
   * Category change cascades onto sub-items: keep only the sub-items that still
   * belong to a picked category, so narrowing the category list can't leave an
   * invisible sub-item filtering the table to nothing.
   */
  function updateCategories(next: string[]) {
    const stillValid = new Set<string>();
    for (const c of visibleCategories) {
      if (!next.includes(c.name)) continue;
      for (const s of c.subItems) if (s.isActive) stillValid.add(s.name);
    }
    update({ category: next, sub: sub.filter((s) => stillValid.has(s)) });
  }

  const anyActive =
    category.length > 0 || sub.length > 0 || partyId.length > 0 || mode.length > 0 || flow.length > 0;

  function clearAll() {
    update({ category: null, sub: null, party: null, mode: null, flow: null });
  }

  return (
    <div className="flex flex-wrap items-center gap-base">
      <MultiSelect
        title="Filter by category"
        placeholder="All categories"
        options={visibleCategories.map((c) => ({ value: c.name, label: c.name }))}
        selected={category}
        onChange={updateCategories}
      />

      <MultiSelect
        title="Filter by sub-item"
        placeholder="All sub-items"
        disabled={subItemDisabled}
        disabledHint="Pick a category first"
        options={visibleSubItems.map((s) => ({ value: s, label: s }))}
        selected={sub}
        onChange={(next) => update({ sub: next })}
      />

      <MultiSelect
        title="Filter by party"
        placeholder="All parties"
        options={visibleParties.map((p) => ({
          value: p.id,
          label: p.name,
          hint: p.group === "Candidate" ? "Candidate" : "Vendor",
        }))}
        selected={partyId}
        onChange={(next) => update({ party: next })}
      />

      <MultiSelect
        title="Filter by payment mode"
        placeholder="All modes"
        options={PAYMENT_MODES.map((m) => ({ value: m, label: m }))}
        selected={mode}
        onChange={(next) => update({ mode: next })}
      />

      <MultiSelect
        title="Filter by flow"
        placeholder="All flow"
        options={[
          { value: "Inflow", label: "Inflow" },
          { value: "Outflow", label: "Outflow" },
        ]}
        selected={flow}
        onChange={(next) => update({ flow: next })}
      />

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
