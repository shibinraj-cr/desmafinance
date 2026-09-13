"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MultiSelect } from "@/components/MultiSelect";
import { applyFilterPatch, listParam } from "@/lib/filter-params";
import { SOP_STATUSES, sopStatusLabel } from "@/lib/sop/constants";
import { Icon, inputCls } from "./ui";

export type SopFilterOptions = {
  departments: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  owners: { id: string; name: string }[];
  creators: { id: string; username: string }[];
};

/**
 * The SOP list filter row (§1).
 *
 * State lives in the URL, exactly like every other filter band in the app
 * (FilterBand, the CRM leads filters): the page is a server component that
 * re-queries against the new params, so a filtered view is a shareable link and
 * the back button works. Each control takes several values, written as repeated
 * query keys — see src/lib/filter-params.ts for why repeated beats
 * comma-joined.
 */
export function SopFilterRow({
  options,
  showReviewDue = true,
  showStatus = true,
}: {
  options: SopFilterOptions;
  showReviewDue?: boolean;
  showStatus?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const department = listParam(search.getAll("department"));
  const category = listParam(search.getAll("category"));
  const owner = listParam(search.getAll("owner"));
  const status = listParam(search.getAll("status"));
  const createdBy = listParam(search.getAll("createdBy"));
  const reviewDue = search.get("reviewDue") ?? "";
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";

  // The search box is debounced locally so typing does not push a route per
  // keystroke; every other control pushes immediately.
  const [q, setQ] = useState(search.get("q") ?? "");
  useEffect(() => setQ(search.get("q") ?? ""), [search]);
  useEffect(() => {
    const current = search.get("q") ?? "";
    if (q === current) return;
    const t = setTimeout(() => update({ q: q || null }), 350);
    return () => clearTimeout(t);
    // `update` closes over the current route/params; adding it to the deps
    // would reset the debounce timer on every render and the search would
    // never fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function update(patch: Record<string, string | string[] | null>) {
    const params = new URLSearchParams(search.toString());
    applyFilterPatch(params, patch);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const anyActive =
    !!q ||
    department.length > 0 ||
    category.length > 0 ||
    owner.length > 0 ||
    status.length > 0 ||
    createdBy.length > 0 ||
    !!reviewDue ||
    !!from ||
    !!to;

  return (
    <div className="flex flex-wrap items-center gap-base">
      <div className="relative">
        <Icon
          name="search"
          size={18}
          className="absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or SOP ID"
          aria-label="Search SOPs by title or SOP ID"
          className={inputCls + " pl-[2.25rem] w-64"}
        />
      </div>

      <MultiSelect
        title="Filter by department"
        placeholder="All departments"
        searchable
        options={options.departments.map((d) => ({ value: d.id, label: d.name }))}
        selected={department}
        onChange={(next) => update({ department: next })}
      />

      <MultiSelect
        title="Filter by SOP owner"
        placeholder="All owners"
        searchable
        options={options.owners.map((o) => ({ value: o.id, label: o.name }))}
        selected={owner}
        onChange={(next) => update({ owner: next })}
      />

      {showStatus && (
        <MultiSelect
          title="Filter by status"
          placeholder="All statuses"
          options={SOP_STATUSES.map((s) => ({ value: s, label: sopStatusLabel(s) }))}
          selected={status}
          onChange={(next) => update({ status: next })}
        />
      )}

      <MultiSelect
        title="Filter by category"
        placeholder="All categories"
        options={options.categories.map((c) => ({ value: c.id, label: c.name }))}
        selected={category}
        onChange={(next) => update({ category: next })}
      />

      <MultiSelect
        title="Filter by who created it"
        placeholder="Any creator"
        searchable
        options={options.creators.map((c) => ({ value: c.id, label: c.username }))}
        selected={createdBy}
        onChange={(next) => update({ createdBy: next })}
      />

      {showReviewDue && (
        <select
          aria-label="Filter by review due"
          value={reviewDue}
          onChange={(e) => update({ reviewDue: e.target.value || null })}
          className={inputCls + " w-44"}
        >
          <option value="">Any review date</option>
          <option value="overdue">Review overdue</option>
          <option value="due_today">Review due today</option>
          <option value="due_soon">Review due soon</option>
          <option value="any">Review due (all)</option>
        </select>
      )}

      <div className="flex items-center gap-xs">
        <label className="text-label-sm text-on-surface-variant">Effective</label>
        <input
          type="date"
          aria-label="Effective from"
          value={from}
          onChange={(e) => update({ from: e.target.value || null })}
          className={inputCls + " w-40"}
        />
        <span className="text-on-surface-variant">–</span>
        <input
          type="date"
          aria-label="Effective to"
          value={to}
          onChange={(e) => update({ to: e.target.value || null })}
          className={inputCls + " w-40"}
        />
      </div>

      {anyActive && (
        <button
          type="button"
          onClick={() =>
            update({
              q: null,
              department: null,
              category: null,
              owner: null,
              status: null,
              createdBy: null,
              reviewDue: null,
              from: null,
              to: null,
            })
          }
          className="h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
