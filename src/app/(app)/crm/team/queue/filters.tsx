"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { MultiSelect } from "@/components/MultiSelect";
import { listParam, applyFilterPatch } from "@/lib/filter-params";

type Consultant = { userId: string; displayName: string };

const ISSUE_OPTIONS = [
  { value: "sla", label: "SLA breaches" },
  { value: "no-task", label: "No next step" },
  { value: "stuck", label: "Stuck in stage" },
  { value: "abandoned", label: "Abandoned" },
  { value: "overdue-task", label: "Overdue tasks" },
  { value: "first-response", label: "First-response gaps" },
  { value: "reinquiry", label: "Re-inquiry follow-ups" },
];

/**
 * Consultant + issue filters for the attention drill-down. Mirrors the Leads
 * page pattern: mutate a `URLSearchParams` copy and `router.push`, so the server
 * component re-renders the queue for the new filters. The consultant filter is
 * omitted for a self-scoped BDE (they only ever see their own).
 *
 * Both take several values. The four flag buckets (SLA / no next step / stuck /
 * abandoned) union into one lead list; the three task drill-downs each render
 * their own table, so the page honours the first task issue picked — see the
 * `taskIssue` note in page.tsx.
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

  function update(patch: Record<string, string | string[] | null>) {
    const params = new URLSearchParams(search.toString());
    applyFilterPatch(params, patch);
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-base">
      {showConsultant && (
        <MultiSelect
          placeholder="All consultants"
          title="Filter by consultant"
          options={consultants.map((c) => ({ value: c.userId, label: c.displayName }))}
          selected={listParam(search.getAll("consultant"))}
          onChange={(next) => update({ consultant: next })}
        />
      )}
      <MultiSelect
        placeholder="All issues"
        title="Filter by issue"
        options={ISSUE_OPTIONS}
        selected={listParam(search.getAll("issue"))}
        onChange={(next) => update({ issue: next })}
      />
    </div>
  );
}
