import Link from "next/link";

export type TabKey = "pending" | "approved" | "rejected" | "my-drafts";

export function Tabs({
  active,
  counts,
  myDrafts,
}: {
  active: TabKey;
  counts: { pending: number; approved: number; rejected: number };
  /** Pass an object to render the "My Drafts" tab. Omit to hide it
   *  (e.g. for reviewers without the draftFirst flag). */
  myDrafts?: { count: number };
}) {
  const tabs: Array<{
    key: TabKey;
    label: string;
    count: number;
    countTone: "amber" | "green" | "red" | "primary";
  }> = [
    { key: "pending", label: "Pending", count: counts.pending, countTone: "amber" },
    { key: "approved", label: "Approved", count: counts.approved, countTone: "green" },
    { key: "rejected", label: "Rejected", count: counts.rejected, countTone: "red" },
  ];
  if (myDrafts) {
    tabs.push({
      key: "my-drafts",
      label: "My Drafts",
      count: myDrafts.count,
      countTone: "primary",
    });
  }
  return (
    <div className="flex flex-wrap items-center gap-xs border-b border-outline-variant">
      {tabs.map((t) => {
        const activeStyles =
          active === t.key
            ? "text-on-surface font-semibold border-primary"
            : "text-on-surface-variant border-transparent hover:text-on-surface";
        const countStyles =
          t.countTone === "amber"
            ? "bg-amber-50 text-amber-800"
            : t.countTone === "green"
              ? "bg-green-50 text-green-700"
              : t.countTone === "red"
                ? "bg-red-50 text-red-700"
                : "bg-primary-container text-on-primary-container";
        return (
          <Link
            key={t.key}
            href={`/finance/approvals/${t.key}`}
            scroll={false}
            className={
              "inline-flex items-center gap-xs h-10 px-md border-b-2 transition " + activeStyles
            }
          >
            <span>{t.label}</span>
            <span
              className={
                "text-[11px] font-bold px-xs py-[1px] rounded-full min-w-[20px] text-center " +
                countStyles
              }
            >
              {t.count}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
