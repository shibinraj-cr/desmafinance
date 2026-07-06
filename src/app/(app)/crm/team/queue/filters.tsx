"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

const selectClass =
  "h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm font-semibold focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition";

type Consultant = { userId: string; displayName: string };

/**
 * Consultant + issue dropdowns for the attention drill-down. Mirrors the Leads
 * page filter pattern: mutate a `URLSearchParams` copy and `router.push`, so the
 * server component re-renders the queue for the new filters. The consultant
 * dropdown is omitted for a self-scoped BDE (they only ever see their own).
 */
export function QueueFilters({
  consultants,
  showConsultant,
}: {
  consultants: Consultant[];
  showConsultant: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const consultant = search.get("consultant") ?? "all";
  const issue = search.get("issue") ?? "all";

  function update(patch: Record<string, string | null>) {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === "all") params.delete(k);
      else params.set(k, v);
    }
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-base">
      {showConsultant && (
        <select
          className={selectClass}
          value={consultant}
          onChange={(e) => update({ consultant: e.target.value })}
          aria-label="Filter by consultant"
        >
          <option value="all">All consultants</option>
          {consultants.map((c) => (
            <option key={c.userId} value={c.userId}>
              {c.displayName}
            </option>
          ))}
        </select>
      )}
      <select
        className={selectClass}
        value={issue}
        onChange={(e) => update({ issue: e.target.value })}
        aria-label="Filter by issue"
      >
        <option value="all">All issues</option>
        <option value="sla">SLA breaches</option>
        <option value="no-task">No next step</option>
        <option value="stuck">Stuck in stage</option>
        <option value="abandoned">Abandoned</option>
      </select>
    </div>
  );
}
