"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { canApprove, canManageUsers, roleLabel } from "@/lib/rbac";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  badgeCount?: number | null;
  show?: boolean;
};

export function SideNav({
  user,
  pendingCount,
}: {
  user: { name?: string | null; email?: string | null; role?: string | null };
  pendingCount: number;
}) {
  const pathname = usePathname();
  const role = user.role ?? "executive";

  const NAV: NavItem[] = [
    { href: "/overview", label: "Overview", icon: "dashboard", show: true },
    { href: "/revenue", label: "Revenue", icon: "payments", show: true },
    { href: "/expenses", label: "Expenses", icon: "receipt_long", show: true },
    { href: "/cashflow", label: "Cash Flow", icon: "account_balance", show: true },
    { href: "/daily-tracker", label: "Daily Tracker", icon: "edit_calendar", show: true },
    {
      href: "/approvals",
      label: "Approvals",
      icon: "rule",
      badgeCount: canApprove(role) ? pendingCount : null,
      show: true,
    },
    { href: "/ai-insights", label: "AI Insights", icon: "psychology", show: true },
    {
      href: "/users",
      label: "User Management",
      icon: "manage_accounts",
      show: canManageUsers(role),
    },
  ];

  return (
    <aside className="hidden md:flex flex-col w-[260px] h-screen sticky top-0 p-md gap-base bg-brand text-on-brand border-r border-brand-line">
      <div className="px-md pt-md pb-lg flex items-center gap-sm">
        <div className="w-12 h-12 rounded-lg overflow-hidden bg-brand-elevated flex items-center justify-center">
          <Image src="/desfin.png" alt="DESFIN" width={48} height={48} className="object-cover" />
        </div>
        <div>
          <h1 className="text-h3 font-bold text-primary leading-tight">DESFIN</h1>
          <p className="text-label-sm text-on-brand-variant">Desma International</p>
        </div>
      </div>
      <nav className="flex-1 mt-base space-y-xs">
        {NAV.filter((n) => n.show).map((n) => {
          const active = pathname === n.href || pathname.startsWith(n.href + "/");
          return (
            <Link
              key={n.href}
              href={n.href}
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
      <div className="mt-auto border-t border-brand-line pt-base space-y-xs">
        <div className="px-md py-sm">
          <p className="text-label-sm text-on-brand font-semibold truncate">{user.name ?? "User"}</p>
          <p className="text-caption text-on-brand-variant truncate">
            {roleLabel(role)}
            {user.email ? ` · ${user.email}` : ""}
          </p>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-md px-md py-sm rounded-lg text-on-brand-variant hover:bg-brand-elevated hover:text-on-brand transition"
        >
          <span className="material-symbols-outlined">logout</span>
          <span className="text-label-sm">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
