"use client";

// ════════════════════════════════════════════════════════════════════════════
// AppLauncher — an Odoo-style "choose a module" grid that greets the user right
// after they sign in, and can be reopened any time from the sidebar / mobile
// top bar. It lists exactly the modules the signed-in user is allowed to see
// (same rule as the sidebar switcher) and lands them on each module's first
// permitted page.
//
// Wiring:
//   • The login page sets sessionStorage[LAUNCHER_FLAG] = "1" right before it
//     redirects on a successful sign-in; this component reads-and-clears that
//     flag on mount so the launcher pops exactly once per login (not on every
//     navigation).
//   • Any trigger button dispatches window event OPEN_LAUNCHER_EVENT to reopen
//     it — see SideNav's "apps" buttons.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { type Permissions } from "@/lib/rbac";
import { visibleModules, firstAllowedPage, type AppModule } from "@/lib/modules";
import { newsBadgeLabel } from "@/lib/news/constants";

/** Fired by trigger buttons (sidebar / mobile bar) to open the launcher. */
export const OPEN_LAUNCHER_EVENT = "dg:open-launcher";
/** One-shot sessionStorage key the login page sets on a successful sign-in. */
export const LAUNCHER_FLAG = "dg:show-launcher";

/** Convenience helper for trigger buttons elsewhere in the app. */
export function openAppLauncher() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OPEN_LAUNCHER_EVENT));
  }
}

// A saturated accent per module so the grid reads like the colourful Odoo home.
// Rendered as a soft tint behind the icon (hex + "1F" ≈ 12% alpha) with the icon
// itself in the full colour — reads cleanly on both light and dark surfaces.
const MODULE_COLOR: Record<string, string> = {
  executive: "#6366F1", // indigo
  finance: "#10B981", // emerald
  marketing: "#F59E0B", // amber
  crm: "#3B82F6", // blue
  operations: "#8B5CF6", // violet
  hr: "#EC4899", // pink
  me: "#14B8A6", // teal
  news: "#EF4444", // red
  "master-data": "#F97316", // orange
  system: "#64748B", // slate
};
const FALLBACK_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#14B8A6"];

function colorFor(mod: AppModule, index: number): string {
  return MODULE_COLOR[mod.id] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function greeting(): string {
  // Local hour is fine here — this is cosmetic copy, not business logic.
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function ModuleTile({
  mod,
  color,
  onPick,
  unreadCount = 0,
}: {
  mod: AppModule;
  color: string;
  onPick: (m: AppModule) => void;
  /** Unread items behind this module, shown as a corner count. */
  unreadCount?: number;
}) {
  const disabled = mod.status === "coming_soon";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(mod)}
      className={
        "group relative flex flex-col items-center gap-sm rounded-2xl border p-md text-center transition " +
        (disabled
          ? "border-outline-variant bg-surface-container-low opacity-60 cursor-not-allowed"
          : "border-outline-variant bg-surface-container-low hover:bg-surface-container hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40")
      }
    >
      <span
        className="grid place-items-center w-16 h-16 rounded-2xl transition-transform group-hover:scale-105"
        style={{ backgroundColor: `${color}1F`, color }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 34 }}>
          {mod.icon}
        </span>
      </span>
      <span className="text-label-sm font-semibold text-on-surface leading-tight">
        {mod.name}
      </span>
      {disabled && (
        <span className="absolute right-2 top-2 text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
          Soon
        </span>
      )}
      {mod.adminOnly && !disabled && (
        <span className="absolute right-2 top-2 text-[9px] font-bold uppercase tracking-widest text-primary">
          Admin
        </span>
      )}
      {unreadCount > 0 && (
        <span className="absolute left-2 top-2 rounded-full bg-red-500 text-white text-[10px] font-bold tabular-nums px-[6px] py-[1px]">
          {newsBadgeLabel(unreadCount)}
        </span>
      )}
    </button>
  );
}

export function AppLauncher({
  perms,
  userName,
  newsUnreadCount = 0,
}: {
  perms: Permissions;
  userName?: string | null;
  /** Unread News & Updates for the signed-in user, badged on the News tile. */
  newsUnreadCount?: number;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  const modules = useMemo(() => visibleModules(perms), [perms]);
  // First name only keeps the greeting tidy ("Good morning, Shibin").
  const firstName = (userName ?? "").trim().split(/\s+/)[0] || null;

  useEffect(() => setMounted(true), []);

  // Pop once on login, and whenever a trigger button asks us to.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(LAUNCHER_FLAG) === "1") {
        sessionStorage.removeItem(LAUNCHER_FLAG);
        setOpen(true);
      }
    } catch {
      /* sessionStorage unavailable — no auto-open, trigger button still works */
    }
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_LAUNCHER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_LAUNCHER_EVENT, onOpen);
  }, []);

  // Lock body scroll + close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(mod: AppModule) {
    const target = firstAllowedPage(mod, perms);
    setOpen(false);
    if (target) router.push(target.href);
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose a module"
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-[2000] flex items-start md:items-center justify-center overflow-y-auto p-md md:p-lg bg-black/50 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-3xl my-auto rounded-2xl border border-outline-variant bg-surface shadow-2xl p-lg md:p-xl"
        style={{ animation: "crmOverlayIn 260ms cubic-bezier(0.16, 1, 0.3, 1) both" }}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition"
        >
          <span className="material-symbols-outlined">close</span>
        </button>

        <div className="mb-lg pr-10">
          <p className="text-caption uppercase tracking-widest text-on-surface-variant">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </p>
          <h2 className="text-h2 font-bold text-on-surface mt-xs">Where to?</h2>
          <p className="text-body-md text-on-surface-variant mt-xs">
            Pick a module to jump straight in.
          </p>
        </div>

        {modules.length === 0 ? (
          <p className="text-body-md text-on-surface-variant py-lg text-center">
            No modules are available for your account yet.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-md">
            {modules.map((m, i) => (
              <ModuleTile
                key={m.id}
                mod={m}
                color={colorFor(m, i)}
                onPick={pick}
                unreadCount={m.id === "news" ? newsUnreadCount : 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
