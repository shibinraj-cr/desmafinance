"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PAYMENT_MODES } from "@/lib/catalog";
import { MultiSelect } from "@/components/MultiSelect";
import { applyFilterPatch, listParam } from "@/lib/filter-params";

/**
 * Payment-mode multi-select for the analysis dashboards, shaped to sit beside
 * `DateFilter` in a `TopBar` action slot.
 *
 * Reads and writes the same `?mode=` key the Daily Tracker's `FilterBand`
 * uses — repeated for several values (`?mode=Axis%20Bank&mode=RCS`) — so a
 * link carried from the ledger to a dashboard keeps its mode narrowing.
 */
export function PaymentModeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const mode = listParam(search.getAll("mode"));

  function update(next: string[]) {
    const params = new URLSearchParams(search.toString());
    applyFilterPatch(params, { mode: next });
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <MultiSelect
      title="Filter by payment mode"
      placeholder="All modes"
      icon="account_balance"
      options={PAYMENT_MODES.map((m) => ({ value: m, label: m }))}
      selected={mode}
      onChange={update}
      align="right"
    />
  );
}
