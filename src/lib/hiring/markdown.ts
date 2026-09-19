/**
 * A deliberately tiny markdown subset for job descriptions.
 *
 * It parses to a STRUCTURE, not to an HTML string, so the renderer emits React
 * elements and there is no `dangerouslySetInnerHTML` anywhere near text that is
 * authored in-app and published on a public page. An HTML-string renderer here
 * would be a stored-XSS hole on `/careers/desma/[slug]` the first time someone
 * pasted a description in from a web page.
 *
 * Supported: `##`/`###` headings, `-`/`*` bullet lists, `1.` numbered lists,
 * pipe tables, paragraphs, and inline `**bold**`, `*italic*`, `` `code` ``.
 * Everything else renders as plain text, which is the right failure mode for a
 * job ad.
 *
 * Tables were added for HR policies, which are mostly reference material — a
 * shift-timing or leave-code table read as a run of pipe characters is
 * unreadable, and space-aligned plain text does not line up in the app's
 * proportional font. A table needs a header row, a `| --- |` separator, and at
 * least one body row; anything short of that falls through to paragraphs, so a
 * stray pipe in prose cannot accidentally become a table.
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string };

export type Block =
  | { type: "heading"; level: 2 | 3; content: Inline[] }
  | { type: "paragraph"; content: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] };

export function parseMarkdown(src: string | null | undefined): Block[] {
  if (!src?.trim()) return [];
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", content: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({
        type: "list",
        ordered: list.ordered,
        items: list.items.map(parseInline),
      });
      list = null;
    }
  };

  /** Split one `| a | b |` row into its cells, tolerating the outer pipes. */
  const splitRow = (row: string): string[] =>
    row
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  /** A `| --- | :--: |` separator, which is what marks the line above as a header. */
  const isSeparator = (row: string): boolean => {
    const cells = splitRow(row);
    return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // A table: header row, separator, then body rows until the block ends.
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      isSeparator(lines[i + 1]!) &&
      !isSeparator(trimmed)
    ) {
      const header = splitRow(trimmed);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j]!.trim().includes("|")) {
        const cells = splitRow(lines[j]!);
        // Pad or trim to the header width so a ragged row cannot shift columns.
        rows.push(
          Array.from({ length: header.length }, (_, k) => cells[k] ?? ""),
        );
        j++;
      }
      if (rows.length > 0) {
        flushParagraph();
        flushList();
        blocks.push({
          type: "table",
          header: header.map(parseInline),
          // An empty cell carries no inline content at all, rather than an
          // empty text node — a padded short row must render as nothing.
          rows: rows.map((r) => r.map((c) => (c ? parseInline(c) : []))),
        });
        i = j - 1;
        continue;
      }
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      // Everything above h3 is flattened: a job ad has no business emitting an
      // h1 inside a page that already has one.
      const level = heading[1]!.length <= 2 ? 2 : 3;
      blocks.push({ type: "heading", level, content: parseInline(heading[2]!) });
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

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: "text", value: text.slice(last, index) });
    const token = match[0];
    if (token.startsWith("**")) out.push({ type: "bold", value: token.slice(2, -2) });
    else if (token.startsWith("`")) out.push({ type: "code", value: token.slice(1, -1) });
    else out.push({ type: "italic", value: token.slice(1, -1) });
    last = index + token.length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out.length ? out : [{ type: "text", value: text }];
}

/** Plain text of a description — for meta descriptions and JSON-LD. */
export function markdownToPlainText(src: string | null | undefined, maxLen = 300): string {
  const blocks = parseMarkdown(src);
  const text = blocks
    .map((b) => {
      if (b.type === "list") return b.items.map(inlineText).join(". ");
      if (b.type === "table") {
        // Flatten to "header: cell, cell" lines so a table still reads as prose
        // in a meta description rather than vanishing.
        return b.rows
          .map((r) => r.map(inlineText).filter(Boolean).join(", "))
          .join(". ");
      }
      return inlineText(b.content);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen - 1).trimEnd() + "…" : text;
}

function inlineText(content: Inline[]): string {
  return content.map((c) => c.value).join("");
}
