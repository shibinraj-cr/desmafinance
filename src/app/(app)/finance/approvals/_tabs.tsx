import Link from "next/link";

export type TabKey = "pending" | "approved" | "rejected" | "my-drafts";

export function Tabs({
  active,
  counts,
  myDrafts,
  preserve,
}: {
  active: TabKey;
  counts: { pending: number; approved: number; rejected: number };
  /** Pass an object to render the "My Drafts" tab. Omit to hide it
   *  (e.g. for reviewers without the draftFirst flag). */
  myDrafts?: { count: number };
  /** Filters to keep in the URL when switching tabs (type / date /
   *  party / category / payment). Omitting them resets the filter
   *  view per tab. */
  preserve?: {
    type?: string;
    from?: string;
    to?: string;
    party?: string;
    category?: string;
    payment?: string;
  };
}) {
  const preservedQs = (() => {
    if (!preserve) return "";
    const qs = new URLSearchParams();
    if (preserve.type && preserve.type !== "all") qs.set("type", preserve.type);
    if (preserve.from) qs.set("from", preserve.from);
    if (preserve.to) qs.set("to", preserve.to);
    if (preserve.party) qs.set("party", preserve.party);
    if (preserve.category) qs.set("category", preserve.category);
    if (preserve.payment) qs.set("payment", preserve.payment);
    const q = qs.toString();
    return q ? `?${q}` : "";
  })();
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
            // My-drafts tab uses its own scope (only the author's
            // drafts) so the cross-tab filters don't apply there.
            href={
              t.key === "my-drafts"
                ? `/finance/approvals/my-drafts`
                : `/finance/approvals/${t.key}${preservedQs}`
            }
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
