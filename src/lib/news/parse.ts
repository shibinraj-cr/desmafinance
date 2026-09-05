/**
 * RSS 2.0 / Atom parsing, with no XML dependency.
 *
 * The project ships no XML parser and a feed reader does not justify adding
 * one: feeds are a shallow, well-known shape, and everything below is scoped to
 * that shape rather than pretending to be general XML. What it deliberately
 * does NOT do is interpret the markup it extracts — every field is reduced to
 * plain text before it leaves this module, so a hostile feed cannot put markup
 * on anyone's screen.
 */

/** One entry lifted from a feed, already reduced to plain text. */
export type ParsedFeedItem = {
  title: string;
  /** Absolute link to the original article; empty when the feed omits it. */
  url: string;
  /** Plain-text summary, already stripped of markup and length-capped. */
  summary: string;
  /** Null when the feed carries no usable date — the caller decides a fallback. */
  publishedAt: Date | null;
  /** Feed-supplied identity: <guid>/<id>, else the link, else a title hash. */
  guid: string;
};

const MAX_SUMMARY = 600;

/** XML entities, plus the handful of HTML ones feeds actually use. */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

/** Resolve &amp;-style and &#123;-style references. Unknown names are left as-is. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref.startsWith("#")) {
      const code = ref[1] === "x" || ref[1] === "X"
        ? parseInt(ref.slice(2), 16)
        : parseInt(ref.slice(1), 10);
      // Reject non-characters rather than throwing out of String.fromCodePoint.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = ENTITIES[ref.toLowerCase()];
    return named ?? whole;
  });
}

/**
 * Markup in, plain text out. Script and style bodies are dropped whole (their
 * text content is code, not prose); block-level tags become spaces so words on
 * either side do not run together; entities are resolved last, so a `&lt;b&gt;`
 * in the source stays visible text instead of decoding into a tag.
 */
export function stripHtml(input: string): string {
  const withoutCode = input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ");
  const text = withoutCode.replace(/<[^>]*>/g, " ");
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

/** Trim to a length without cutting mid-word, appending an ellipsis. */
export function truncate(s: string, max = MAX_SUMMARY): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/** Unwrap `<![CDATA[…]]>`, which feeds use to carry raw HTML in a text node. */
function unwrapCdata(s: string): string {
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : s;
}

/**
 * The text of the first `<tag>` inside `xml`, CDATA unwrapped and entities
 * resolved. Self-closing and empty tags read as "". Namespace prefixes are
 * accepted (`dc:date` matches a `date` lookup only if asked for by full name).
 */
function tagText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, "i");
  const m = xml.match(re);
  if (!m) return "";
  return decodeEntities(unwrapCdata(m[1])).trim();
}

/** The value of one attribute on the first matching tag. */
function tagAttr(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = xml.match(re);
  if (!m) return "";
  return decodeEntities(m[2] ?? m[3] ?? "").trim();
}

/** Every `<tag>…</tag>` block in document order. */
function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, "gi");
  const out: string[] = [];
  for (const m of xml.matchAll(re)) out.push(m[1]);
  return out;
}

/**
 * Atom's `<link>` carries the URL in an href attribute, and an entry may hold
 * several. Prefer rel="alternate" (the human-readable article); fall back to the
 * first link with no rel, which by spec means alternate anyway. rel="self" and
 * rel="enclosure" are skipped — they point at the feed and at media files.
 */
function atomLink(entry: string): string {
  const links = [...entry.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const hrefOf = (t: string) => tagAttr(t, "link", "href");
  const relOf = (t: string) => (t.match(/\brel\s*=\s*("([^"]*)"|'([^']*)')/i)?.[2] ?? "").toLowerCase();
  const alternate = links.find((t) => relOf(t) === "alternate" && hrefOf(t));
  if (alternate) return hrefOf(alternate);
  const bare = links.find((t) => !relOf(t) && hrefOf(t));
  return bare ? hrefOf(bare) : "";
}

/**
 * Parse a date the way feeds actually write them: RFC 822 (RSS `pubDate`) and
 * ISO 8601 (Atom) are both handled by Date, so this is really a validity gate.
 * Anything unparseable, or absurdly far outside a plausible range, returns null
 * so a broken date cannot park an item at the top of the feed forever.
 */
export function parseFeedDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1995 || year > 2100) return null;
  return d;
}

/** FNV-1a. Short, stable, and not a security boundary — only an identity key. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Resolve a possibly-relative feed link against the source URL. */
export function absoluteUrl(href: string, baseUrl: string): string {
  const h = href.trim();
  if (!h) return "";
  try {
    const u = new URL(h, baseUrl);
    // Only ever hand http(s) links to the UI — a feed must not be able to put a
    // javascript: or data: URL behind a link users click.
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

/**
 * Parse an RSS 2.0 or Atom document into items. The format is detected from the
 * entry element (`<item>` vs `<entry>`) rather than the root, because plenty of
 * real feeds carry an unexpected root or extra namespaces.
 *
 * Items with no usable title AND no link are dropped: there is nothing to show
 * and nothing stable to dedupe on.
 */
export function parseFeed(xml: string, sourceUrl: string): ParsedFeedItem[] {
  const rssItems = blocks(xml, "item");
  const atomEntries = rssItems.length > 0 ? [] : blocks(xml, "entry");
  const isAtom = rssItems.length === 0 && atomEntries.length > 0;
  const raw = isAtom ? atomEntries : rssItems;

  const out: ParsedFeedItem[] = [];
  for (const entry of raw) {
    const title = stripHtml(tagText(entry, "title"));
    const link = absoluteUrl(isAtom ? atomLink(entry) : tagText(entry, "link"), sourceUrl);
    if (!title && !link) continue;

    // Prefer the short form; fall back to the full body, which is often the only
    // thing a feed provides.
    const summaryRaw = isAtom
      ? tagText(entry, "summary") || tagText(entry, "content")
      : tagText(entry, "description") || tagText(entry, "content:encoded");

    const dateRaw = isAtom
      ? tagText(entry, "published") || tagText(entry, "updated")
      : tagText(entry, "pubDate") || tagText(entry, "dc:date");

    // Identity, most stable first. A title hash is the last resort: it is stable
    // for an unchanged entry, which is all dedupe needs.
    const guidRaw = (isAtom ? tagText(entry, "id") : tagText(entry, "guid")) || link;
    const guid = guidRaw || `t:${hashString(title)}`;

    out.push({
      title: truncate(title, 300) || "(untitled)",
      url: link,
      summary: truncate(stripHtml(summaryRaw)),
      publishedAt: parseFeedDate(dateRaw),
      guid: guid.slice(0, 500),
    });
  }
  return out;
}

/**
 * The readable text of an HTML page, used as the change detector for sources
 * that publish no feed. Header/footer/nav/aside are removed first: they carry
 * session junk, rotating banners and "last visited" strings that change on
 * every request and would otherwise report an update on every run.
 */
export function pageText(html: string): string {
  const body = html
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, " ")
    .replace(/<(nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  return stripHtml(body);
}

/** The `<title>` of an HTML page, as plain text. */
export function pageTitle(html: string): string {
  return truncate(stripHtml(tagText(html, "title")), 300);
}
