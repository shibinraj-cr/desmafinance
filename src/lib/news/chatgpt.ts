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

/**
 * True when this is a shared ChatGPT *task* link (`/s/task_…`).
 *
 * These look like share links and are not. A task share publishes the
 * automation's recipe — its title, prompt and RRULE schedule — so that someone
 * else can import it. What it never publishes is any run's output: those land in
 * the owner's own account and stay private. So there is no news behind such a
 * link, in any read mode, ever, and the only useful thing to do with one is
 * refuse it and say why.
 */
export function isSharedTaskUrl(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "chatgpt.com" && host !== "chat.openai.com") return false;
  const parts = u.pathname.split("/").filter(Boolean);
  return parts[0] === "s" && (parts[1] ?? "").startsWith("task_");
}

/**
 * The same thing detected from a fetched page rather than its URL, for the
 * shared-object forms we have not seen. The share page declares its own type in
 * the router payload it ships.
 */
export function looksLikeSharedAutomation(body: string): boolean {
  return /\\?"kind\\?",\\?"shared_automation\\?"/.test(body);
}

/** What to tell an admin who pasted a task link. */
export const SHARED_TASK_GUIDANCE =
  "That link shares the task itself \u2014 its prompt and schedule \u2014 not the updates it produces. ChatGPT keeps each run\u2019s output private to the account that runs it. Open the conversation the task produced, use Share on that conversation, and paste the https://chatgpt.com/share/\u2026 link it gives you.";

/** True when this URL is a ChatGPT share link — used to auto-pick the source kind. */
export function isChatGptShareUrl(rawUrl: string): boolean {
  return shareIdFrom(rawUrl) !== null;
}

/** The JSON endpoint behind a share page. */
export function shareApiUrl(shareId: string): string {
  return `https://chatgpt.com/backend-api/share/${shareId}`;
}

/**
 * ChatGPT wraps its source citations in private-use control characters —
 * `\uE200cite\uE202turn982260search0\uE201` — which are invisible in its own UI
 * and arrive as "citeturn982260search0" glued to the end of a sentence
 * anywhere else. Strip the whole span, delimiters included.
 */
export function stripCitations(s: string): string {
  return s
    .replace(/\uE200[\s\S]*?\uE201/g, "")
    // Any stray delimiter left by a truncated span, plus the rest of the
    // private-use block ChatGPT reserves for this markup.
    .replace(/[\uE200-\uE20F]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:])/g, "$1")
    // A citation sat at the end of a sentence, so removing it strands the space
    // in front of it — visible as ragged trailing whitespace on most lines.
    .replace(/[ \t]+$/gm, "")
    .trim();
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

    // A conversation carries far more assistant turns than the reader ever saw.
    // "commentary" is the model talking to itself before acting, and anything
    // that is not plain text is machinery: `code` turns hold tool calls (a
    // scheduled task's own JSON definition, for instance), `reasoning_recap`
    // holds chain-of-thought, `model_editable_context` holds memory writes.
    // Publishing those as company news is not a formatting problem, it is
    // publishing the wrong thing. Only "final" text turns are the answer.
    const channel = typeof msg.channel === "string" ? msg.channel : null;
    if (channel && channel !== "final") continue;

    const content = asRecord(msg.content);
    const contentType = typeof content?.content_type === "string" ? content.content_type : null;
    if (contentType && contentType !== "text" && contentType !== "multimodal_text") continue;

    const text = stripCitations(contentText(msg.content)).trim();
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

/**
 * How much of a briefing to keep. Long enough that a full daily update survives
 * intact, bounded so a runaway answer cannot bloat a row.
 */
const MAX_BODY = 12_000;

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
 * Split one assistant answer into updates.
 *
 * Headings are the only split point, and that is a deliberate narrowing after
 * seeing real briefings. A daily update is written as prose with an internal
 * bullet list of figures — "190 ROIs waiting: 908", "491 ROIs waiting: 592" —
 * and splitting on those bullets produced eight "updates" whose headlines were
 * row labels and whose bodies were bare numbers. The briefing is one update; its
 * bullets are its contents.
 *
 * A `##` heading is different: an author reaches for one to separate distinct
 * stories. So split there, and otherwise keep the answer whole, titled by its
 * opening line.
 */
export function splitIntoItems(markdown: string): ChatGptNewsItem[] {
  const text = stripCitations(markdown).replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const build = (rawTitle: string, rawBody: string): ChatGptNewsItem | null => {
    const title = truncate(cleanHeading(rawTitle), 300);
    if (!title) return null;
    return {
      title,
      // Generous, unlike a feed summary. A feed entry is a teaser pointing at an
      // article; this briefing IS the article, and there is nowhere else to read
      // the rest of it.
      summary: truncate(plainMarkdown(rawBody), MAX_BODY),
      url: firstUrl(`${rawTitle}\n${rawBody}`),
      // Identity is the title, so re-reading the same shared conversation
      // tomorrow does not file every entry a second time. Daily briefings carry
      // their date in the headline, which keeps each day distinct.
      guid: `gpt:${hashString(title.toLowerCase())}`,
    };
  };

  const items: ChatGptNewsItem[] = [];

  const headingRe = /^(#{2,6})\s+(.+)$/gm;
  const heads = [...text.matchAll(headingRe)];
  if (heads.length > 0) {
    // Anything before the first heading is a preamble belonging to the whole
    // answer, not to any one story; the headings carry the stories.
    for (let i = 0; i < heads.length; i++) {
      const start = heads[i].index! + heads[i][0].length;
      const end = i + 1 < heads.length ? heads[i + 1].index! : text.length;
      const item = build(heads[i][2], text.slice(start, end));
      if (item) items.push(item);
    }
    if (items.length > 0) return dedupe(items);
  }

  // One update, titled by its opening line — which for a generated briefing is
  // its headline ("Australia PR / ROI update — 4 September 2026").
  const lines = text.split("\n");
  const firstLine = lines.find((l) => l.trim().length > 0) ?? "";
  const rest = text.slice(text.indexOf(firstLine) + firstLine.length);
  const single = build(firstLine, rest.trim() || text);
  return single ? [single] : [];
}

/** Same headline twice in one answer is one update. */
function dedupe(items: ChatGptNewsItem[]): ChatGptNewsItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.guid) ? false : (seen.add(i.guid), true)));
}
