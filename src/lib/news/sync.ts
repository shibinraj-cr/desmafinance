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
import { newsWindowStart } from "@/lib/news/read";
import {
  shareIdFrom,
  shareApiUrl,
  assistantMessages,
  conversationTitle,
  splitIntoItems,
} from "@/lib/news/chatgpt";

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
/**
 * The same ceiling for a shared ChatGPT chat, set far higher.
 *
 * 50 is an anti-runaway guard against a feed we do not control. A shared chat is
 * the opposite: one document an admin curated and pasted on purpose, often
 * carrying weeks of accumulated updates they want backfilled. Worse, the low cap
 * was not merely a trim — the leftovers were unreachable, because the next run
 * sees an unchanged conversation, short-circuits, and files nothing further. So
 * anything past the cap was silently lost for good, not deferred.
 */
const CHATGPT_MAX_ITEMS_PER_RUN = 500;

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

/**
 * The assistant's answers in a shared conversation, concatenated — the part of
 * the payload that is actually the news. Returns "" when the payload cannot be
 * read at all, which the caller reports as an unusable source.
 */
function chatGptContentFor(body: string): string {
  try {
    return assistantMessages(JSON.parse(body))
      .map((m) => m.text)
      .join("\n\n");
  } catch {
    return "";
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

  // A ChatGPT share page renders client-side, so the URL the admin pasted is not
  // the URL that holds the conversation. Read its data endpoint instead.
  let fetchUrl = source.url;
  if (source.kind === "chatgpt") {
    const shareId = shareIdFrom(source.url);
    if (!shareId) {
      return fail(
        "That is not a ChatGPT share link. Use the link from ChatGPT\u2019s Share button \u2014 it looks like https://chatgpt.com/share/\u2026",
      );
    }
    fetchUrl = shareApiUrl(shareId);
  }

  let body: string;
  try {
    body = await fetchText(fetchUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The share endpoint answers 404 both for a wrong id and for a conversation
    // whose sharing was turned off — the second is much likelier here, and the
    // fix is different, so name it.
    if (source.kind === "chatgpt" && /HTTP 404/.test(msg)) {
      return fail(
        "This shared chat is no longer public. Re-share it in ChatGPT and paste the new link.",
      );
    }
    return fail(msg);
  }

  // Hash what we actually publish from, not the envelope around it. A share
  // payload carries view counts and moderation fields that churn between reads;
  // hashing the raw JSON would report an update every single day.
  const hash = hashString(
    source.kind === "page"
      ? pageText(body)
      : source.kind === "chatgpt"
        ? chatGptContentFor(body)
        : body,
  );
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
  /** Set when a chat carried more updates than one import can take. */
  let truncatedFrom = 0;
  if (source.kind === "chatgpt") {
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return fail("ChatGPT returned something this can\u2019t read. The share link may have expired.");
    }

    const answers = assistantMessages(payload);
    if (answers.length === 0) {
      const why =
        "This shared chat has no answer in it yet \u2014 share it again once ChatGPT has replied.";
      await prisma.newsSource
        .update({
          where: { id: source.id },
          data: { lastFetchedAt: now, lastStatus: "empty", lastError: why, lastItemCount: 0, contentHash: hash },
        })
        .catch(() => {});
      return { ...base, status: "empty", created: 0, error: why };
    }

    const cutoff = newsWindowStart(now);
    candidates = answers.flatMap((answer) =>
      splitIntoItems(answer.text).map((item) => ({
        title: item.title,
        url: item.url,
        summary: item.summary,
        // The chat's own timestamp when it is recent enough for the feed to show
        // it; otherwise the run time. An admin who pastes an older conversation
        // means "publish this now" — filing it outside the window would accept
        // the link and then show nothing, which reads as a broken import.
        publishedAt: answer.createdAt && answer.createdAt >= cutoff ? answer.createdAt : now,
        guid: item.guid,
      })),
    );

    if (candidates.length === 0) {
      const why = "Nothing could be pulled out of that chat\u2019s answer.";
      await prisma.newsSource
        .update({
          where: { id: source.id },
          data: { lastFetchedAt: now, lastStatus: "empty", lastError: why, lastItemCount: 0, contentHash: hash },
        })
        .catch(() => {});
      return { ...base, status: "empty", created: 0, error: why };
    }

    // No first-run age filter here, unlike a feed: the admin pasted this link
    // deliberately, so its contents are new to the company whatever their date.
    if (candidates.length > CHATGPT_MAX_ITEMS_PER_RUN) {
      // Never truncate in silence. The dropped entries cannot be recovered on a
      // later run, so the admin has to be told to split the conversation up.
      truncatedFrom = candidates.length;
      candidates = candidates.slice(0, CHATGPT_MAX_ITEMS_PER_RUN);
    }

    // Give the source the conversation's title when it was added with a
    // placeholder name, so the feed credits something meaningful.
    const convo = conversationTitle(payload);
    if (convo && isFirstRun && source.name.trim().length === 0) {
      await prisma.newsSource.update({ where: { id: source.id }, data: { name: convo } }).catch(() => {});
    }
  } else if (source.kind === "page") {
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

  const overflow = truncatedFrom
    ? `That chat held ${truncatedFrom} updates \u2014 the newest ${CHATGPT_MAX_ITEMS_PER_RUN} were imported. Split the rest into a second shared chat to bring them in.`
    : null;

  await prisma.newsSource
    .update({
      where: { id: source.id },
      data: {
        lastFetchedAt: now,
        lastStatus: "ok",
        // Truncation is not a failure, but it is the one "ok" outcome the admin
        // must act on, so it persists on the row rather than living only in the
        // response to whoever happened to trigger the import.
        lastError: overflow,
        lastItemCount: created,
        contentHash: hash,
      },
    })
    .catch(() => {});

  return { ...base, status: "ok", created, ...(overflow ? { error: overflow } : {}) };
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
