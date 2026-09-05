/**
 * Reading a public ChatGPT share link as a news source.
 *
 * The admin's workflow is: ask ChatGPT for the day's updates on a subject, share
 * that conversation publicly, and paste the link in. So the "feed" is one
 * conversation, and the updates are the items inside ChatGPT's answer.
 *
 * The share page itself renders client-side — fetching the HTML gets an app
 * shell with no conversation in it. The page's own data endpoint,
 * `/backend-api/share/<id>`, returns the conversation as JSON with no auth and
 * no bot challenge, so that is what we read.
 *
 * That endpoint is undocumented. It can change without notice, and if it does,
 * this breaks — there is no HTML fallback to drop back to, because the HTML has
 * never contained the content. The failure is loud (a readable error on the
 * admin's Sources page) rather than silent, which is the most that can be
 * promised here.
 */

import { hashString, stripHtml, truncate } from "@/lib/news/parse";

/** A share id is a UUID; anything else is not a share link. */
const SHARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The share id inside a ChatGPT link, or null if this is not one.
 *
 * Accepts both hosts OpenAI has used (chatgpt.com and the older
 * chat.openai.com), with or without a locale segment, and tolerates the
 * tracking query strings that come with a copied link.
 */
export function shareIdFrom(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "chatgpt.com" && host !== "chat.openai.com") return null;

  // /share/<id>, or /share/e/<id> for the "edit" form of the same link, or
  // /g/<gizmo>/share/<id>. Take the segment straight after the last "share".
  const parts = u.pathname.split("/").filter(Boolean);
  const at = parts.lastIndexOf("share");
  if (at === -1) return null;
  for (const candidate of parts.slice(at + 1)) {
    if (SHARE_ID.test(candidate)) return candidate.toLowerCase();
  }
  return null;
}

/** True when this URL is a ChatGPT share link — used to auto-pick the source kind. */
export function isChatGptShareUrl(rawUrl: string): boolean {
  return shareIdFrom(rawUrl) !== null;
}

/** The JSON endpoint behind a share page. */
export function shareApiUrl(shareId: string): string {
  return `https://chatgpt.com/backend-api/share/${shareId}`;
}

/** One assistant turn, reduced to plain text. */
export type SharedMessage = {
  text: string;
  /** Message timestamp when the payload carries one. */
  createdAt: Date | null;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(v: unknown): UnknownRecord | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as UnknownRecord) : null;
}

/**
 * Text out of a message's `content`, whichever way it is expressed.
 *
 * `parts` holds plain strings for an ordinary reply, but objects for anything
 * multimodal, and some payloads use `text` directly instead. Take the strings
 * and ignore the rest rather than stringifying an image blob into the feed.
 */
function contentText(content: unknown): string {
  const rec = asRecord(content);
  if (!rec) return typeof content === "string" ? content : "";

  const parts = rec.parts;
  if (Array.isArray(parts)) {
    return parts
      .map((p) => {
        if (typeof p === "string") return p;
        const pr = asRecord(p);
        return typeof pr?.text === "string" ? pr.text : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  if (typeof rec.text === "string") return rec.text;
  return "";
}

/** Seconds-since-epoch floats, as ChatGPT writes them. */
function timeFrom(v: unknown): Date | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  const d = new Date(v * 1000);
  const year = d.getUTCFullYear();
  return year >= 2020 && year <= 2100 ? d : null;
}

/**
 * Every assistant turn in a shared conversation, oldest first.
 *
 * Two payload shapes are handled because the endpoint has used both: a
 * `linear_conversation` array (already in order) and a `mapping` object keyed by
 * node id. Rather than betting on one, take whichever is present — and for
 * `mapping`, sort by timestamp, since object key order carries no meaning.
 *
 * Tool calls, system primers and the user's own prompts are skipped: the news is
 * what the assistant answered.
 */
export function assistantMessages(payload: unknown): SharedMessage[] {
  const root = asRecord(payload);
  if (!root) return [];

  const nodes: UnknownRecord[] = [];
  if (Array.isArray(root.linear_conversation)) {
    for (const n of root.linear_conversation) {
      const rec = asRecord(n);
      if (rec) nodes.push(rec);
    }
  } else {
    const mapping = asRecord(root.mapping);
    if (mapping) {
      for (const n of Object.values(mapping)) {
        const rec = asRecord(n);
        if (rec) nodes.push(rec);
      }
    }
  }

  const out: SharedMessage[] = [];
  for (const node of nodes) {
    // A node either wraps a message or, in some payloads, IS one.
    const msg = asRecord(node.message) ?? (asRecord(node.author) ? node : null);
    if (!msg) continue;
    const author = asRecord(msg.author);
    if (author?.role !== "assistant") continue;

    // Hidden scaffolding turns are marked; they are not part of the answer.
    const meta = asRecord(msg.metadata);
    if (meta?.is_visually_hidden_from_conversation === true) continue;

    const text = contentText(msg.content).trim();
    if (!text) continue;
    out.push({ text, createdAt: timeFrom(msg.create_time) });
  }

  // `linear_conversation` is already ordered; `mapping` is not. Sorting by time
  // is right for the second and harmless for the first, since a conversation's
  // timestamps ascend anyway.
  return out.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
}

/** The conversation's title, when it has one worth showing. */
export function conversationTitle(payload: unknown): string {
  const root = asRecord(payload);
  const t = root?.title;
  return typeof t === "string" ? truncate(stripHtml(t), 200) : "";
}

/** One update parsed out of the assistant's answer. */
export type ChatGptNewsItem = {
  title: string;
  summary: string;
  /** First link inside the entry, if it cites one. */
  url: string;
  /** Stable identity for dedupe — derived from the title, not the position. */
  guid: string;
};

/** Strip the markdown that would otherwise show up as literal punctuation. */
function plainMarkdown(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → their text
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1") // code spans
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1") // bold / italic
    .replace(/^\s{0,3}>\s?/gm, "") // block quotes
    .replace(/^\s*[-*+]\s+/gm, "") // list bullets
    .replace(/^\s*\d+[.)]\s+/gm, "") // list numbers
    .replace(/^#{1,6}\s*/gm, "") // stray heading marks
    .replace(/\|/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The first http(s) link in a chunk of markdown, if any. */
function firstUrl(md: string): string {
  const inline = md.match(/\]\((https?:\/\/[^\s)]+)\)/);
  if (inline) return inline[1];
  const bare = md.match(/https?:\/\/[^\s)<>\]]+/);
  return bare ? bare[0].replace(/[.,;]+$/, "") : "";
}

