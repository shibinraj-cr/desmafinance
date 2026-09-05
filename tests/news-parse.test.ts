import { describe, it, expect } from "vitest";
import {
  parseFeed,
  stripHtml,
  decodeEntities,
  parseFeedDate,
  absoluteUrl,
  truncate,
  pageText,
  pageTitle,
} from "../src/lib/news/parse";
import { isFetchableUrl, FIRST_RUN_MAX_AGE_DAYS } from "../src/lib/news/sync";
import { NEWS_WINDOW_DAYS } from "../src/lib/news/constants";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Immigration News</title>
    <link>https://example.gov/news</link>
    <item>
      <title>Visa rules change from 1 October</title>
      <link>/news/visa-rules</link>
      <guid isPermaLink="false">post-101</guid>
      <pubDate>Mon, 01 Sep 2026 09:30:00 +0000</pubDate>
      <description><![CDATA[<p>The <b>subclass 482</b> stream is being replaced.</p>]]></description>
    </item>
    <item>
      <title>Fee schedule updated</title>
      <link>https://example.gov/news/fees</link>
      <pubDate>Tue, 02 Sep 2026 06:00:00 +0000</pubDate>
      <description>New fees apply &amp; take effect immediately.</description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Board Updates</title>
  <entry>
    <title>Registration standard revised</title>
    <link rel="self" href="https://example.org/feed.xml"/>
    <link rel="alternate" href="https://example.org/posts/registration"/>
    <id>tag:example.org,2026:post-7</id>
    <published>2026-08-30T11:00:00Z</published>
    <summary type="html">&lt;p&gt;Applies to all applicants.&lt;/p&gt;</summary>
  </entry>
</feed>`;

describe("parseFeed — RSS", () => {
  const items = parseFeed(RSS, "https://example.gov/news/rss");

  it("reads every item", () => {
    expect(items).toHaveLength(2);
  });

  it("prefers the feed's own guid as the dedupe key", () => {
    expect(items[0].guid).toBe("post-101");
  });

  it("falls back to the link when there is no guid", () => {
    expect(items[1].guid).toBe("https://example.gov/news/fees");
  });

  it("resolves a relative link against the source URL", () => {
    expect(items[0].url).toBe("https://example.gov/news/visa-rules");
  });

  it("unwraps CDATA and strips the markup inside it", () => {
    expect(items[0].summary).toBe("The subclass 482 stream is being replaced.");
  });

  it("decodes entities in a plain description", () => {
    expect(items[1].summary).toBe("New fees apply & take effect immediately.");
  });

  it("parses an RFC 822 pubDate", () => {
    expect(items[0].publishedAt?.toISOString()).toBe("2026-09-01T09:30:00.000Z");
  });
});

describe("parseFeed — Atom", () => {
  const items = parseFeed(ATOM, "https://example.org/feed.xml");

  it("reads entries", () => {
    expect(items).toHaveLength(1);
  });

  it("takes the alternate link, not rel=self", () => {
    expect(items[0].url).toBe("https://example.org/posts/registration");
  });

  it("uses <id> as the dedupe key", () => {
    expect(items[0].guid).toBe("tag:example.org,2026:post-7");
  });

  it("strips escaped markup out of the summary", () => {
    expect(items[0].summary).toBe("Applies to all applicants.");
  });

  it("parses an ISO 8601 published date", () => {
    expect(items[0].publishedAt?.toISOString()).toBe("2026-08-30T11:00:00.000Z");
  });
});

describe("parseFeed — hostile and malformed input", () => {
  it("returns nothing for a page that is not a feed", () => {
    expect(parseFeed("<html><body><h1>Hello</h1></body></html>", "https://x.test")).toEqual([]);
  });

  it("drops entries with neither a title nor a link", () => {
    const xml = `<rss><channel><item><description>orphan</description></item></channel></rss>`;
    expect(parseFeed(xml, "https://x.test")).toEqual([]);
  });

  it("refuses a javascript: link rather than passing it to the UI", () => {
    const xml = `<rss><channel><item><title>Click</title><link>javascript:alert(1)</link></item></channel></rss>`;
    const [item] = parseFeed(xml, "https://x.test");
    expect(item.url).toBe("");
  });

  it("keeps a script body out of the summary", () => {
    const xml = `<rss><channel><item><title>T</title><link>https://x.test/a</link><description><![CDATA[<script>steal()</script>Real text]]></description></item></channel></rss>`;
    const [item] = parseFeed(xml, "https://x.test");
    expect(item.summary).toBe("Real text");
  });

  it("gives an untitled entry a stable guid derived from its title", () => {
    const xml = `<rss><channel><item><title>Same</title></item></channel></rss>`;
    const a = parseFeed(xml, "https://x.test")[0];
    const b = parseFeed(xml, "https://x.test")[0];
    expect(a.guid).toBe(b.guid);
    expect(a.guid).toMatch(/^t:/);
  });
});

