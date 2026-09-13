/**
 * The SOP module's rich-text format: a small markdown subset that parses to a
 * STRUCTURE, never to an HTML string.
 *
 * §29 of the brief asks for sanitised rich text. The strongest way to sanitise
 * authored copy is to never build markup out of it: this parser emits typed
 * blocks, `<SopRichText>` renders them as React elements, and there is no
 * `dangerouslySetInnerHTML` anywhere in the module. A pasted `<script>` is
 * text, and stays text.
 *
 * It extends the existing job-description parser (src/lib/hiring/markdown.ts)
 * with the one thing an SOP needs and a job ad does not: links. Link hrefs go
 * through `safeHref`, which allows only http/https/mailto and relative in-app
 * paths, so `javascript:` and `data:` URLs can never reach an anchor.
 *
 * Supported: `##`/`###` headings, `-`/`*` bullets, `1.` numbered lists,
 * paragraphs, `**bold**`, `*italic*`, `` `code` ``, `[text](url)`. Anything
 * else renders as the literal characters the author typed.
 */

export type SopInline =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; value: string; href: string };

export type SopBlock =
  | { type: "heading"; level: 2 | 3; content: SopInline[] }
  | { type: "paragraph"; content: SopInline[] }
  | { type: "list"; ordered: boolean; items: SopInline[][] };

/**
 * The only hrefs an SOP link may produce. Everything else — `javascript:`,
 * `data:`, `vbscript:`, a protocol-relative `//evil.example` — is dropped and
 * the link renders as plain text.
 */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  // Relative in-app link (but not protocol-relative "//host").
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (/^(https?:\/\/|mailto:)/i.test(href)) {
    // Reject whitespace, control characters and angle brackets, which could
    // break out of the attribute context in a downstream consumer (an export,
    // a PDF renderer) even though React itself escapes them.
    if (/[\u0000-\u0020<>"']/.test(href)) return null;
    return href;
  }
  return null;
}

export function parseSopRichText(src: string | null | undefined): SopBlock[] {
  if (!src?.trim()) return [];
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: SopBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", content: parseSopInline(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: "list", ordered: list.ordered, items: list.items.map(parseSopInline) });
      list = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      // The page already owns h1/h2, so an authored heading is h2 at most.
      const level = heading[1]!.length <= 2 ? 2 : 3;
      blocks.push({ type: "heading", level, content: parseSopInline(heading[2]!) });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]!);
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]!);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks;
}

// Links first, so `[**bold** text](url)` is a link rather than a stray bold run.
const SOP_INLINE = /(\[[^\]\n]+\]\([^)\s]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

export function parseSopInline(text: string): SopInline[] {
  const out: SopInline[] = [];
  let last = 0;
  for (const match of text.matchAll(SOP_INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: "text", value: text.slice(last, index) });
    const token = match[0];

    const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/.exec(token);
    if (link) {
      const href = safeHref(link[2]!);
      // A rejected scheme degrades to the label as plain text — the reader sees
      // the words, never a live hostile link.
      out.push(href ? { type: "link", value: link[1]!, href } : { type: "text", value: link[1]! });
    } else if (token.startsWith("**")) {
      out.push({ type: "bold", value: token.slice(2, -2) });
    } else if (token.startsWith("`")) {
      out.push({ type: "code", value: token.slice(1, -1) });
    } else {
      out.push({ type: "italic", value: token.slice(1, -1) });
    }
    last = index + token.length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out.length ? out : [{ type: "text", value: text }];
}

/** Flattened text — for search, list previews and the print/PDF summary. */
export function sopRichTextToPlain(src: string | null | undefined, maxLen = 400): string {
  const blocks = parseSopRichText(src);
  const text = blocks
    .map((b) => (b.type === "list" ? b.items.map(inlineText).join(". ") : inlineText(b.content)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen - 1).trimEnd() + "…" : text;
}

function inlineText(content: SopInline[]): string {
  return content.map((c) => c.value).join("");
}
