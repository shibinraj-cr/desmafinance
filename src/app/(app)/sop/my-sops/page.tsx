import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopBar } from "@/components/TopBar";
import { SopTable } from "@/components/sop/SopTable";
import { loadSopAccess } from "@/lib/sop/access";
import { MY_SOP_TABS, MY_SOP_TAB_LABELS, mySopCounts, mySops, type MySopTab } from "@/lib/sop/queries";
import { NotificationPanel } from "./notifications";

export const dynamic = "force-dynamic";

/**
 * My SOPs (§18) — everything that is personally yours, in one place.
 *
 * The six tabs are the six ways an SOP can be "yours": you own it, you wrote
 * it, you have to review it, you have to approve it, you have to acknowledge
 * it, or its review is coming up. Each tab is a separate query rather than one
 * list with a filter, because they answer different questions and only some of
 * them are about SOPs you can edit.
 */
export default async function MySopsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const access = await loadSopAccess();
  if (!access) redirect("/login");

  const tab: MySopTab = MY_SOP_TABS.includes(searchParams.tab as MySopTab)
    ? (searchParams.tab as MySopTab)
    : "to_acknowledge";

  const [counts, rows, notifications] = await Promise.all([
    mySopCounts(access),
    mySops(access, tab),
    prisma.sopNotification.findMany({
      where: { userId: access.userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <>
      <TopBar title="My SOPs" subtitle="Everything waiting on you" />
      <div className="p-margin space-y-lg">
        <NotificationPanel
          notifications={notifications.map((n) => ({
            id: n.id,
            kind: n.kind,
            title: n.title,
            body: n.body,
            linkUrl: n.linkUrl,
            readAt: n.readAt?.toISOString() ?? null,
            createdAt: n.createdAt.toISOString(),
          }))}
        />

        {/* Tabs carry their counts, so you can see there is nothing waiting
            without opening every one. */}
        <div className="flex flex-wrap gap-xs border-b border-outline-variant pb-xs">
          {MY_SOP_TABS.map((t) => (
            <Link
              key={t}
              href={`/sop/my-sops?tab=${t}`}
              className={
                "h-9 px-md inline-flex items-center gap-xs rounded-lg text-label-sm transition " +
                (tab === t
                  ? "bg-surface-container-high text-on-surface font-medium"
                  : "text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              {MY_SOP_TAB_LABELS[t]}
              {counts[t] > 0 && (
                <span className="px-xs rounded-full bg-primary text-on-primary text-caption font-semibold">
                  {counts[t]}
                </span>
              )}
            </Link>
          ))}
        </div>

        {!access.employeeId && (tab === "owned" || tab === "to_acknowledge" || tab === "review_due") && (
          <div className="rounded-xl border border-outline-variant bg-surface-container-low px-lg py-md text-body-sm text-on-surface-variant">
            Your login is not linked to an employee record, so SOPs assigned to you as an employee
            cannot be shown here. Ask HR to link your account.
          </div>
        )}

        <SopTable
          rows={rows}
          columns={tab === "review_due" ? "full" : "compact"}
          emptyTitle={EMPTY_TITLES[tab]}
          emptyHint={EMPTY_HINTS[tab]}
        />
      </div>
    </>
  );
}

const EMPTY_TITLES: Record<MySopTab, string> = {
  owned: "You do not own any SOPs",
  created: "You have not created any SOPs",
  to_review: "Nothing waiting on your review",
  to_approve: "Nothing waiting on your approval",
  to_acknowledge: "Nothing to acknowledge",
  review_due: "No reviews coming up",
};

const EMPTY_HINTS: Record<MySopTab, string> = {
  owned: "SOPs where you are named as the process owner appear here.",
  created: "SOPs you start appear here from the moment they are created.",
  to_review: "When someone sends you an SOP to review, it lands here.",
  to_approve: "When an SOP passes review with you as its approver, it lands here.",
  to_acknowledge: "You are up to date — nothing published to you is awaiting your confirmation.",
  review_due: "SOPs you own are listed here as their review date approaches.",
};
