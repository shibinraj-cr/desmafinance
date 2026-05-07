"use client";

import Image from "next/image";
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
        {NAV.map((n) => {
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
              <span className="text-label-sm">{n.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-brand-line pt-base space-y-xs">
        <div className="px-md py-sm">
          <p className="text-label-sm text-on-brand font-semibold truncate">{user.name ?? "User"}</p>
          {user.email && <p className="text-caption text-on-brand-variant truncate">{user.email}</p>}
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
