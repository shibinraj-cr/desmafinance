"use client";

import Link from "next/link";
import type { SopRow } from "@/lib/sop/queries";
import { sopStatusClass, sopStatusLabel, confidentialityLabel } from "@/lib/sop/constants";
import { REVIEW_BUCKET_CLASSES, REVIEW_BUCKET_LABELS, type ReviewBucket } from "@/lib/sop/review-dates";
import { Empty, Icon, Pill, Td, Th, formatDate } from "./ui";

/**
 * The SOP list, used by the dashboard, the library, My SOPs and the archive.
 *
 * A table rather than a grid of cards, per §19/§25: an SOP register is a
 * reference document people scan by number and department, and cards force
 * that scan into two dimensions for no gain.
 *
 * Responsiveness (§25) is handled by hiding columns, not by shrinking them:
 * below `lg` the table keeps SOP ID, title, status and actions — the columns
 * you need to FIND a document — and the metadata columns fold into a second
 * line under the title so nothing is actually lost on a tablet.
 */
export function SopTable({
  rows,
  columns = "full",
  emptyTitle = "No SOPs yet",
  emptyHint,
  renderActions,
}: {
  rows: SopRow[];
  /** "full" is the dashboard register; "compact" drops the review columns. */
  columns?: "full" | "compact";
  emptyTitle?: string;
  emptyHint?: string;
  renderActions?: (row: SopRow) => React.ReactNode;
}) {
  if (rows.length === 0) {
    return <Empty icon="description" title={emptyTitle} hint={emptyHint} />;
  }

  const full = columns === "full";

  return (
    <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
      <table className="w-full min-w-[46rem] border-collapse">
        <thead className="bg-surface-container-low border-b border-outline-variant">
          <tr>
            <Th className="w-36">SOP ID</Th>
            <Th>SOP Title</Th>
            <Th className="hidden lg:table-cell">Department</Th>
            <Th className="hidden xl:table-cell">Process Owner</Th>
            <Th className="w-20">Version</Th>
            <Th className="w-40">Status</Th>
            {full && <Th className="hidden lg:table-cell w-32">Effective</Th>}
            {full && <Th className="hidden lg:table-cell w-40">Next Review</Th>}
            <Th className="hidden xl:table-cell w-32">Last Updated</Th>
            <Th className="w-28 text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low/60">
              <Td className="font-mono text-label-sm text-on-surface-variant whitespace-nowrap">{r.sopNumber}</Td>
              <Td>
                <Link href={`/sop/${r.id}`} className="text-on-surface font-medium hover:text-accent hover:underline">
                  {r.title}
                </Link>
                {/* The columns hidden on narrow screens reappear here, so a
                    tablet loses layout, not information. */}
                <div className="lg:hidden text-caption text-on-surface-variant mt-xs">
                  {[r.department, r.owner].filter(Boolean).join(" · ") || "—"}
                </div>
                <div className="flex flex-wrap items-center gap-xs mt-xs">
                  {r.category && (
                    <span className="text-caption text-on-surface-variant">{r.category}</span>
                  )}
                  {r.confidentiality !== "general" && (
                    <Pill className="bg-surface-container-high text-on-surface-variant">
                      <Icon name="lock" size={12} className="mr-px" />
                      {confidentialityLabel(r.confidentiality)}
                    </Pill>
                  )}
                  {r.requiresAcknowledgement && (
                    <Pill className="bg-primary-fixed text-on-primary">Acknowledgement</Pill>
                  )}
                  {r.hasDraft && r.status === "published" && (
                    <Pill className="bg-surface-container-high text-on-surface-variant">
                      {r.draftLabel} in progress
                    </Pill>
                  )}
                </div>
              </Td>
              <Td className="hidden lg:table-cell text-on-surface-variant">{r.department ?? "—"}</Td>
              <Td className="hidden xl:table-cell text-on-surface-variant">{r.owner ?? "—"}</Td>
              <Td className="font-mono text-label-sm">{r.version}</Td>
              <Td>
                <Pill className={sopStatusClass(r.status)}>{sopStatusLabel(r.status)}</Pill>
              </Td>
              {full && (
                <Td className="hidden lg:table-cell text-on-surface-variant whitespace-nowrap">
                  {formatDate(r.effectiveDate)}
                </Td>
              )}
              {full && (
                <Td className="hidden lg:table-cell whitespace-nowrap">
                  {r.nextReviewDate ? (
                    <div className="flex flex-col gap-px">
                      <span className="text-on-surface-variant">{formatDate(r.nextReviewDate)}</span>
                      {r.reviewBucket !== "scheduled" && r.reviewBucket !== "none" && (
                        <Pill className={REVIEW_BUCKET_CLASSES[r.reviewBucket as ReviewBucket]}>
                          {REVIEW_BUCKET_LABELS[r.reviewBucket as ReviewBucket]}
                        </Pill>
                      )}
                    </div>
                  ) : (
                    <span className="text-on-surface-variant">—</span>
                  )}
                </Td>
              )}
              <Td className="hidden xl:table-cell text-on-surface-variant whitespace-nowrap">
                {formatDate(r.lastUpdated)}
              </Td>
              <Td className="text-right whitespace-nowrap">
                {renderActions ? (
                  renderActions(r)
                ) : (
                  <Link
                    href={`/sop/${r.id}`}
                    className="inline-flex items-center gap-xs text-label-sm text-accent hover:underline"
                  >
                    Open <Icon name="chevron_right" size={16} />
                  </Link>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
