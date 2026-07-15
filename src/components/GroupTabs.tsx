"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { canApprove, canSeePage, type Permissions } from "@/lib/rbac";
import { moduleForPath, moduleGroups, moduleHasGroups, activePage } from "@/lib/modules";

/**
 * Horizontal tab strip showing the pages of the currently-active group. The
 * left bar selects a group; this strip is the page-level navigation within it.
 * Renders nothing for ungrouped modules (Executive / System / Master Data),
 * whose pages already sit directly in the left bar.
 */
export function GroupTabs({
  perms,
  pendingCount,
  rejectedCount,
  newLeadsCount,
  notifCount,
}: {
  perms: Permissions;
  pendingCount: number;
  rejectedCount: number;
  newLeadsCount: number;
  notifCount: number;
}) {
  const pathname = usePathname();

  const mod = moduleForPath(pathname);
  if (!mod || !moduleHasGroups(mod)) return null;

  const current = activePage(mod, pathname);
  if (!current) return null;

  const group = moduleGroups(mod).find((g) =>
    g.pages.some((p) => p.href === current.href),
  );
  if (!group) return null;

  const pages = group.pages.filter((p) => canSeePage(perms, p.href));
  if (pages.length === 0) return null;

  return (
    <div className="flex items-center gap-base w-full min-h-[44px] px-md md:px-margin bg-surface border-b border-outline-variant overflow-x-auto scrollbar-thin">
      <span className="text-caption uppercase tracking-widest text-on-surface-variant font-semibold flex-shrink-0 hidden md:inline">
        {group.name}
      </span>
      <nav className="flex items-stretch gap-md">
        {pages.map((p) => {
          const active = current.href === p.href;
          // New-leads badge on the CRM Leads tab; approvals badge on the
          // finance Approvals tab; unread badge on the Notifications tab. A tab
          // shows at most one.
          const tabBadge =
            p.href === "/finance/approvals" && canApprove(perms) && pendingCount > 0
              ? pendingCount
              : p.href === "/crm/leads" && newLeadsCount > 0
                ? newLeadsCount
                : p.href === "/me/notifications" && notifCount > 0
                  ? notifCount
                  : 0;
          const showWarning =
            p.href === "/finance/approvals" && rejectedCount > 0;
          return (
            <Link
              key={p.href}
              href={p.href}
              scroll={false}
              className={
                "inline-flex items-center gap-xs whitespace-nowrap py-sm border-b-2 transition-colors text-label-sm " +
                (active
                  ? "text-on-surface font-semibold border-primary"
                  : "text-on-surface-variant border-transparent hover:text-on-surface")
              }
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                {p.icon}
              </span>
              <span>{p.label}</span>
              {showWarning ? (
                <span
                  title={`${rejectedCount} rejected, awaiting your action`}
                  className="text-[10px] font-bold bg-red-500 text-white px-xs py-[1px] rounded-full min-w-[18px] text-center"
                >
                  {rejectedCount}
                </span>
              ) : null}
              {tabBadge > 0 ? (
                <span
                  title={
                    p.href === "/crm/leads"
                      ? `${tabBadge} new lead${tabBadge === 1 ? "" : "s"} assigned to you`
                      : p.href === "/me/notifications"
                        ? `${tabBadge} unread notification${tabBadge === 1 ? "" : "s"}`
                        : undefined
                  }
                  className="text-[10px] font-bold bg-primary text-on-primary px-xs py-[1px] rounded-full min-w-[18px] text-center"
                >
                  {tabBadge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
