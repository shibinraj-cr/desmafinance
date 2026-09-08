"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TickerItem } from "@/lib/news/read";

/** Remembers a dismissal for the rest of the browser session, per item set. */
const DISMISS_KEY = "dg:announcement-band-dismissed";

/**
 * How many headlines share the strip once celebrations are also on it.
 *
 * The marquee scrolls a fixed distance in a fixed time, so a longer reel does
 * not take longer to read — it moves faster. Past a handful of items the band
 * stops being a glance and becomes something you have to wait out, so the
 * overflow goes to the click-through instead.
 */
const NEWS_LIMIT_ALONGSIDE_CELEBRATIONS = 4;

/** A celebration as the band renders it — no dates, no employee ids. */
export type BandCelebration = {
  id: string;
  kind: "birthday" | "anniversary";
  name: string;
  department: string | null;
  /** Only set when HR has turned age on. */
  age: number | null;
  /** Completed years of service, for an anniversary. */
  years: number | null;
  /** The viewer's own celebration, so the band can say "you". */
  isSelf: boolean;
};

/**
 * A thin band under the header, on every page, carrying whatever the office
 * should know right now: today's birthdays and work anniversaries first, then
 * the news headlines the signed-in user has not read yet.
 *
 * Mounted once in the app layout that wraps every route, so it rides above
 * every module rather than being wired per page. It sits in flow rather than
 * floating, so it pushes content down instead of covering it — and it renders
 * nothing at all when there is nothing to say, which means it costs no vertical
 * space on an ordinary day. The band appearing IS the notification.
 */
export function AnnouncementBand({
  celebrations,
  news,
}: {
  celebrations: BandCelebration[];
  news: TickerItem[];
}) {
  const [dismissed, setDismissed] = useState(false);

  // The dismissal is keyed to the current contents, so closing the band hides
  // what is on it now but a genuinely new item brings it back rather than being
  // silently suppressed by a click from last week.
  const signature = [...celebrations.map((c) => c.id), ...news.map((n) => n.id)].join(",");

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === signature);
    } catch {
      setDismissed(false);
    }
  }, [signature]);

  if ((celebrations.length === 0 && news.length === 0) || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, signature);
    } catch {
      /* private mode — the band simply comes back on the next page */
    }
  }

  const hasCelebrations = celebrations.length > 0;
  const headlines = hasCelebrations
    ? news.slice(0, NEWS_LIMIT_ALONGSIDE_CELEBRATIONS)
    : news;

  // One destination for the whole band rather than a link per item: the reel is
  // moving, and chasing a scrolling target is a worse click than a big one. The
  // leading lane decides where it goes.
  const href = hasCelebrations ? "/me/birthdays" : "/news";
  const label = hasCelebrations
    ? `${celebrations.length} celebration${celebrations.length === 1 ? "" : "s"} today — open Colleague Birthdays`
    : `${news.length} unread update${news.length === 1 ? "" : "s"} — open News and Updates`;

  // Celebrations lead, news follows. Doubled so the marquee can loop seamlessly:
  // the second copy is scrolling into place as the first leaves.
  const reel = [...celebrations, ...headlines];
  const doubled = [...reel, ...reel];

  return (
    <div className="dg-ticker relative flex items-center gap-sm h-9 px-md md:px-margin bg-primary text-on-primary border-b border-black/10 overflow-hidden">
      <span className="hidden sm:inline-flex items-center gap-xs text-[11px] font-bold uppercase tracking-widest flex-shrink-0">
        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
          {hasCelebrations ? "celebration" : "campaign"}
        </span>
        {hasCelebrations ? "Today" : "New"}
      </span>

      <Link href={href} aria-label={label} className="dg-ticker-window flex-1 min-w-0 overflow-hidden">
        <div className="dg-ticker-reel flex items-center gap-xl whitespace-nowrap">
          {doubled.map((item, i) =>
            "kind" in item ? (
              <CelebrationSpan key={`c-${item.id}-${i}`} c={item} />
            ) : (
              <span key={`n-${item.id}-${i}`} className="inline-flex items-center gap-xs text-label-sm">
                <span className="opacity-70">{item.topicName}</span>
                <span aria-hidden className="opacity-50">
                  ·
                </span>
                <span className="font-semibold">{item.title}</span>
              </span>
            ),
          )}
        </div>
      </Link>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide this band"
        title="Hide until there is something new"
        className="grid h-6 w-6 place-items-center rounded flex-shrink-0 hover:bg-black/10 transition"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          close
        </span>
      </button>
    </div>
  );
}

/**
 * The band is brand gold either way, so celebrations are told apart from news
 * by their leading glyph and by reading as a person rather than a headline —
 * not by a second colour competing with the brand.
 */
function CelebrationSpan({ c }: { c: BandCelebration }) {
  const who = c.isSelf ? `${c.name} (you)` : c.name;
  const detail =
    c.kind === "birthday"
      ? [c.age !== null ? `turns ${c.age}` : null, c.department].filter(Boolean).join(" · ")
      : [`${c.years} year${c.years === 1 ? "" : "s"}`, c.department].filter(Boolean).join(" · ");

  return (
    <span className="inline-flex items-center gap-xs text-label-sm">
      <span aria-hidden style={{ fontSize: 14 }}>
        {c.kind === "birthday" ? "🎂" : "🎉"}
      </span>
      <span className="font-semibold">{who}</span>
      {detail ? <span className="opacity-70">{detail}</span> : null}
    </span>
  );
}
