"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { canApprove, canSeePage, roleLabel, type Permissions } from "@/lib/rbac";
import { APP_PAGES } from "@/lib/pages";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  badgeCount?: number | null;
};

function buildNav(perms: Permissions, pendingCount: number): NavItem[] {
  return APP_PAGES.filter((p) => canSeePage(perms, p.href)).map((p) => ({
    href: p.href,
    label: p.label,
    icon: p.icon,
    badgeCount: p.href === "/approvals" && canApprove(perms) ? pendingCount : null,
  }));
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

function BrandHeader() {
  return (
    <div className="px-md pt-md pb-lg flex items-center gap-sm">
      <div className="w-12 h-12 rounded-lg overflow-hidden bg-brand-elevated flex items-center justify-center">
        <Image src="/desfin.png" alt="DESFIN" width={48} height={48} className="object-cover" />
      </div>
      <div>
        <h1 className="text-h3 font-bold text-primary leading-tight">DESFIN</h1>
        <p className="text-label-sm text-on-brand-variant">Desma International</p>
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
}: {
  user: { name?: string | null; email?: string | null };
  perms: Permissions;
  pendingCount: number;
}) {
  const pathname = usePathname();
  const items = buildNav(perms, pendingCount);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  return (
    <>
      <aside className="hidden md:flex flex-col w-[260px] h-screen sticky top-0 p-md gap-base bg-brand text-on-brand border-r border-brand-line">
        <BrandHeader />
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
        {canApprove(perms) && pendingCount > 0 && (
          <Link
            href="/approvals"
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
