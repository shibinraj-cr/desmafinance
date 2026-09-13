import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { SopTable } from "@/components/sop/SopTable";
import { SopFilterRow } from "@/components/sop/SopFilterRow";
import { loadSopAccess } from "@/lib/sop/access";
import { dashboardCounts, filterOptions, listSops, type SopFilters } from "@/lib/sop/queries";
import { listParam, oneParam } from "@/lib/filter-params";
import { NoAccess } from "../_no-access";

export const dynamic = "force-dynamic";

/**
 * The SOP dashboard (§1): eight summary cards over the filterable register.
 *
 * A server component that re-queries on every filter change, so a filtered
 * view is a shareable URL and the numbers can never disagree with the table
 * below them — both come from the same visibility-scoped where clause.
 */
export default async function SopDashboardPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const access = await loadSopAccess();
  if (!access) redirect("/login");

  // The dashboard is the module's governance view; plain readers get the
  // library instead of an empty register.
  if (!access.canCreate && !access.isGovernance && !access.isSopAdmin) {
    return (
      <NoAccess
        title="SOP Dashboard"
        message="The SOP dashboard is for SOP authors and reviewers. You can read every SOP published to you in the SOP Library."
        cta={{ href: "/sop/library", label: "Go to the SOP Library" }}
      />
    );
  }

  const filters: SopFilters = {
    search: oneParam(searchParams.q),
    departmentIds: listParam(searchParams.department),
    ownerEmployeeIds: listParam(searchParams.owner),
    statuses: listParam(searchParams.status),
    categoryIds: listParam(searchParams.category),
    createdByIds: listParam(searchParams.createdBy),
    reviewDue: oneParam(searchParams.reviewDue),
    effectiveFrom: parseDate(oneParam(searchParams.from)),
    effectiveTo: parseDate(oneParam(searchParams.to)),
  };

  const [counts, { rows }, options] = await Promise.all([
    dashboardCounts(access),
    listSops(access, filters, { sort: "recent" }),
    filterOptions(access),
  ]);

  const cards = [
    { label: "Total SOPs", value: counts.total, icon: "description", href: "/sop/library" },
    { label: "Published", value: counts.published, icon: "task_alt", href: "/sop/dashboard?status=published" },
    { label: "Draft", value: counts.draft, icon: "edit_note", href: "/sop/dashboard?status=draft" },
    {
      label: "Under review",
      value: counts.underReview,
      icon: "rate_review",
      href: "/sop/dashboard?status=review_requested",
    },
    {
      label: "Approval pending",
      value: counts.approvalPending,
      icon: "approval",
      href: "/sop/dashboard?status=approval_pending",
    },
    { label: "Review due", value: counts.reviewDue, icon: "event_repeat", href: "/sop/dashboard?reviewDue=any" },
    {
      label: "Overdue reviews",
      value: counts.overdueReviews,
      icon: "warning",
      href: "/sop/dashboard?reviewDue=overdue",
      alert: counts.overdueReviews > 0,
    },
    {
      label: "Need acknowledgement",
      value: counts.requiringAcknowledgement,
      icon: "how_to_reg",
      href: "/sop/acknowledgements",
    },
  ];

  return (
    <>
      <TopBar
        title="SOP Dashboard"
        subtitle="Standard Operating Procedures"
        action={
          access.canCreate ? (
            <Link
              href="/sop/create"
              className="h-10 px-lg inline-flex items-center gap-xs rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                add
              </span>
              New SOP
            </Link>
          ) : null
        }
      />

      <div className="p-margin space-y-lg">
        {/* Compact tiles, not the large hero cards §25 warns against: eight
            numbers have to fit above the register without pushing it off screen. */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-base">
          {cards.map((c) => (
            <Link
              key={c.label}
              href={c.href}
              className={
                "rounded-xl border bg-surface-container-lowest p-md hover:bg-surface-container-low transition " +
                (c.alert ? "border-error" : "border-outline-variant")
              }
            >
              <div className="flex items-center gap-xs text-on-surface-variant">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                  {c.icon}
                </span>
                <span className="text-label-sm">{c.label}</span>
              </div>
              <div className={"text-h2 mt-xs " + (c.alert ? "text-error" : "text-on-surface")}>{c.value}</div>
            </Link>
          ))}
        </div>

        <div className="space-y-md">
          <SopFilterRow options={options} />
          <SopTable
            rows={rows}
            emptyTitle="No SOPs match these filters"
            emptyHint="Clear a filter, or create the first SOP for this department."
          />
        </div>
      </div>
    </>
  );
}

function parseDate(v: string | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}
