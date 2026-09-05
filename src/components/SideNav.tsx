"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { canApprove, canSeePage, roleLabel, type Permissions } from "@/lib/rbac";
import {
  MODULES,
  type AppModule,
  moduleForPath,
  moduleGroups,
  moduleHasGroups,
  activePage,
  visibleModules,
} from "@/lib/modules";
import { openAppLauncher } from "@/components/AppLauncher";
import { newsBadgeLabel } from "@/lib/news/constants";
import { useWaLiveCount, type WaLiveCounts } from "@/components/wa-live-count";

/** Hover text for the WhatsApp badge: what the number is, and the desk behind it. */
function waBadgeTitle(wa: WaLiveCounts | null): string | undefined {
  if (!wa || wa.waiting === 0) return undefined;
  return `${wa.waiting} waiting on a reply · ${wa.count} open chats`;
}

type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** Cosmetic sidebar section header this item sits under (e.g. "LEAVE"). */
  group?: string;
  /** Explicit active state. When omitted, NavList derives it from the path. */
  active?: boolean;
  badgeCount?: number | null;
  /** Green badge instead of the default amber — WhatsApp's unanswered count
   *  keeps the channel's own colour so it reads as a queue, not a page count. */
  badgeTone?: "primary" | "whatsapp";
  /** Hover text for the badge, when the number alone is not self-explanatory. */
  badgeTitle?: string;
  /** Red-toned secondary badge — used for the signed-in user's
   *  unresolved-rejected approvals queue. */
  warningCount?: number | null;
};

function navForModule(
  mod: AppModule,
  perms: Permissions,
  pendingCount: number,
  rejectedCount: number,
  newLeadsCount: number,
  myOpenTasksCount: number,
  crmNotifCount: number,
  waWaiting: WaLiveCounts | null,
  newsUnreadCount: number,
): NavItem[] {
  return mod.pages
    .filter((p) => canSeePage(perms, p.href))
    .map((p) => ({
      href: p.href,
      label: p.label,
      icon: p.icon,
      group: p.group,
      badgeCount:
        p.href === "/finance/approvals" && canApprove(perms)
          ? pendingCount
          : p.href === "/crm/leads"
            ? newLeadsCount
            : p.href === "/operations/my-tasks"
              ? myOpenTasksCount
              : p.href === "/crm/notifications"
                ? crmNotifCount
                : p.href === "/crm/inbox"
                  ? (waWaiting?.waiting ?? null)
                  : p.href === "/news"
                    ? newsUnreadCount
                    : null,
      badgeTone: p.href === "/crm/inbox" ? ("whatsapp" as const) : undefined,
      badgeTitle: p.href === "/crm/inbox" ? waBadgeTitle(waWaiting) : undefined,
      warningCount:
        p.href === "/finance/approvals" && rejectedCount > 0 ? rejectedCount : null,
    }));
}

/**
 * Left-bar items for a module that organizes its pages into groups: one item
 * per group (PEOPLE, LEAVE, …). Clicking a group lands on its first allowed
 * page; the group is active when the current page belongs to it. Groups whose
 * pages are all hidden by permissions are dropped.
 */
function groupNavForModule(
  mod: AppModule,
  perms: Permissions,
  pathname: string,
  pendingCount: number,
  rejectedCount: number,
  newLeadsCount: number,
  myOpenTasksCount: number,
  crmNotifCount: number,
  waWaiting: WaLiveCounts | null,
  newsUnreadCount: number,
): NavItem[] {
  const current = activePage(mod, pathname);
  return moduleGroups(mod)
    .map((g) => ({ ...g, pages: g.pages.filter((p) => canSeePage(perms, p.href)) }))
    .filter((g) => g.pages.length > 0)
    .map((g) => {
      const first = g.pages[0];
      const hasApprovals = g.pages.some((p) => p.href === "/finance/approvals");
      // The CRM "Pipeline" group leads with /crm/leads — badge it with the
      // signed-in BDE's count of fresh, not-yet-worked leads.
      const hasNewLeads = g.pages.some((p) => p.href === "/crm/leads");
      // The Operations "Work" group holds My Tasks — badge it with the user's
      // open-task count.
      const hasMyTasks = g.pages.some((p) => p.href === "/operations/my-tasks");
      // The CRM "NOTIFICATIONS" group holds /crm/notifications — badge it with
      // the signed-in user's unread CRM-notification count.
      const hasNotifs = g.pages.some((p) => p.href === "/crm/notifications");
      // The CRM "WHATSAPP" group leads with the inbox — badge it with the live
      // count of threads waiting on a reply, in place of the thread-list panel
      // that used to sit at the bottom of the rail.
      const hasInbox = g.pages.some((p) => p.href === "/crm/inbox");
      // The News "UPDATES" group leads with the feed — badge it with the
      // signed-in user's unread count.
      const hasNews = g.pages.some((p) => p.href === "/news");
      return {
        href: first.href,
        label: g.name,
        icon: first.icon,
        active: !!current && g.pages.some((p) => p.href === current.href),
        badgeCount: hasApprovals && canApprove(perms) ? pendingCount : hasNewLeads ? newLeadsCount : hasMyTasks ? myOpenTasksCount : hasNotifs ? crmNotifCount : hasInbox ? (waWaiting?.waiting ?? null) : hasNews ? newsUnreadCount : null,
        badgeTone: hasInbox ? ("whatsapp" as const) : undefined,
        badgeTitle: hasInbox ? waBadgeTitle(waWaiting) : undefined,
        warningCount: hasApprovals && rejectedCount > 0 ? rejectedCount : null,
      };
    });
}

