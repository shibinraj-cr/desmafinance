import { prisma } from "@/lib/prisma";
import {
  parseFeed,
  pageText,
  pageTitle,
  hashString,
  truncate,
  type ParsedFeedItem,
} from "@/lib/news/parse";
import { NEWS_WINDOW_DAYS } from "@/lib/news/constants";

/** How long a single source gets before we give up and move to the next one. */
const FETCH_TIMEOUT_MS = 15_000;
/** Feeds are text; anything past this is not a feed and is not worth buffering. */
const MAX_BYTES = 4_000_000;
/**
 * A source being added today should not dump its entire back catalogue into
 * everyone's unread count. The first run files only the newest few entries;
 * later runs are unbounded, because by then everything they see really is new.
 */
const FIRST_RUN_MAX_ITEMS = 5;
/**
 * Entries older than this are ignored on a first run.
 *
 * Deliberately the SAME window the feed renders (NEWS_WINDOW_DAYS): filing an
 * item older than the window would store something no one can see, and refusing
 * one inside the window would hide something the feed would happily show. Two
 * different numbers here is just a way to be wrong in both directions.
 */
export const FIRST_RUN_MAX_AGE_DAYS = NEWS_WINDOW_DAYS;
/** Per-run ceiling, so one misbehaving feed cannot fill the table. */
const MAX_ITEMS_PER_RUN = 50;

export type SyncResult = {
  sourceId: string;
  sourceName: string;
  status: "ok" | "error" | "empty" | "unchanged";
  /** Items actually filed (already-seen entries do not count). */
  created: number;
  error?: string;
};

/**
 * Reject anything that is not a public http(s) URL before we fetch it.
 *
 * Sources are admin-entered, so this is not the primary defence — but the app
 * runs server-side with network reach a browser would not have, and a typo'd
 * `http://localhost:5432` should fail as a bad URL rather than as an outbound
 * request to our own infrastructure. Hostname-based, so it does not catch a
 * public name that resolves to a private address; that would need a resolve
 * step this does not justify.
 */
export function isFetchableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false;
  if (host === "0.0.0.0" || host === "::1" || host === "::") return false;
  // IPv4 literals in the private / loopback / link-local ranges.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  // IPv6 unique-local / link-local.
  if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^fe80:/i.test(host)) return false;
  return true;
}

/**
 * Turn an HTTP failure into something an admin can act on.
 *
 * "HTTP 403" is true but useless on the Sources page. In practice the common
 * failures have specific, different remedies: a 403 usually means the publisher
 * blocks automated readers and no amount of retrying will help, while a 404
 * usually means the feed moved. Saying which is which is the difference between
 * a fixable link and a mystery.
 */
function httpErrorMessage(status: number, statusText: string): string {
  const base = `HTTP ${status}${statusText ? ` ${statusText}` : ""}`;
  if (status === 401 || status === 403) {
    return `${base} — this site blocks automated readers. Try its official RSS feed address, or follow a different source.`;
  }
  if (status === 404 || status === 410) {
    return `${base} — the link no longer exists. Check the address on the site.`;
  }
  if (status === 429) {
    return `${base} — the site is rate-limiting us. It should recover on the next daily run.`;
  }
  if (status >= 500) {
    return `${base} — the site is having problems. It should recover on the next daily run.`;
  }
  return base;
}

