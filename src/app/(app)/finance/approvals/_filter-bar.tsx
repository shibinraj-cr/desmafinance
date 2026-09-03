"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { MultiSelect } from "@/components/MultiSelect";
import { listParam, applyFilterPatch } from "@/lib/filter-params";

/**
 * Party / Category / Payment filters for the approvals queue.
 *
 * This replaced a plain GET `<form>` with an Apply button: a multi-select can't
 * be expressed as a single `<select name>`, and ticking boxes then hunting for
 * Apply is a worse trade than navigating on change — which is what every other
 * filter band in the app already does. The date inputs stay uncontrolled and
 * commit on change for the same reason.
 */
export function ApprovalsFilterBar({
  parties,
  categoryOptions,
  paymentOptions,
  clearHref,
}: {
  parties: Array<{ id: string; name: string; group: string; isActive: boolean }>;
  categoryOptions: string[];
  paymentOptions: string[];
  clearHref: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const party = listParam(search.getAll("party"));
  const category = listParam(search.getAll("category"));
  const payment = listParam(search.getAll("payment"));
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";

  function update(patch: Record<string, string | string[] | null>) {
    const params = new URLSearchParams(search.toString());
    applyFilterPatch(params, patch);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // A picked category/payment that isn't in the (type-scoped) options list is
  // still offered, so a stale pick stays visible and untickable rather than
  // filtering invisibly.
  const withStale = (options: string[], picked: string[]) =>
    [...options, ...picked.filter((p) => !options.includes(p))];

  const hasAnyFilter =
    !!from || !!to || party.length > 0 || category.length > 0 || payment.length > 0;

  const dateCls =
    "h-9 px-sm rounded-md border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md";
  const labelCls = "flex flex-col gap-[2px] text-caption text-on-surface-variant";
  const capCls = "uppercase tracking-wider font-semibold";

  return (
    <div className="flex flex-wrap items-end gap-sm rounded-xl border border-outline-variant bg-surface-container-lowest px-md py-sm">
      <label className={labelCls}>
        <span className={capCls}>From</span>
        <input
          type="date"
          value={from}
          onChange={(e) => update({ from: e.target.value || null })}
          className={dateCls}
        />
      </label>
      <label className={labelCls}>
        <span className={capCls}>To</span>
        <input
          type="date"
          value={to}
          onChange={(e) => update({ to: e.target.value || null })}
          className={dateCls}
        />
      </label>
      <div className={labelCls}>
        <span className={capCls}>Party</span>
        <MultiSelect
          placeholder="All parties"
          options={parties.map((p) => ({
            value: p.id,
            label: p.name,
            hint: p.isActive ? p.group : `${p.group} — inactive`,
          }))}
          selected={party}
          onChange={(next) => update({ party: next })}
        />
      </div>
      <div className={labelCls}>
        <span className={capCls}>Category</span>
        <MultiSelect
          placeholder="All categories"
          options={withStale(categoryOptions, category).map((c) => ({ value: c, label: c }))}
          selected={category}
          onChange={(next) => update({ category: next })}
        />
      </div>
      <div className={labelCls}>
        <span className={capCls}>Payment</span>
        <MultiSelect
          placeholder="All modes"
          options={withStale(paymentOptions, payment).map((m) => ({ value: m, label: m }))}
          selected={payment}
          onChange={(next) => update({ payment: next })}
        />
      </div>
      {hasAnyFilter && (
        <button
          type="button"
          onClick={() => router.push(clearHref, { scroll: false })}
          className="ml-auto h-9 inline-flex items-center px-md rounded-md border border-outline-variant text-label-sm font-semibold text-on-surface-variant hover:text-on-surface transition"
        >
          Clear
        </button>
      )}
    </div>
  );
}
