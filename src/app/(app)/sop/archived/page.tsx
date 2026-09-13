import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { SopTable } from "@/components/sop/SopTable";
import { SopFilterRow } from "@/components/sop/SopFilterRow";
import { loadSopAccess } from "@/lib/sop/access";
import { filterOptions, listSops, type SopFilters } from "@/lib/sop/queries";
import { listParam, oneParam } from "@/lib/filter-params";
import { NoAccess } from "../_no-access";
import { RestoreButton } from "./restore";

export const dynamic = "force-dynamic";

/**
 * Archived SOPs (§20).
 *
 * Admin-only by design: an archived SOP is obsolete, and leaving it findable
 * alongside live ones is how someone ends up following a retired procedure.
 * The record is kept in full — reason, date, replacement — and can be restored.
 */
export default async function ArchivedSopsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const access = await loadSopAccess();
  if (!access) redirect("/login");

  if (!access.isSopAdmin) {
    return (
      <NoAccess
        title="Archived SOPs"
        message="Archived SOPs are kept for SOP administrators. If you are looking for a procedure that has been retired, ask a SOP administrator which SOP replaced it."
        cta={{ href: "/sop/library", label: "Go to the SOP Library" }}
      />
    );
  }

  const filters: SopFilters = {
    search: oneParam(searchParams.q),
    departmentIds: listParam(searchParams.department),
    ownerEmployeeIds: listParam(searchParams.owner),
    categoryIds: listParam(searchParams.category),
    createdByIds: listParam(searchParams.createdBy),
    archived: true,
  };

  const [{ rows }, options] = await Promise.all([
    listSops(access, filters, { sort: "recent" }),
    filterOptions(access),
  ]);

  return (
    <>
      <TopBar title="Archived SOPs" subtitle="Retired procedures, kept for the record" />
      <div className="p-margin space-y-md">
        <SopFilterRow options={options} showStatus={false} showReviewDue={false} />

        <SopTable
          rows={rows}
          columns="compact"
          emptyTitle="Nothing archived"
          emptyHint="SOPs you archive are kept here with their reason and replacement."
          renderActions={(r) => <RestoreButton sopId={r.id} sopNumber={r.sopNumber} />}
        />

        {rows.some((r) => r.archiveReason || r.replacement) && (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
            <h3 className="text-h3 text-on-surface mb-sm">Archive reasons</h3>
            <ul className="space-y-sm">
              {rows.map((r) => (
                <li key={r.id} className="text-body-sm">
                  <span className="font-mono text-label-sm text-on-surface-variant">{r.sopNumber}</span>{" "}
                  <span className="text-on-surface">{r.title}</span>
                  {r.archiveReason && (
                    <span className="text-on-surface-variant"> — {r.archiveReason}</span>
                  )}
                  {r.replacement && (
                    <span className="text-on-surface-variant">
                      {" "}
                      Replaced by {r.replacement.sopNumber} {r.replacement.title}.
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