/** GET a URL as text, with a timeout and a size cap. Throws a readable error. */
async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Some publishers serve a bot-block page to an unidentified client.
        "user-agent": "DesGroNewsBot/1.0 (+https://desgro.in)",
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5",
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(httpErrorMessage(res.status, res.statusText));
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len && len > MAX_BYTES) throw new Error(`response too large (${len} bytes)`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error("response too large");
    return text;
  } catch (e) {
    // AbortError's own message ("This operation was aborted") does not say why.
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Items a first run should file: newest few, and nothing stale. */
function firstRunSlice(items: ParsedFeedItem[], now: Date): ParsedFeedItem[] {
  const cutoff = new Date(now.getTime() - FIRST_RUN_MAX_AGE_DAYS * 86_400_000);
  const recent = items.filter((i) => !i.publishedAt || i.publishedAt >= cutoff);
  // Undated entries sort as "now" here only to keep them in view; the caller
  // stamps them with the run time when it files them.
  const sorted = [...recent].sort(
    (a, b) => (b.publishedAt?.getTime() ?? now.getTime()) - (a.publishedAt?.getTime() ?? now.getTime()),
  );
  return sorted.slice(0, FIRST_RUN_MAX_ITEMS);
}

type SourceRow = {
  id: string;
  topicId: string;
  name: string;
  url: string;
  kind: string;
  contentHash: string | null;
  lastFetchedAt: Date | null;
};

/**
 * Pull one source and file whatever is new.
 *
 * Never throws: a source that 404s or serves garbage records the failure on its
 * own row and lets the rest of the run continue. The admin Sources page reads
 * `lastStatus` / `lastError` back, so a quietly-dead link is visible rather than
 * just absent from the feed.
 */
export async function syncSource(source: SourceRow, now = new Date()): Promise<SyncResult> {
  const base = { sourceId: source.id, sourceName: source.name };
  const isFirstRun = source.lastFetchedAt === null;

  const fail = async (message: string): Promise<SyncResult> => {
    await prisma.newsSource
      .update({
        where: { id: source.id },
        data: { lastFetchedAt: now, lastStatus: "error", lastError: truncate(message, 500), lastItemCount: 0 },
      })
      .catch(() => {});
    return { ...base, status: "error", created: 0, error: message };
  };

  if (!isFetchableUrl(source.url)) return fail("not a fetchable public http(s) URL");

  let body: string;
  try {
    body = await fetchText(source.url);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  const hash = hashString(source.kind === "page" ? pageText(body) : body);
  // An unchanged body means nothing to file. On a first run we still parse, so
  // a newly added source is populated immediately instead of on the next change.
  if (!isFirstRun && hash === source.contentHash) {
    await prisma.newsSource
      .update({
        where: { id: source.id },
        data: { lastFetchedAt: now, lastStatus: "ok", lastError: null, lastItemCount: 0 },
      })
      .catch(() => {});
    return { ...base, status: "unchanged", created: 0 };
  }

  let candidates: ParsedFeedItem[];
  if (source.kind === "page") {
    // No feed to read: the change in the page text IS the update. On a first run
    // there is no previous hash to compare against, so we only record the
    // baseline — announcing "updated" the moment a page is added would be a lie.
    if (isFirstRun) {
      await prisma.newsSource
        .update({
          where: { id: source.id },
          data: { lastFetchedAt: now, lastStatus: "ok", lastError: null, lastItemCount: 0, contentHash: hash },
        })
        .catch(() => {});
      return { ...base, status: "ok", created: 0 };
    }
    const title = pageTitle(body) || source.name;
    candidates = [
      {
        title: `${title} — updated`,
        url: source.url,
        summary: truncate(pageText(body), 400),
        publishedAt: now,
        // One item per distinct version of the page, so re-running the cron on
        // an unchanged page cannot file a duplicate.
        guid: `page:${hash}`,
      },
    ];
  } else {
    const parsed = parseFeed(body, source.url);
    if (parsed.length === 0) {
      // A site that has no feed at that address typically answers with its normal
      // web page and a 200, so this is the common misconfiguration, not an edge
      // case — and it has a specific fix, which is worth saying outright.
      const looksLikeHtml = /<html[\s>]/i.test(body);
      const why = looksLikeHtml
        ? "This link returns a web page, not a feed. Switch it to \u201cWatch the page\u201d, or use the site\u2019s RSS address."
        : "No entries found. Check that this is an RSS or Atom feed address.";
      await prisma.newsSource
        .update({
          where: { id: source.id },
          data: {
            lastFetchedAt: now,
            lastStatus: "empty",
            lastError: why,
            lastItemCount: 0,
            contentHash: hash,
          },
        })
        .catch(() => {});
      // Carried on the result too, so the admin adding the link is told why on
      // the spot rather than having to read the row back.
      return { ...base, status: "empty", created: 0, error: why };
    }
    candidates = isFirstRun ? firstRunSlice(parsed, now) : parsed.slice(0, MAX_ITEMS_PER_RUN);

    // A working but quiet feed — every entry older than the window — otherwise
    // reports exactly what a broken one does: "0 updates filed". The admin who
    // just pasted the link cannot tell those apart, and would reasonably assume
    // they got the address wrong. Say which it is.
    if (isFirstRun && candidates.length === 0) {
      const why = `This feed works (${parsed.length} entr${parsed.length === 1 ? "y" : "ies"} read), but nothing was published in the last ${FIRST_RUN_MAX_AGE_DAYS} days. New updates will appear here as the site publishes them.`;
      await prisma.newsSource
        .update({
          where: { id: source.id },
          data: {
            lastFetchedAt: now,
            lastStatus: "ok",
            lastError: null,
            lastItemCount: 0,
            contentHash: hash,
          },
        })
        .catch(() => {});
      return { ...base, status: "ok", created: 0, error: why };
    }
  }

  let created = 0;
  for (const item of candidates) {
    try {
      // createMany+skipDuplicates would be one round trip, but it reports only a
      // total; we want the real count of new items to show on the admin page and
      // to decide whether anything is worth notifying about.
      const existing = await prisma.newsItem.findUnique({
        where: { sourceId_guid: { sourceId: source.id, guid: item.guid } },
        select: { id: true },
      });
      if (existing) continue;
      await prisma.newsItem.create({
        data: {
          topicId: source.topicId,
          sourceId: source.id,
          title: item.title,
          summary: item.summary || null,
          url: item.url || null,
          // An undated entry is stamped with the run time: it is new to us now,
          // and a null date would sort unpredictably against dated entries.
          publishedAt: item.publishedAt ?? now,
          guid: item.guid,
        },
      });
      created++;
    } catch (e) {
      // A single bad entry must not abandon the rest of the feed.
      console.error(`[news] failed to file entry from ${source.name}:`, e);
    }
  }

  await prisma.newsSource
    .update({
      where: { id: source.id },
      data: { lastFetchedAt: now, lastStatus: "ok", lastError: null, lastItemCount: created, contentHash: hash },
    })
    .catch(() => {});

  return { ...base, status: "ok", created };
}

/**
 * Pull every active source on an active topic. Sources run one at a time rather
 * than in parallel: the run is a background cron with no one waiting on it, and
 * serialising keeps us from opening a dozen simultaneous outbound connections
 * on a serverless function.
 */
export async function syncAllSources(opts?: { sourceId?: string }): Promise<{
  ran: number;
  created: number;
  results: SyncResult[];
}> {
  const sources = await prisma.newsSource.findMany({
    where: opts?.sourceId
      ? { id: opts.sourceId }
      : { isActive: true, topic: { isActive: true } },
    select: { id: true, topicId: true, name: true, url: true, kind: true, contentHash: true, lastFetchedAt: true },
    orderBy: { createdAt: "asc" },
  });

  const results: SyncResult[] = [];
  for (const s of sources) results.push(await syncSource(s));

  return {
    ran: results.length,
    created: results.reduce((n, r) => n + r.created, 0),
    results,
  };
}