describe("stripHtml", () => {
  it("puts a space where a block tag was, so words do not merge", () => {
    expect(stripHtml("<p>One</p><p>Two</p>")).toBe("One Two");
  });

  it("resolves entities after removing tags, so escaped markup stays text", () => {
    expect(stripHtml("&lt;b&gt;bold&lt;/b&gt;")).toBe("<b>bold</b>");
  });

  it("drops style blocks whole", () => {
    expect(stripHtml("<style>.a{color:red}</style>Body")).toBe("Body");
  });
});

describe("decodeEntities", () => {
  it("handles named, decimal and hex references", () => {
    expect(decodeEntities("a &amp; b &#65; &#x42;")).toBe("a & b A B");
  });

  it("leaves an unknown entity untouched rather than mangling it", () => {
    expect(decodeEntities("&notreal;")).toBe("&notreal;");
  });

  it("leaves an out-of-range code point alone", () => {
    expect(decodeEntities("&#1114112;")).toBe("&#1114112;");
  });
});

describe("parseFeedDate", () => {
  it("rejects unparseable text", () => {
    expect(parseFeedDate("sometime last week")).toBeNull();
  });

  it("rejects a year outside the plausible range", () => {
    expect(parseFeedDate("1970-01-01T00:00:00Z")).toBeNull();
  });

  it("accepts a normal date", () => {
    expect(parseFeedDate("2026-09-01T00:00:00Z")?.getUTCFullYear()).toBe(2026);
  });
});

describe("absoluteUrl", () => {
  it("resolves a relative path", () => {
    expect(absoluteUrl("/a", "https://x.test/feed")).toBe("https://x.test/a");
  });

  it("rejects a data: URL", () => {
    expect(absoluteUrl("data:text/html,<script>", "https://x.test/feed")).toBe("");
  });
});

describe("truncate", () => {
  it("leaves short text alone", () => {
    expect(truncate("short", 20)).toBe("short");
  });

  it("cuts on a word boundary and marks the cut", () => {
    const out = truncate("alpha beta gamma delta", 12);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("gamma");
  });
});

describe("pageText / pageTitle — the no-feed fallback", () => {
  const html = `<html><head><title>Immigration | Updates</title></head>
    <body><nav>Home Contact 12:04</nav><main>Policy changed today.</main><footer>© 2026</footer></body></html>`;

  it("reads the document title", () => {
    expect(pageTitle(html)).toBe("Immigration | Updates");
  });

  it("ignores nav and footer, which change without the content changing", () => {
    const text = pageText(html);
    expect(text).toContain("Policy changed today.");
    expect(text).not.toContain("Contact");
    expect(text).not.toContain("2026");
  });

  it("gives the same text for two responses that differ only in the nav clock", () => {
    const a = pageText(html);
    const b = pageText(html.replace("12:04", "18:57"));
    expect(a).toBe(b);
  });
});

describe("isFetchableUrl", () => {
  it("accepts a public https URL", () => {
    expect(isFetchableUrl("https://immi.homeaffairs.gov.au/news/rss")).toBe(true);
  });

  it("rejects non-http schemes", () => {
    expect(isFetchableUrl("file:///etc/passwd")).toBe(false);
    expect(isFetchableUrl("ftp://example.com/feed")).toBe(false);
  });

  it("rejects loopback and private addresses", () => {
    expect(isFetchableUrl("http://localhost:3000/feed")).toBe(false);
    expect(isFetchableUrl("http://127.0.0.1/feed")).toBe(false);
    expect(isFetchableUrl("http://10.0.0.5/feed")).toBe(false);
    expect(isFetchableUrl("http://192.168.1.1/feed")).toBe(false);
    expect(isFetchableUrl("http://172.16.0.1/feed")).toBe(false);
    expect(isFetchableUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
  });

  it("does not reject a public address that merely starts with a private-looking octet", () => {
    expect(isFetchableUrl("http://172.32.0.1/feed")).toBe(true);
  });

  it("rejects nonsense", () => {
    expect(isFetchableUrl("not a url")).toBe(false);
  });
});

describe("first-run backfill window", () => {
  it("matches the window the feed renders, so nothing is filed that cannot be seen", () => {
    // A mismatch would either store items no one can see, or refuse ones the
    // feed would happily show. Tying them together is the whole point.
    expect(FIRST_RUN_MAX_AGE_DAYS).toBe(NEWS_WINDOW_DAYS);
  });
});
