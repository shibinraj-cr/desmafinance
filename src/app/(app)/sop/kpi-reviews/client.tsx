"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KpiReviewDialog } from "@/components/sop/ListSections";
import {
  KPI_STATUS_CLASSES,
  KPI_STATUS_LABELS,
  reviewFrequencyLabel,
  type KpiStatus,
} from "@/lib/sop/constants";
import { Empty, Icon, Pill, Td, Th, formatDate, inputCls, primaryBtn } from "@/components/sop/ui";

export type KpiReviewRow = {
  id: string;
  seq: number;
  name: string;
  description: string | null;
  target: string | null;
  unit: string | null;
  measurementMethod: string | null;
  dataSource: string | null;
  reviewFrequency: string | null;
  kpiOwnerEmployeeId: string | null;
  kpiOwner: string | null;
  latestActual: string | null;
  latestStatus: string | null;
  latestReviewedAt: string | null;
  sopId: string;
  sopNumber: string;
  sopTitle: string;
  department: string | null;
  versionLabel: string;
  reviews: {
    id: string;
    periodStart: string;
    periodEnd: string;
    actual: string;
    status: string;
    notes: string | null;
    reviewedBy: string | null;
    reviewedAt: string;
  }[];
};

/**
 * The KPI review screen.
 *
 * One flat table across every SOP rather than a per-SOP drill-down: the person
 * doing this sits down once a month and works through their numbers, and making
 * them open eleven SOPs to enter eleven results is how the exercise stops
 * happening.
 */
export function KpiReviewsClient({ rows }: { rows: KpiReviewRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [onlyUnmeasured, setOnlyUnmeasured] = useState(false);
  const [recording, setRecording] = useState<KpiReviewRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyUnmeasured && r.latestActual) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.sopTitle.toLowerCase().includes(q) ||
        r.sopNumber.toLowerCase().includes(q)
      );
    });
  }, [rows, query, onlyUnmeasured]);

  if (rows.length === 0) {
    return (
      <Empty
        icon="monitoring"
        title="No KPIs to review"
        hint="KPIs appear here once an SOP you own — or one where you are the named KPI owner — has been published with KPIs defined."
      />
    );
  }

  return (
    <div className="space-y-md">
      <div className="flex flex-wrap items-center gap-base">
        <div className="relative">
          <Icon
            name="search"
            size={18}
            className="absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search KPI or SOP"
            aria-label="Search KPIs"
            className={inputCls + " pl-[2.25rem] w-64"}
          />
        </div>
        <button
          type="button"
          onClick={() => setOnlyUnmeasured((v) => !v)}
          className={
            "h-9 px-md inline-flex items-center gap-xs rounded-full border text-label-sm transition " +
            (onlyUnmeasured
              ? "bg-primary text-on-primary border-primary"
              : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
          }
        >
          <Icon name="filter_alt" size={16} /> Never measured
        </button>
        <span className="text-body-sm text-on-surface-variant">
          {filtered.length} of {rows.length} KPIs
        </span>
      </div>

      {filtered.length === 0 ? (
        <Empty icon="search_off" title="No KPIs match" hint="Clear the search or the filter." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full min-w-[52rem] border-collapse">
            <thead className="bg-surface-container-low border-b border-outline-variant">
              <tr>
                <Th className="w-48">SOP</Th>
                <Th>KPI</Th>
                <Th className="w-28">Target</Th>
                <Th className="hidden lg:table-cell w-32">Frequency</Th>
                <Th className="hidden xl:table-cell w-36">Owner</Th>
                <Th className="w-44">Latest result</Th>
                <Th className="w-32 text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-outline-variant last:border-0 align-top">
                  <Td>
                    <Link
                      href={`/sop/${r.sopId}`}
                      className="text-on-surface font-medium hover:text-accent hover:underline"
                    >
                      {r.sopTitle}
                    </Link>
                    <div className="text-caption text-on-surface-variant font-mono">
                      {r.sopNumber} · {r.versionLabel}
                    </div>
                    {r.department && (
                      <div className="text-caption text-on-surface-variant">{r.department}</div>
                    )}
                  </Td>
                  <Td>
                    <div className="text-on-surface">{r.name}</div>
                    {r.dataSource && (
                      <div className="text-caption text-on-surface-variant">Source: {r.dataSource}</div>
                    )}
                  </Td>
                  <Td className="text-on-surface-variant whitespace-nowrap">
                    {[r.target, r.unit].filter(Boolean).join(" ") || "—"}
                  </Td>
                  <Td className="hidden lg:table-cell text-on-surface-variant">
                    {reviewFrequencyLabel(r.reviewFrequency)}
                  </Td>
                  <Td className="hidden xl:table-cell text-on-surface-variant">{r.kpiOwner ?? "—"}</Td>
                  <Td>
                    {r.latestActual ? (
                      <div className="flex flex-col gap-px">
                        <span className="text-on-surface font-medium">{r.latestActual}</span>
                        {r.latestStatus && (
                          <Pill className={KPI_STATUS_CLASSES[r.latestStatus as KpiStatus]}>
                            {KPI_STATUS_LABELS[r.latestStatus as KpiStatus] ?? r.latestStatus}
                          </Pill>
                        )}
                        <span className="text-caption text-on-surface-variant">
                          {formatDate(r.latestReviewedAt)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-on-surface-variant">Never measured</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <button
                      type="button"
                      className={primaryBtn + " h-9 px-md inline-flex items-center gap-xs"}
                      onClick={() => setRecording(r)}
                    >
                      <Icon name="add_chart" size={16} /> Record
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recording && (
        <KpiReviewDialog
          kpi={{
            id: recording.id,
            seq: recording.seq,
            name: recording.name,
            description: recording.description,
            target: recording.target,
            unit: recording.unit,
            measurementMethod: recording.measurementMethod,
            dataSource: recording.dataSource,
            reviewFrequency: recording.reviewFrequency,
            kpiOwnerEmployeeId: recording.kpiOwnerEmployeeId,
            kpiOwner: recording.kpiOwner,
            latestActual: recording.latestActual,
            latestStatus: recording.latestStatus,
            latestReviewedAt: recording.latestReviewedAt,
            reviews: recording.reviews,
          }}
          onClose={() => setRecording(null)}
          onSaved={() => {
            setRecording(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
