import { redirect } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { SopTable } from "@/components/sop/SopTable";
import { SopFilterRow } from "@/components/sop/SopFilterRow";
import { loadSopAccess } from "@/lib/sop/access";
import { filterOptions, listSops, type SopFilters, type SopSort } from "@/lib/sop/queries";
import { listParam, oneParam } from "@/lib/filter-params";

export const dynamic = "force-dynamic";

const SORTS: { value: SopSort; label: string }[] = [
  { value: "recent", label: "Recently updated" },
  { value: "most_viewed", label: "Most viewed" },
  { value: "number", label: "SOP ID" },
  { value: "title", label: "Title" },
];

/**
 * The SOP Library (§19) — published SOPs, for everyone.
 *
 * The one screen in the module open to every signed-in employee, so it shows
 * only PUBLISHED SOPs: drafts and in-review versions are work in progress, and
 * a library that lists half-written procedures teaches people not to trust it.
 */
export default async function SopLibraryPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const access = await loadSopAccess();
  if (!access) redirect("/login");

  const sort = (oneParam(searchParams.sort) as SopSort | undefined) ?? "recent";
  const filters: SopFilters = {
    search: oneParam(searchParams.q),
    departmentIds: listParam(searchParams.department),
    ownerEmployeeIds: listParam(searchParams.owner),
    categoryIds: listParam(searchParams.category),
    createdByIds: listParam(searchParams.createdBy),
    requiresAcknowledgement: oneParam(searchParams.requiresAck) === "1",
    // The library is the published register, full stop.
    publishedOnly: true,
  };

  const [{ rows }, options] = await Promise.all([
    listSops(access, filters, { sort }),
    filterOptions(access),
  ]);

  const ackOnly = filters.requiresAcknowledgement;

  return (
    <>
      <TopBar title="SOP Library" subtitle="Published Standard Operating Procedures" />
      <div className="p-margin space-y-md">
        <SopFilterRow options={options} showStatus={false} showReviewDue={false} />

        <div className="flex flex-wrap items-center gap-base">
          <div className="flex items-center gap-xs">
            <label htmlFor="sop-sort" className="text-label-sm text-on-surface-variant">
              Sort
            </label>
            {/* A plain link set rather than a <select>, so sorting works with
                JavaScript disabled and each order is a shareable URL. */}
            <div className="flex flex-wrap gap-xs" id="sop-sort">
              {SORTS.map((s) => (
                <Link
                  key={s.value}
                  href={withParam(searchParams, "sort", s.value)}
                  className={
                    "h-8 px-md inline-flex items-center rounded-full border text-label-sm transition " +
                    (sort === s.value
                      ? "bg-primary text-on-primary border-primary"
                      : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
                  }
                >
                  {s.label}
                </Link>
              ))}
            </div>
          </div>

          <Link
            href={withParam(searchParams, "requiresAck", ackOnly ? null : "1")}
            className={
              "h-8 px-md inline-flex items-center gap-xs rounded-full border text-label-sm transition " +
              (ackOnly
                ? "bg-primary text-on-primary border-primary"
                : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
            }
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              how_to_reg
            </span>
            Acknowledgement required
          </Link>
        </div>

        <SopTable
          rows={rows}
          columns="compact"
          emptyTitle="No published SOPs here yet"
          emptyHint="Published SOPs appear here once they go live. Drafts stay in My SOPs until then."
        />
      </div>
    </>
  );
}

/** Rebuild the current query string with one key set or removed. */
function withParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
  value: string | null,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (k === key) continue;
    for (const item of listParam(v)) params.append(k, item);
  }
  if (value !== null) params.set(key, value);
  const qs = params.toString();
  return qs ? `/sop/library?${qs}` : "/sop/library";
}