function NavList({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    // `min-h-0` is required so this flex child can shrink past its
    // content height — otherwise the long nav list pushes the user
    // footer off-screen instead of scrolling internally.
    <nav className="flex-1 min-h-0 mt-base space-y-xs overflow-y-auto pr-xs scrollbar-thin">
      {items.map((n) => {
        const active = n.active ?? (pathname === n.href || pathname.startsWith(n.href + "/"));
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            className={
              "flex items-center gap-md px-md py-sm rounded-lg transition-all " +
              (active
                ? "bg-primary text-on-primary font-bold"
                : "text-on-brand-variant hover:bg-brand-elevated hover:text-on-brand")
            }
          >
            <span className="material-symbols-outlined">{n.icon}</span>
            <span className="text-label-sm flex-1">{n.label}</span>
            {n.warningCount && n.warningCount > 0 ? (
              <span
                title={`${n.warningCount} rejected, awaiting your action`}
                className="text-[10px] font-bold bg-red-500 text-white px-xs py-[1px] rounded-full min-w-[18px] text-center"
              >
                {n.warningCount}
              </span>
            ) : null}
            {n.badgeCount && n.badgeCount > 0 ? (
              <span
                title={n.badgeTitle}
                className={
                  "text-[10px] font-bold px-xs py-[1px] rounded-full min-w-[18px] text-center tabular-nums " +
                  (n.badgeTone === "whatsapp"
                    ? "bg-emerald-500 text-white"
                    : "bg-primary text-on-primary")
                }
              >
                {n.badgeCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The unread-updates indicator, and the reason it does not live in the nav list.
 *
 * The left bar only ever shows the ACTIVE module's pages, so a badge on the News
 * nav item is invisible to someone working in CRM or HR — which is everyone,
 * most of the time. A company announcement nobody is told about is not an
 * announcement, so this sits in the header instead: always rendered, whichever
 * module is open.
 */
function NewsButton({
  unread,
  onNavigate,
  className,
}: {
  unread: number;
  onNavigate?: () => void;
  className?: string;
}) {
  const has = unread > 0;
  return (
    <Link
      href="/news"
      onClick={onNavigate}
      title={has ? `${unread} unread update${unread === 1 ? "" : "s"}` : "News & Updates"}
      aria-label={has ? `News and Updates, ${unread} unread` : "News and Updates"}
      className={
        "relative grid h-9 w-9 place-items-center rounded-lg text-on-brand-variant hover:bg-brand-elevated hover:text-on-brand transition " +
        (className ?? "")
      }
    >
      <span className="material-symbols-outlined">newspaper</span>
      {has && (
        <span
          className={
            "absolute -top-1 -right-1 rounded-full bg-red-500 text-white text-[10px] font-bold tabular-nums text-center leading-[16px] h-4 " +
            // A single digit stays a circle; wider counts grow into a pill.
            (unread < 10 ? "w-4" : "min-w-[20px] px-[3px]")
          }
        >
          {newsBadgeLabel(unread)}
        </span>
      )}
    </Link>
  );
}

function ModuleSwitcher({
  current,
  modules,
  onPick,
  newsUnreadCount,
}: {
  current: AppModule;
  modules: AppModule[];
  onPick: (m: AppModule) => void;
  newsUnreadCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-sm px-md py-sm rounded-lg bg-brand-elevated hover:bg-brand-line transition text-on-brand"
      >
        <span className="material-symbols-outlined text-primary">{current.icon}</span>
        <span className="text-label-sm font-bold flex-1 text-left">{current.name}</span>
        <span className="material-symbols-outlined text-on-brand-variant" style={{ fontSize: 18 }}>
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 mt-xs bg-brand-elevated border border-brand-line rounded-lg shadow-2xl overflow-hidden z-50">
          {modules.map((m) => {
            const disabled = m.status === "coming_soon";
            const active = m.id === current.id;
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  onPick(m);
                  setOpen(false);
                }}
                className={
                  "w-full flex items-center gap-sm px-md py-sm text-left transition " +
                  (active
                    ? "bg-primary text-on-primary"
                    : disabled
                      ? "text-on-brand-variant opacity-50 cursor-not-allowed"
                      : "text-on-brand hover:bg-brand-line")
                }
              >
                <span className="material-symbols-outlined">{m.icon}</span>
                <span className="text-label-sm font-semibold flex-1">{m.name}</span>
                {disabled && (
                  <span className="text-[10px] uppercase tracking-widest text-on-brand-variant">
                    Soon
                  </span>
                )}
                {m.adminOnly && !disabled && (
                  <span className="text-[10px] uppercase tracking-widest text-primary">
                    Admin
                  </span>
                )}
                {m.id === "news" && newsUnreadCount > 0 && (
                  <span className="text-[10px] font-bold tabular-nums bg-red-500 text-white px-xs py-[1px] rounded-full min-w-[18px] text-center">
                    {newsBadgeLabel(newsUnreadCount)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BrandHeader({ newsUnreadCount }: { newsUnreadCount: number }) {
  return (
    <div className="px-md pt-md pb-sm flex items-center gap-sm">
      <div className="w-10 h-10 rounded-lg overflow-hidden bg-brand-elevated flex items-center justify-center">
        <Image
          src="/desgro-icon.png"
          alt="Desgro"
          width={40}
          height={40}
          className="object-contain"
        />
      </div>
      <div className="flex flex-col">
        <Image
          src="/desgro-letters.png"
          alt="DESGRO"
          width={140}
          height={24}
          className="object-contain"
          style={{ width: "auto", height: "24px" }}
          priority
        />
        <p className="text-caption text-on-brand-variant mt-[2px]">Desma International</p>
      </div>
      <div className="ml-auto flex items-center gap-xs">
        <NewsButton unread={newsUnreadCount} />
        <button
          type="button"
          onClick={openAppLauncher}
          title="All modules"
          aria-label="Open the module launcher"
          className="grid h-9 w-9 place-items-center rounded-lg text-on-brand-variant hover:bg-brand-elevated hover:text-on-brand transition"
        >
          <span className="material-symbols-outlined">grid_view</span>
        </button>
      </div>
    </div>
  );
}

function UserFooter({
  user,
  perms,
  onNavigate,
}: {
  user: { name?: string | null; email?: string | null };
  perms: Permissions;
  onNavigate?: () => void;
}) {
  return (
    <div className="mt-auto border-t border-brand-line pt-base space-y-xs">
      <div className="px-md py-sm">
        <p className="text-label-sm text-on-brand font-semibold truncate">{user.name ?? "User"}</p>
        <p className="text-caption text-on-brand-variant truncate">
          {roleLabel(perms.roleName)}
          {user.email ? ` · ${user.email}` : ""}
        </p>
      </div>
      <Link
        href="/me/account"
        onClick={onNavigate}
        className="w-full flex items-center gap-md px-md py-sm rounded-lg text-on-brand-variant hover:bg-brand-elevated hover:text-on-brand transition"
      >
        <span className="material-symbols-outlined">password</span>
        <span className="text-label-sm">Change password</span>
      </Link>
      <button
        onClick={() => {
          onNavigate?.();
          signOut({ callbackUrl: "/login" });
        }}
        className="w-full flex items-center gap-md px-md py-sm rounded-lg text-on-brand-variant hover:bg-brand-elevated hover:text-on-brand transition"
      >
        <span className="material-symbols-outlined">logout</span>
        <span className="text-label-sm">Sign out</span>
      </button>
    </div>
  );
}

export function SideNav({
  user,
  perms,
  pendingCount,
  rejectedCount,
  newLeadsCount,
  myOpenTasksCount,
  crmNotifCount,
  newsUnreadCount,
}: {
  user: { name?: string | null; email?: string | null };
  perms: Permissions;
  pendingCount: number;
  rejectedCount: number;
  newLeadsCount: number;
  myOpenTasksCount: number;
  crmNotifCount: number;
  newsUnreadCount: number;
}) {
  const pathname = usePathname();

  // Polled only for users who can open the inbox — everyone else never asks.
  const waLive = useWaLiveCount(canSeePage(perms, "/crm/inbox"));

  const modules = useMemo(() => visibleModules(perms), [perms]);

  // Active module is the one that owns the current pathname (System for /users
  // and /roles), falling back to the first visible module.
  const initialModule = useMemo(() => {
    const owned = moduleForPath(pathname);
    if (owned && modules.some((m) => m.id === owned.id)) return owned;
    return modules[0] ?? MODULES[0];
  }, [pathname, modules]);

  const [activeModuleId, setActiveModuleId] = useState(initialModule.id);
  useEffect(() => {
    setActiveModuleId(initialModule.id);
  }, [initialModule.id]);

  const activeModule =
    modules.find((m) => m.id === activeModuleId) ?? initialModule;
  // Grouped modules list their groups in the left bar (pages live in the top
  // tab strip); ungrouped modules keep the flat page list.
  const items = moduleHasGroups(activeModule)
    ? groupNavForModule(activeModule, perms, pathname, pendingCount, rejectedCount, newLeadsCount, myOpenTasksCount, crmNotifCount, waLive, newsUnreadCount)
    : navForModule(activeModule, perms, pendingCount, rejectedCount, newLeadsCount, myOpenTasksCount, crmNotifCount, waLive, newsUnreadCount);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  function pickModule(m: AppModule) {
    setActiveModuleId(m.id);
    // If the chosen module has at least one allowed page, navigate to its first
    // page so the user lands somewhere meaningful.
    const firstPage = m.pages.find((p) => canSeePage(perms, p.href));
    if (firstPage && firstPage.href !== pathname) {
      // Use a hard navigation to ensure the layout re-renders cleanly.
      window.location.href = firstPage.href;
    }
  }

  return (
    <>
      <aside className="dg-rail hidden md:flex flex-col w-[260px] h-screen sticky top-0 p-md gap-base bg-brand text-on-brand border-r border-brand-line">
        <BrandHeader newsUnreadCount={newsUnreadCount} />
        <ModuleSwitcher
          current={activeModule}
          modules={modules}
          onPick={pickModule}
          newsUnreadCount={newsUnreadCount}
        />
        <NavList items={items} pathname={pathname} />
        <UserFooter user={user} perms={perms} />
      </aside>

      <header className="dg-rail md:hidden sticky top-0 z-40 flex items-center gap-sm h-14 px-md bg-brand text-on-brand border-b border-brand-line">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="p-xs rounded-lg hover:bg-brand-elevated transition"
        >
          <span className="material-symbols-outlined">menu</span>
        </button>
        <button
          type="button"
          onClick={openAppLauncher}
          aria-label="Open the module launcher"
          className="p-xs rounded-lg hover:bg-brand-elevated transition"
        >
          <span className="material-symbols-outlined">grid_view</span>
        </button>
        <div className="w-8 h-8 rounded overflow-hidden bg-brand-elevated flex items-center justify-center">
          <Image
            src="/desgro-icon.png"
            alt="Desgro"
            width={32}
            height={32}
            className="object-contain"
          />
        </div>
        <Image
          src="/desgro-letters.png"
          alt="DESGRO"
          width={117}
          height={20}
          className="object-contain"
          style={{ width: "auto", height: "20px" }}
        />
        <span className="text-caption text-on-brand-variant ml-xs">· {activeModule.name}</span>
        <NewsButton unread={newsUnreadCount} className="ml-auto" />
        {canApprove(perms) && pendingCount > 0 && (
          <Link
            href="/finance/approvals"
            className="inline-flex items-center gap-xs h-8 px-sm rounded-full bg-primary text-on-primary text-[11px] font-bold"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              rule
            </span>
            {pendingCount}
          </Link>
        )}
      </header>

      {mounted &&
        drawerOpen &&
        createPortal(
          <div
            className="md:hidden fixed inset-0 z-[1000] bg-black/50"
            onClick={() => setDrawerOpen(false)}
          >
            <aside
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
              className="dg-rail flex flex-col w-[280px] max-w-[85vw] h-full bg-brand text-on-brand border-r border-brand-line p-md gap-base shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <BrandHeader newsUnreadCount={newsUnreadCount} />
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close menu"
                  className="p-xs rounded-lg text-on-brand-variant hover:bg-brand-elevated hover:text-on-brand transition mr-md"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <ModuleSwitcher
                current={activeModule}
                modules={modules}
                onPick={pickModule}
                newsUnreadCount={newsUnreadCount}
              />
              <NavList
                items={items}
                pathname={pathname}
                onNavigate={() => setDrawerOpen(false)}
              />
              <UserFooter user={user} perms={perms} onNavigate={() => setDrawerOpen(false)} />
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}
