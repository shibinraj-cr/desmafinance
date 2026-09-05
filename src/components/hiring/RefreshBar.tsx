"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * §7: "Nothing auto-polls." Every hiring rail carries this instead — an
 * explicit refresh and a visible last-read time, so a number on screen is
 * never quietly stale AND never silently re-fetched under the reader.
 *
 * `loadedAt` comes from the server render, so the first stamp is the real
 * query time rather than the moment React hydrated.
 */
export function RefreshBar({ loadedAt, label }: { loadedAt: string; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [stamp, setStamp] = useState(loadedAt);

  return (
    <div className="flex items-center gap-sm text-label-sm text-on-surface-variant">
      <span aria-live="polite">
        {label ? `${label} · ` : ""}Read at {fmt(stamp)} IST
      </span>
      <button
        type="button"
        className="inline-flex items-center gap-xs h-8 px-sm rounded-lg border border-outline-variant hover:bg-surface-container-low transition disabled:opacity-60"
        disabled={pending}
        onClick={() =>
          startTransition(() => {
            router.refresh();
            setStamp(new Date().toISOString());
          })
        }
      >
        <span
          className={"material-symbols-outlined " + (pending ? "animate-spin" : "")}
          style={{ fontSize: 16 }}
          aria-hidden
        >
          refresh
        </span>
        {pending ? "Reading…" : "Refresh"}
      </button>
    </div>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}
