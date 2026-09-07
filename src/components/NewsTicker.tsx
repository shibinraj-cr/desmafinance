"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TickerItem } from "@/lib/news/read";

/** Remembers a dismissal for the rest of the browser session, per headline set. */
const DISMISS_KEY = "dg:news-ticker-dismissed";

/**
 * A thin band under the header, on every page, rolling the headlines the signed-in
 * user has not read yet. Clicking anywhere on it opens News & Updates.
 *
 * It renders nothing when there is nothing unread, so it costs no vertical space
 * on an ordinary day — the band appearing IS the notification.
 */
export function NewsTicker({ items }: { items: TickerItem[] }) {
  const [dismissed, setDismissed] = useState(false);

  // The dismissal is keyed to the current headlines, so closing the band hides
  // today's news but a genuinely new update brings it back rather than being
  // silently suppressed by a click from last week.
  const signature = items.map((i) => i.id).join(",");

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === signature);
    } catch {
      setDismissed(false);
    }
  }, [signature]);

  if (items.length === 0 || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, signature);
    } catch {
      /* private mode — the band simply comes back on the next page */
    }
  }

  // Duplicated so the marquee can loop seamlessly: the second copy is scrolling
  // into place as the first leaves.
  const reel = [...items, ...items];

  return (
    <div className="dg-ticker relative flex items-center gap-sm h-9 px-md md:px-margin bg-primary text-on-primary border-b border-black/10 overflow-hidden">
      <span className="hidden sm:inline-flex items-center gap-xs text-[11px] font-bold uppercase tracking-widest flex-shrink-0">
        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
          campaign
        </span>
        New
      </span>

      <Link
        href="/news"
        aria-label={`${items.length} unread update${items.length === 1 ? "" : "s"} — open News and Updates`}
        className="dg-ticker-window flex-1 min-w-0 overflow-hidden"
      >
        <div className="dg-ticker-reel flex items-center gap-xl whitespace-nowrap">
          {reel.map((item, i) => (
            <span key={`${item.id}-${i}`} className="inline-flex items-center gap-xs text-label-sm">
              <span className="opacity-70">{item.topicName}</span>
              <span aria-hidden className="opacity-50">
                ·
              </span>
              <span className="font-semibold">{item.title}</span>
            </span>
          ))}
        </div>
      </Link>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide new-update band"
        title="Hide until the next update"
        className="grid h-6 w-6 place-items-center rounded flex-shrink-0 hover:bg-black/10 transition"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          close
        </span>
      </button>
    </div>
  );
}
