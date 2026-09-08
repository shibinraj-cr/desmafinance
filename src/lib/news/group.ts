/**
 * Grouping the feed into days.
 *
 * Kept out of the component so the date-boundary behaviour can be tested
 * directly: "Today" and "Yesterday" depend on when you look, which is exactly
 * the kind of logic that is wrong only at midnight and only in one timezone.
 */

/** Anything the feed groups: it just needs a date and a pin flag. */
export type Datable = { publishedAt: string; isPinned: boolean };

export type DaySection<T> = { key: string; heading: string; items: T[] };

/** Calendar-day key in the viewer's own timezone, so days break where they read. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** The heading over a day's updates: "Today", "Yesterday", else the full date. */
export function dayHeading(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Undated";
  if (dayKey(iso) === dayKey(now.toISOString())) return "Today";
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Split the feed into day sections, preserving the order it arrived in (newest
 * first), with pinned updates held out in their own section above.
 *
 * A pinned update is pinned regardless of its date, so filing it under its day
 * would bury it — which is the one thing pinning exists to prevent.
 */
export function groupByDay<T extends Datable>(items: T[], now = new Date()): DaySection<T>[] {
  const pinned = items.filter((i) => i.isPinned);
  const rest = items.filter((i) => !i.isPinned);

  const days = new Map<string, T[]>();
  for (const item of rest) {
    const key = dayKey(item.publishedAt);
    const bucket = days.get(key);
    if (bucket) bucket.push(item);
    else days.set(key, [item]);
  }

  const sections: DaySection<T>[] = [...days.entries()].map(([key, group]) => ({
    key,
    heading: dayHeading(group[0].publishedAt, now),
    items: group,
  }));

  return pinned.length > 0
    ? [{ key: "pinned", heading: "Pinned", items: pinned }, ...sections]
    : sections;
}
