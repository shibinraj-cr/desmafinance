"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const NAV = [
  { href: "/overview", label: "Overview", icon: "dashboard" },
  { href: "/revenue", label: "Revenue", icon: "payments" },
  { href: "/expenses", label: "Expenses", icon: "receipt_long" },
  { href: "/cashflow", label: "Cash Flow", icon: "account_balance" },
  { href: "/daily-tracker", label: "Daily Tracker", icon: "edit_calendar" },
  { href: "/ai-insights", label: "AI Insights", icon: "psychology" },
];

export function SideNav({ user }: { user: { name?: string | null; email?: string | null } }) {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex flex-col w-[260px] h-screen sticky top-0 p-md gap-base bg-surface-container-low border-r border-outline-variant">
      <div className="px-md py-lg flex items-center gap-sm">
        <div className="w-10 h-10 bg-primary flex items-center justify-center rounded-lg">
          <span className="material-symbols-outlined text-on-primary">account_balance</span>
        </div>
        <div>
          <h1 className="text-h3 font-bold text-primary leading-tight">Desma Finance</h1>
          <p className="text-label-sm text-on-surface-variant">International Registry</p>
        </div>
      </div>
      <nav className="flex-1 mt-lg space-y-xs">
        {NAV.map((n) => {
          const active = pathname === n.href || pathname.startsWith(n.href + "/");
          return (
            <Link
              key={n.href}
              href={n.href}
              className={
                "flex items-center gap-md px-md py-sm rounded-lg transition-all " +
                (active
                  ? "bg-primary-container text-on-primary-container font-bold"
                  : "text-on-surface-variant hover:bg-surface-container-high")
              }
            >
              <span className="material-symbols-outlined">{n.icon}</span>
              <span className="text-label-sm">{n.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-outline-variant pt-base space-y-xs">
        <div className="px-md py-sm">
          <p className="text-label-sm text-on-surface font-semibold truncate">{user.name ?? "User"}</p>
          {user.email && <p className="text-caption text-on-surface-variant truncate">{user.email}</p>}
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-md px-md py-sm rounded-lg text-on-surface-variant hover:bg-surface-container-high transition"
        >
          <span className="material-symbols-outlined">logout</span>
          <span className="text-label-sm">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