/** Drop a leading list marker / heading hash so a title reads as a title. */
function cleanHeading(s: string): string {
  return plainMarkdown(s.replace(/^#{1,6}\s*/, "").replace(/^\s*\d+[.)]\s*/, "")).trim();
}

/**
 * Split one assistant answer into individual updates.
 *
 * A digest is written for a person, not a parser, so the structure varies: this
 * tries markdown headings, then a numbered list, then top-level bullets, and
 * falls back to treating the whole answer as a single update. The fallback
 * matters — a digest written as flowing prose should still reach the feed as
 * one item rather than being dropped for not matching a pattern.
 */
export function splitIntoItems(markdown: string): ChatGptNewsItem[] {
  const text = markdown.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const build = (rawTitle: string, rawBody: string): ChatGptNewsItem | null => {
    const title = truncate(cleanHeading(rawTitle), 300);
    if (!title) return null;
    const summary = truncate(plainMarkdown(rawBody), 600);
    return {
      title,
      summary,
      url: firstUrl(`${rawTitle}\n${rawBody}`),
      // Identity is the title, so re-reading the same shared conversation
      // tomorrow does not file every entry a second time.
      guid: `gpt:${hashString(title.toLowerCase())}`,
    };
  };

  const items: ChatGptNewsItem[] = [];

  // 1. Markdown headings (##, ###) — the usual shape of a generated digest.
  //    Level-1 headings are skipped as the digest's own title, unless they are
  //    the only headings present.
  const headingRe = /^(#{2,6})\s+(.+)$/gm;
  const heads = [...text.matchAll(headingRe)];
  if (heads.length > 0) {
    for (let i = 0; i < heads.length; i++) {
      const start = heads[i].index! + heads[i][0].length;
      const end = i + 1 < heads.length ? heads[i + 1].index! : text.length;
      const item = build(heads[i][2], text.slice(start, end));
      if (item) items.push(item);
    }
    if (items.length > 0) return dedupe(items);
  }

  // 2. A numbered list, each number an update.
  const numbered = [...text.matchAll(/^\s*\d+[.)]\s+(.+)$/gm)];
  if (numbered.length >= 2) {
    for (let i = 0; i < numbered.length; i++) {
      const start = numbered[i].index! + numbered[i][0].length;
      const end = i + 1 < numbered.length ? numbered[i + 1].index! : text.length;
      const { head, body } = leadAndRest(numbered[i][1], text.slice(start, end));
      const item = build(head, body);
      if (item) items.push(item);
    }
    if (items.length > 0) return dedupe(items);
  }

  // 3. Top-level bullets.
  const bullets = [...text.matchAll(/^[-*+]\s+(.+)$/gm)];
  if (bullets.length >= 2) {
    for (let i = 0; i < bullets.length; i++) {
      const start = bullets[i].index! + bullets[i][0].length;
      const end = i + 1 < bullets.length ? bullets[i + 1].index! : text.length;
      const { head, body } = leadAndRest(bullets[i][1], text.slice(start, end));
      const item = build(head, body);
      if (item) items.push(item);
    }
    if (items.length > 0) return dedupe(items);
  }

  // 4. Prose: one update, titled by its opening sentence.
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  const sentence = plainMarkdown(firstLine).split(/(?<=[.!?])\s/)[0] ?? firstLine;
  const single = build(sentence || "Update", text);
  return single ? [single] : [];
}

/**
 * A list entry usually leads with its own headline — bolded, or before a dash or
 * colon — and continues into detail. Split there so the title is a headline
 * rather than the entry's first 300 characters.
 */
function leadAndRest(firstLine: string, rest: string): { head: string; body: string } {
  const bold = firstLine.match(/^\s*[*_]{2}([^*_]+)[*_]{2}\s*[:—–-]?\s*(.*)$/);
  if (bold) return { head: bold[1], body: `${bold[2]}\n${rest}` };
  const split = firstLine.match(/^(.{4,120}?)\s+[—–-]\s+(.*)$/);
  if (split) return { head: split[1], body: `${split[2]}\n${rest}` };
  const colon = firstLine.match(/^([^:]{4,120}):\s+(.*)$/);
  if (colon) return { head: colon[1], body: `${colon[2]}\n${rest}` };
  return { head: firstLine, body: rest };
}

/** Same headline twice in one answer is one update. */
function dedupe(items: ChatGptNewsItem[]): ChatGptNewsItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.guid) ? false : (seen.add(i.guid), true)));
}
