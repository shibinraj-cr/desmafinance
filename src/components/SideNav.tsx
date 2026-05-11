"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { canApprove, canSeePage, isAdmin, roleLabel, type Permissions } from "@/lib/rbac";
import { MODULES, type AppModule, moduleForPath } from "@/lib/modules";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  badgeCount?: number | null;
  /** Red-toned secondary badge — used for the signed-in user's
   *  unresolved-rejected approvals queue. */
  warningCount?: number | null;
};

function navForModule(
  mod: AppModule,
  perms: Permissions,
  pendingCount: number,
  rejectedCount: number,
): NavItem[] {
  return mod.pages
    .filter((p) => canSeePage(perms, p.href))
    .map((p) => ({
      href: p.href,
      label: p.label,
      icon: p.icon,
      badgeCount:
        p.href === "/finance/approvals" && canApprove(perms) ? pendingCount : null,
      warningCount:
        p.href === "/finance/approvals" && rejectedCount > 0 ? rejectedCount : null,
    }));
}

/** Modules the user can see (active modules with at least one allowed page, or admin sees all). */
function visibleModules(perms: Permissions): AppModule[] {
  return MODULES.filter((m) => {
    if (m.adminOnly && !isAdmin(perms)) return false;
    // Coming-soon modules: show only to admins so they know what's coming.
    if (m.status === "coming_soon") return isAdmin(perms);
    // Active module: show only if at least one of its pages is in role.pages
    return m.pages.some((p) => canSeePage(perms, p.href));
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
    <nav className="flex-1 mt-base space-y-xs">
      {items.map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
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
              <span className="text-[10px] font-bold bg-primary text-on-primary px-xs py-[1px] rounded-full min-w-[18px] text-center">
                {n.badgeCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function ModuleSwitcher({
  current,
  modules,
  onPick,
}: {
  current: AppModule;
  modules: AppModule[];
  onPick: (m: AppModule) => void;
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
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BrandHeader() {
  return (
    <div className="px-md pt-md pb-sm flex items-center gap-sm">
      <div className="w-10 h-10 rounded-lg overflow-hidden bg-brand-elevated flex items-center justify-center">
        <Image src="/desfin.png" alt="DESFIN" width={40} height={40} className="object-cover" />
      </div>
      <div>
        <h1 className="text-h3 font-bold text-primary leading-tight">DESFIN</h1>
        <p className="text-caption text-on-brand-variant">Desma International</p>
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
}: {
  user: { name?: string | null; email?: string | null };
  perms: Permissions;
  pendingCount: number;
  rejectedCount: number;
}) {
  const pathname = usePathname();

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
  const items = navForModule(activeModule, perms, pendingCount, rejectedCount);

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
      <aside className="hidden md:flex flex-col w-[260px] h-screen sticky top-0 p-md gap-base bg-brand text-on-brand border-r border-brand-line">
        <BrandHeader />
        <ModuleSwitcher current={activeModule} modules={modules} onPick={pickModule} />
        <NavList items={items} pathname={pathname} />
        <UserFooter user={user} perms={perms} />
      </aside>

      <header className="md:hidden sticky top-0 z-40 flex items-center gap-sm h-14 px-md bg-brand text-on-brand border-b border-brand-line">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="p-xs rounded-lg hover:bg-brand-elevated transition"
        >
          <span className="material-symbols-outlined">menu</span>
        </button>
        <div className="w-8 h-8 rounded overflow-hidden bg-brand-elevated flex items-center justify-center">
          <Image src="/desfin.png" alt="DESFIN" width={32} height={32} className="object-cover" />
        </div>
        <span className="text-h3 font-bold text-primary leading-none">DESFIN</span>
        <span className="text-caption text-on-brand-variant ml-xs">· {activeModule.name}</span>
        {canApprove(perms) && pendingCount > 0 && (
          <Link
            href="/finance/approvals"
            className="ml-auto inline-flex items-center gap-xs h-8 px-sm rounded-full bg-primary text-on-primary text-[11px] font-bold"
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
              className="flex flex-col w-[280px] max-w-[85vw] h-full bg-brand text-on-brand border-r border-brand-line p-md gap-base shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <BrandHeader />
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close menu"
                  className="p-xs rounded-lg text-on-brand-variant hover:bg-brand-elevated hover:text-on-brand transition mr-md"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <ModuleSwitcher current={activeModule} modules={modules} onPick={pickModule} />
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
