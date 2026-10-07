"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export { inputCls, primaryBtn, secondaryBtn, api, Modal } from "../documents/_ui";

/** ₹1,23,456.78 — bank figures are always shown to the paisa. */
export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-06" → "06-Oct-2026" (the bank's own format). */
export function day(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${MONTHS[m - 1]}-${y}`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
}

const TONE: Record<string, string> = {
  green: "bg-green-50 text-green-700 border-green-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  grey: "bg-surface-container text-on-surface-variant border-outline-variant",
};

const STATUS_TONE: Record<string, keyof typeof TONE> = {
  PROCESSED: "green",
  COMPLETED: "green",
  MATCHED: "green",
  NO_TRANSACTIONS: "grey",
  NO_NEW: "grey",
  DUPLICATE: "grey",
  IGNORED: "grey",
  UNMATCHED: "grey",
  REVIEW_REQUIRED: "amber",
  MANUAL_REVIEW: "amber",
  PARTIALLY_MATCHED: "amber",
  COMPLETED_WITH_ERRORS: "amber",
  FAILED: "red",
  MANUAL_ACTION_REQUIRED: "red",
  NEW: "blue",
  EMAIL_FOUND: "blue",
  DOWNLOADING: "blue",
  PDF_DOWNLOADED: "blue",
  PARSING: "blue",
  QUEUED: "blue",
  RUNNING: "blue",
};

export function StatusChip({ status, title }: { status: string; title?: string }) {
  const tone = TONE[STATUS_TONE[status] ?? "grey"];
  return (
    <span
      title={title}
      className={`inline-flex items-center px-sm py-[2px] rounded-full border text-caption font-semibold whitespace-nowrap ${tone}`}
    >
      {status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}

export const TABS = [
  { key: "consolidated", label: "Consolidated", icon: "summarize" },
  { key: "transactions", label: "Transactions", icon: "receipt" },
  { key: "statements", label: "Statements", icon: "description" },
  { key: "automation", label: "Automation", icon: "autorenew" },
  { key: "reconciliation", label: "Reconciliation", icon: "fact_check" },
  { key: "audit", label: "Audit Log", icon: "history" },
] as const;
export type TabKey = (typeof TABS)[number]["key"];

/** Tab strip; keeps the selected account, drops the other tab's filters. */
export function BankTabs({ active }: { active: TabKey }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const account = search.get("account");
  return (
    <nav className="flex items-stretch gap-md border-b border-outline-variant overflow-x-auto scrollbar-thin" aria-label="Bank statements">
      {TABS.map((t) => {
        const params = new URLSearchParams({ tab: t.key, ...(account ? { account } : {}) });
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={`${pathname}?${params.toString()}`}
            aria-current={on ? "page" : undefined}
            className={`flex items-center gap-xs px-xs py-sm border-b-2 text-body-md font-semibold whitespace-nowrap transition ${
              on ? "border-primary text-on-surface" : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Pager({ page, total, pageSize = 50 }: { page: number; total: number; pageSize?: number }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const params = new URLSearchParams(search.toString());
    params.set("page", String(p));
    return `${pathname}?${params.toString()}`;
  };
  return (
    <div className="flex items-center justify-between pt-md text-body-md text-on-surface-variant">
      <span>
        Page {page} of {pages} · {total.toLocaleString("en-IN")} rows
      </span>
      <div className="flex gap-sm">
        {page > 1 && (
          <Link className="px-md py-xs rounded-md border border-outline-variant hover:bg-surface-container" href={href(page - 1)}>
            Previous
          </Link>
        )}
        {page < pages && (
          <Link className="px-md py-xs rounded-md border border-outline-variant hover:bg-surface-container" href={href(page + 1)}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: React.ReactNode }) {
  const cls =
    tone === "error"
      ? "border-l-red-600 bg-red-50 text-red-800"
      : tone === "warn"
        ? "border-l-amber-500 bg-amber-50 text-amber-900"
        : tone === "ok"
          ? "border-l-green-600 bg-green-50 text-green-800"
          : "border-l-primary bg-surface-container-low text-on-surface-variant";
  return <div className={`px-md py-sm rounded-lg border border-outline-variant border-l-4 text-body-md ${cls}`}>{children}</div>;
}

export const th = "text-left font-semibold px-md py-sm whitespace-nowrap";
export const td = "px-md py-sm align-top";
