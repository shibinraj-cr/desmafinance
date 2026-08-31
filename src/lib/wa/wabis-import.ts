/**
 * One-off import of conversation history out of Wabis.
 *
 * Wabis exposes `/api/v1/whatsapp/get/conversation` — a subscriber's messages,
 * 50 at a time, paginated. That is the one capability of theirs with standalone
 * value: it means the CRM inbox does not have to start empty on the day Wabis is
 * retired, and it removes the only real argument for running a transitional
 * mirror on their webhook.
 *
 * WRITTEN AGAINST AN UNVERIFIED SHAPE. The endpoints are documented in Wabis's
 * console; their response bodies are not. Rather than guess a schema and write
 * bad rows, this module does two things:
 *
 *   - reads every field leniently, under all the names it plausibly goes by
 *     (the same approach `extractInboundMessages` takes for webhooks), and
 *   - supports a DRY RUN that fetches, normalises and reports — including a
 *     redacted sample of the raw payload — while writing nothing.
 *
 * So the first run tells us the real shape, and the importer is adjusted from
 * fact instead of assumption. Everything here is additive and idempotent: a
 * message collides on the unique `providerMessageId`, so re-running after an
 * adjustment cannot duplicate a thread.
 */
import { prisma } from "../prisma";
import { waIdToE164, typedPhoneToE164 } from "./phone";
import { logger } from "../logger";
import {
  getSetting,
  setSetting,
  WABIS_API_TOKEN_KEY,
  WA_CLOUD_PHONE_NUMBER_ID_KEY,
  WA_IMPORT_PROGRESS_KEY,
} from "../app-settings";
import { extractBody, normalizeMessageType, parseWaTimestamp, type WaMessageType } from "./inbound";
import { sessionExpiryFrom, isSessionOpen } from "./mirror";

const WABIS_BASE = "https://bot.wabis.in/api/v1/whatsapp";
const REQUEST_TIMEOUT_MS = 15_000;
/** Wabis's own page size for conversations. */
const PAGE_SIZE = 50;
/** Stop well inside the platform's 60s ceiling; the caller resumes. */
const TIME_BUDGET_MS = 40_000;

export type WabisImportOptions = {
  /** Fetch and report, write nothing. Always do this first. */
  dryRun: boolean;
  /** Cap subscribers processed in one run, so a large account drains over several. */
  maxSubscribers: number;
  /** Restrict to one number — the safest possible first test. */
  onlyPhone?: string | null;
  /** Begin again from the first contact instead of resuming. */
  restart?: boolean;
};

/**
 * How many contacts to fetch conversations for at once.
 *
 * Each contact is one round trip of a second or two, so sequentially a 40-second
 * run covered roughly twenty — which for an account of any size means clicking
 * Import dozens of times. Modest on purpose: the goal is to stop wasting the
 * budget on waiting, not to hammer Wabis.
 */
const IMPORT_CONCURRENCY = 6;

export type WabisImportSummary = {
  dryRun: boolean;
  subscribersSeen: number;
  conversationsTouched: number;
  messagesFound: number;
  messagesImported: number;
  leadsMatched: number;
  skippedNoPhone: number;
  stoppedEarly: boolean;
  /** Redacted sample of a raw message, so the real shape can be read off a dry run. */
  sampleRaw: unknown;
  /** Field names seen on raw messages — the fastest way to spot a mis-mapping. */
  observedKeys: string[];
  /**
   * Every distinct `sender` value seen, with how each was classified.
   *
   * `sender` decides direction and its value set is undocumented — the spec only
   * ever shows "bot". Rather than guess and quietly file half a thread on the
   * wrong side, the run reports what it actually met, so an unrecognised value
   * shows up as a line to fix instead of as silently mis-rendered history.
   */
  observedSenders: { value: string; direction: string; count: number }[];
  /**
   * The first raw RESPONSE, redacted and truncated — captured whether or not any
   * records were found.
   *
   * This exists because the first real run reported "0 messages found" and
   * nothing else: `sampleRaw` only fills when records are located, so the one
   * case the dry run exists to diagnose produced no diagnostic at all. Now the
   * envelope itself comes back, which answers "wrong parameter name?", "wrong
   * wrapper key?" and "did it refuse us?" in a single look.
   */
  rawResponse: string | null;
  /** Exactly what we asked for, so a wrong parameter name is visible too. */
  requestSent: string | null;
  /**
   * Where the next run will resume from, and how far the sweep has got.
   *
   * Without this a repeat run restarted at the first contact every time — the
   * same people re-fetched forever, never reaching contact 21. For "import
   * everything" that is the difference between a few clicks and an impossible
   * task, and it fails silently: each run reports work done.
   */
  resumedFrom: number;
  nextCursor: number;
  /** Total contacts swept across all runs so far. */
  totalProcessed: number;
  /** False when the sweep has reached the end of the subscriber list. */
  moreToDo: boolean;
  /**
   * Wabis asked us to slow down. Not an error: the run kept its place and the
   * next one continues, which is why the caller waits rather than stopping.
   */
  rateLimited: boolean;
  /**
   * Contacts a previous run could not fetch, retried at the start of this one,
   * and how many are still outstanding. A failure that is recorded but never
   * revisited is indistinguishable from one that was dropped.
   */
  retried: number;
  stillFailing: number;
  /**
   * The numbers we could not read, not just how many. On a run that happens
   * once, "5 contacts had no usable number" is a fact nobody can act on.
   */
  skippedNumbers: string[];
  /**
   * Messages Wabis gave us with no readable time, which are dropped rather than
   * stamped with the clock. Reported because a non-zero count here means real
   * history was left behind and someone should decide what to do about it.
   */
  messagesUndated: number;
  /** Messages whose sender we could not classify, so did not guess at. */
  messagesUnknownSender: number;
  /**
   * Wabis panel activity ("Label added: …") returned interleaved with the
   * conversation. Not messages, so not imported as chat bubbles.
   */
  eventsSkipped: number;
  /** Placeholder leads (named by their own number) that gained a real name. */
  leadsNamed: number;
  errors: string[];
};

/**
 * Wabis asking us to slow down.
 *
 * Its own type because the response to it is different in kind: an error means
 * something is wrong and the operator should look at it, whereas this means the
 * sweep is working and should pause. Conflating them made a rate-limited run
 * look like a broken one, and cost the whole run.
 */
export class WabisRateLimitError extends Error {
  constructor(detail: string) {
    super(`Wabis rate limit: ${detail}`);
    this.name = "WabisRateLimitError";
  }
}

function isRateLimit(e: unknown): boolean {
  return e instanceof WabisRateLimitError;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pick(o: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * The contact's number out of a `/subscriber/list` record.
 *
 * `chat_id` first because it is the only field a real response has ever carried:
 * Wabis calls a subscriber's WhatsApp id a chat id, so every phone-shaped guess
 * missed and the whole account reported back as "no usable number" — a silent
 * skip that looked like an empty account rather than a mapping error. The other
 * names stay as fallbacks; nothing here is documented, and a field present on
 * only some subscribers would bring the same silent skip back for a subset.
 *
 * Exported for the mapping test. The value is an E.164 number without its `+`,
 * so callers still owe it a `waIdToE164`.
 */
export function subscriberPhone(sub: Record<string, unknown>): string | null {
  return pick(sub, "chat_id", "phone_number", "phone", "wa_id", "msisdn", "mobile");
}

/**
 * The contact's name, as WhatsApp knows them.
 *
 * Worth taking because of where these threads land. `storeThread` only ever
 * MATCHES a lead, so a Wabis contact who was never in the CRM arrives with no
 * lead at all, and the inbox falls back to the number — leaving an operator
 * scrolling a wall of digits with no way to tell one thread from another. The
 * live mirror has the same gap by necessity: an unknown number really is
 * unknown. Here it is not, and the name costs nothing extra to carry.
 *
 * A "name" that is just the number again is rejected — some panels fill the
 * field that way, and storing it would look like a name while telling nobody
 * anything.
 */
export function subscriberName(sub: Record<string, unknown>): string | null {
  const joined = [pick(sub, "first_name"), pick(sub, "last_name")]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!joined) return null;
  if (!/\D/.test(joined.replace(/^\+/, ""))) return null;
  return joined.slice(0, 120);
}


/**
 * One Wabis API call.
 *
 * POST with a form body, never GET: Wabis takes the key as an ordinary request
 * parameter with no header and no signing, so a GET would write the API key into
 * every access log and proxy along the way.
 */
async function wabisPost(
  path: string,
  token: string,
  params: Record<string, string>,
  /** Called with the raw body and request BEFORE any throw, so a refusal is still visible. */
  capture?: (raw: string, request: string) => void,
): Promise<unknown> {
  const body = new URLSearchParams({ apiToken: token, ...params });
  const res = await fetch(`${WABIS_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text().catch(() => "");
  // The API key is the one thing that must never reach a browser; every other
  // parameter is exactly what we need to see.
  capture?.(text.slice(0, 1500), `POST ${path} ${new URLSearchParams({ apiToken: "REDACTED", ...params })}`);
  // Rate limiting is not a failure — it is Wabis asking us to come back in a
  // minute, and it is the ordinary outcome of sweeping a large account rather
  // than a sign anything is wrong. Distinguished from a real error so the run
  // can stop cleanly, keep its place, and say when to try again.
  if (res.status === 429) throw new WabisRateLimitError(text.slice(0, 300));
  if (!res.ok) throw new Error(`Wabis ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Wabis ${path} returned non-JSON: ${text.slice(0, 300)}`);
  }

  // Wabis signals failure IN THE BODY with HTTP 200 — {"status":"0","message":…}.
  // Without this check a rejected request is indistinguishable from an empty
  // result, which is exactly how the first run reported "0 messages found" and
  // told us nothing.
  const err = wabisErrorMessage(parsed);
  if (err) throw new Error(`Wabis ${path} refused: ${err}`);

  return parsed;
}

/**
 * How far the sweep has got, kept in AppSetting.
 *
 * A whole account cannot be imported inside one request, so progress has to
 * outlive it. Stored as one JSON value rather than three keys because the three
 * are only meaningful together — a cursor without its count reads as if nothing
 * has happened.
 */
type ImportProgress = {
  cursor: number;
  processed: number;
  done: boolean;
  /**
   * Contacts whose fetch failed, kept by number so a later run can retry them.
   *
   * Without this the cursor has only two options at a failure, and both are
   * wrong: hold, and one permanently broken contact blocks the sweep forever;
   * advance, and that contact's history is gone with no record of whose it was —
   * the only trace being a string in the JSON response of a run that otherwise
   * reported success. Naming them lets the cursor move on AND the work be
   * finished, which is the whole difference between "mostly imported" and
   * "imported".
   */
  failed: string[];
};

/** Enough to be worth draining, small enough that a systemic outage cannot grow it without bound. */
const MAX_FAILED_TRACKED = 200;

async function readImportProgress(): Promise<ImportProgress | null> {
  const raw = await getSetting(WA_IMPORT_PROGRESS_KEY).catch(() => null);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<ImportProgress>;
    const cursor = Number(p.cursor);
    return {
      cursor: Number.isFinite(cursor) && cursor > 0 ? cursor : 1,
      processed: Number(p.processed) || 0,
      done: !!p.done,
      failed: Array.isArray(p.failed) ? p.failed.filter((v): v is string => typeof v === "string") : [],
    };
  } catch {
    return null;
  }
}

async function writeImportProgress(p: ImportProgress): Promise<void> {
  await setSetting(WA_IMPORT_PROGRESS_KEY, JSON.stringify(p)).catch(() => undefined);
}

/**
 * ONE page of Wabis subscribers.
 *
 * Sends `limit` and `phone_number_id` because Wabis refuses without either — the
 * contact list is scoped to a bot's number exactly as the conversation read is,
 * which is not what "list my subscribers" suggests. Both were learnt from
 * rejections rather than documentation, one per round trip, which is why the dry
 * run reports the raw envelope.
 *
 * A page at a time, deliberately, and the whole page is returned. The previous
 * version fetched up to `max` records and threw away the rest of the page it
 * stopped inside — at the default of 25 against a page size of 50, that is
 * records 26-50 of every page discarded while the cursor still stepped over
 * them. They were then unreachable at any setting, and a short final page
 * partially consumed still reported the sweep complete. A page is now the unit
 * of work as well as the unit of fetching, so "where we are" and "what we did"
 * cannot disagree.
 */
async function fetchSubscriberPage(
  token: string,
  offset: number,
  capture: (raw: string, request: string) => void,
  phoneNumberId: string,
): Promise<{ subscribers: Record<string, unknown>[]; nextOffset: number; lastPage: boolean }> {
  const payload = await wabisPost(
    "/subscriber/list",
    token,
    { limit: String(PAGE_SIZE), offset: String(offset), phone_number_id: phoneNumberId },
    capture,
  );
  const batch = findRecordArray(payload);

  // Follow the server's own cursor when it offers one. The spec calls `offset` a
  // page number while the response returns what looks like a record offset, and
  // it documents neither reconciliation — so we take whatever it hands back and
  // only fall back to stepping by one when it hands back nothing.
  const next = nextOffsetOf(payload);
  const nextOffset = next !== null && next !== offset ? next : offset + 1;

  // A short page is the last one. An empty page is the end proper.
  return { subscribers: batch, nextOffset, lastPage: batch.length < PAGE_SIZE };
}

/** The server's own next-page cursor (`nextOffset`), when it gives one. */
export function nextOffsetOf(payload: unknown): number | null {
  const o = asObject(payload);
  if (!o) return null;
  const raw = o.nextOffset ?? o.next_offset;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Wabis's in-body failure, or null when the response is a success. */
export function wabisErrorMessage(payload: unknown): string | null {
  const o = asObject(payload);
  if (!o) return null;
  const status = o.status;
  const failed = status === "0" || status === 0 || status === false || o.success === false;
  if (!failed) return null;
  const msg = pick(o, "message", "error", "msg", "description");
  return msg ?? "request rejected (no message given)";
}

/**
 * Find the array of records in a response whose envelope we do not know.
 *
 * Wabis wraps results under some key — `data`, `subscribers`, `messages`,
 * `conversation` — and which one is not documented. Rather than hard-code a
 * guess that silently yields zero rows, take the longest array of objects
 * anywhere in the top two levels.
 */
export function findRecordArray(payload: unknown): Record<string, unknown>[] {
  const root = asObject(payload);
  if (!root) return Array.isArray(payload) ? (payload.filter(asObject) as Record<string, unknown>[]) : [];

  const candidates: Record<string, unknown>[][] = [];
  const consider = (v: unknown) => {
    if (!Array.isArray(v)) return;
    const objs = v.filter((x) => !!asObject(x)) as Record<string, unknown>[];
    if (objs.length) candidates.push(objs);
  };

  for (const v of Object.values(root)) {
    consider(v);
    const nested = asObject(v);
    if (nested) for (const inner of Object.values(nested)) consider(inner);
  }

  return candidates.sort((a, b) => b.length - a.length)[0] ?? [];
}

export type WabisRawMessage = {
  providerMessageId: string | null;
  /** Null when `sender` was a value we do not recognise — such a record is skipped, not guessed at. */
  direction: "in" | "out" | null;
  type: WaMessageType;
  body: string | null;
  mediaUrl: string | null;
  occurredAt: Date | null;
  /** Approved template name, when the record is a template send. */
  templateName: string | null;
  /** Meta's own state, which Wabis already stored — free read receipts. */
  waStatus: string | null;
  waErrorMessage: string | null;
  readAt: Date | null;
};

/**
 * Normalise one Wabis message record.
 *
 * Direction is the field most likely to be named something unexpected, and
 * getting it wrong would put our own replies in the candidate's bubble. So it is
 * derived from several signals and defaults to INBOUND — a misfiled inbound
 * message reads as a candidate saying something odd, while a misfiled outbound
 * one looks like we said something we never did.
 */
export function normalizeWabisMessage(raw: Record<string, unknown>): WabisRawMessage {
  // `message_content` is DOUBLE-ENCODED: a JSON string holding the raw WhatsApp
  // payload. The type and the text both live inside it — there is no flat `type`
  // or `text` field on the record — so it is parsed first and the existing Meta
  // helpers do the rest, since the inner object is Meta's own message shape.
  const inner = parseMessageContent(raw.message_content);
  const contentString = typeof raw.message_content === "string" ? raw.message_content : null;
  const direction = wabisDirection(raw);

  // A template definition carries no top-level `type` — it is identified by
  // having a name and components — so it would otherwise be filed as plain text.
  const isTemplate = !!inner && !inner.type && !!inner.name && Array.isArray(inner.components);
  const type = isTemplate
    ? ("template" as WaMessageType)
    : inner
      ? normalizeMessageType(pick(inner, "type"))
      : normalizeMessageType(pick(raw, "message_type", "type", "media_type"));

  const body = extractWabisBody(inner, type, contentString) ?? pick(raw, "message", "text", "body", "content", "caption");

  // Media lives somewhere inside the inner payload under a key we have not
  // confirmed, so the storage URL is recovered from the raw text as well —
  // Wabis rewrites incoming media to its own bucket, and that URL is present in
  // the stored record however it is nested.
  const mediaUrl =
    (inner && pick(inner, "media_url", "url", "link")) ??
    pick(raw, "media_url", "mediaUrl", "file_url", "attachment_url", "url") ??
    (contentString?.match(/https?:\/\/\S*wasabisys\.com\/[^\s"'\\]+/i)?.[0] ?? null) ??
    (body && /^https?:\/\/\S+$/i.test(body) ? body : null);

  return {
    // The real Meta wamid, which is what a delivery-status callback joins on.
    // `id` is Wabis's own row id and is deliberately NOT used as a fallback:
    // storing it in providerMessageId would poison the unique index that makes
    // re-running the import safe.
    providerMessageId: pick(raw, "wa_message_id", "message_id", "wamid"),
    direction,
    type,
    body,
    mediaUrl,
    occurredAt: parseWabisTime(raw.conversation_time) ?? parseWaTimestamp(raw.timestamp ?? raw.created_at ?? raw.sent_at),
    templateName: isTemplate ? pick(inner!, "name") : null,
    // Wabis already recorded what Meta did with each message, so imported
    // threads arrive with real delivery ticks instead of a wall of unknowns —
    // but only on OUR messages. Delivery state describes something we sent; on
    // an inbound row it draws our own ticks on the candidate's bubble, claiming
    // we delivered a message they wrote to us.
    waStatus: direction === "out" ? normalizeWabisStatus(pick(raw, "message_status")) : null,
    waErrorMessage: direction === "out" ? pick(raw, "failed_reason") : null,
    readAt: direction === "out" ? parseWabisTime(raw.read_time) : null,
  };
}

/** Wabis's stored delivery state, mapped onto the four we store. */
export function normalizeWabisStatus(raw: string | null): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "read" || s === "delivered" || s === "sent" || s === "failed") return s;
  if (s === "seen") return "read";
  if (s === "error" || s === "failure") return "failed";
  return null;
}

/**
 * The readable text of a stored Wabis message.
 *
 * `extractBody` handles Meta's INBOUND webhook shapes and is left alone — it is
 * correct for those and tested against them. What it does not cover is the
 * OUTBOUND SEND payload, which is what Wabis stores for its own bot messages:
 * there, an interactive message carries `interactive.body.text` (an object),
 * where an inbound one would carry `interactive.button_reply.title` (a string).
 * Reaching into that here keeps a Wabis storage quirk out of the shared parser.
 *
 * Falls back to the raw string when `message_content` was never JSON at all,
 * since some records are plain text.
 */
export function extractWabisBody(
  inner: Record<string, unknown> | null,
  type: WaMessageType,
  contentString: string | null,
): string | null {
  if (inner) {
    const viaShared = extractBody(inner, type);
    if (viaShared) return viaShared;

    // Outbound interactive: body first, then header as a last resort — a
    // header-only message is rare but reads better than an empty bubble.
    const interactive = asObject(inner.interactive) ?? asObject(inner.template);
    if (interactive) {
      for (const section of ["body", "header", "footer"]) {
        const text = pick(asObject(interactive[section]) ?? {}, "text");
        if (text) return text;
      }
    }

    // TEMPLATE DEFINITION shape — what Wabis stores for a template send:
    // {name, language, category, components:[{type:"body", text:"…"}]}. Neither
    // Meta's message format nor Wabis's own documented sample covers it, and it
    // is what real records in this account actually contain, so without this
    // every template send imports with an empty body.
    const components = Array.isArray(inner.components) ? inner.components : [];
    for (const wanted of ["body", "header", "footer"]) {
      for (const c of components) {
        const comp = asObject(c);
        if (!comp) continue;
        if ((pick(comp, "type") ?? "").toLowerCase() !== wanted) continue;
        const text = pick(comp, "text");
        if (text) return text;
      }
    }
    return null;
  }

  // Not JSON — the record simply holds text. A URL-only body is still the body;
  // the media extractor reads it separately.
  return contentString;
}

/** The inner WhatsApp payload, or null when it is absent or unparseable. */
export function parseMessageContent(value: unknown): Record<string, unknown> | null {
  if (asObject(value)) return asObject(value);
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t.startsWith("{")) return null;
  try {
    return asObject(JSON.parse(t));
  } catch {
    return null;
  }
}

/**
 * Which way a Wabis message went, or NULL when we cannot tell.
 *
 * The field is `sender` and its value set is not documented — the spec's only
 * example is `"bot"`, and the account has since produced `"automation"`. So the
 * values Wabis uses for a human live-chat reply, an API send or a broadcast are
 * all still unknown, and "admin", "livechat", "human", "api", "broadcast", even
 * "outbound", would every one of them have fallen through.
 *
 * This used to default to inbound on the grounds that it was the safer misfile.
 * It is not, for history like this: the account's traffic is overwhelmingly
 * ours, so an unknown value misfiles at scale, and each one is our own outgoing
 * message drawn in the candidate's bubble, setting lastInboundAt to its own time
 * — which then flags the thread as awaiting a reply and computes a free-text
 * window from a message we sent. Written once, permanent on re-run, and the
 * report that would reveal the unknown value is only produced afterwards.
 *
 * Null means the caller skips the record and the sweep reports the value it did
 * not recognise. Unknown-then-skip is recoverable by extending the map and
 * running again; unknown-then-guess is not recoverable at all.
 *
 * `agent_name` is a separate axis — human versus automation — but a message
 * carrying one was necessarily sent BY us, so it settles direction too.
 */
export function wabisDirection(raw: Record<string, unknown>): "in" | "out" | null {
  const sender = (
    pick(raw, "sender", "direction", "type_of_message", "message_direction", "sent_by", "is_sent") ?? ""
  ).toLowerCase();

  const OUTBOUND = new Set([
    "bot",
    "agent",
    "business",
    "out",
    "outgoing",
    "outbound",
    "sent",
    "system",
    "automation",
    "admin",
    "livechat",
    "live_chat",
    "human",
    "api",
    "broadcast",
    "campaign",
    // Observed in this account's own history on the first successful read: a
    // Wabis drip step. It is ours, and it was being skipped as unrecognised —
    // which is the mechanism working, one round trip rather than one silent
    // misfile.
    "sequence",
    "flow",
    "workflow",
    "chatbot",
    "template",
    "me",
  ]);
  const INBOUND = new Set(["user", "subscriber", "customer", "contact", "client", "in", "incoming", "inbound", "them"]);

  if (OUTBOUND.has(sender)) return "out";
  if (INBOUND.has(sender)) return "in";
  if (pick(raw, "agent_name")) return "out";
  // Truthy in the shapes a PHP/MySQL backend actually returns — `=== true` alone
  // missed the 1 and "1" that are far likelier than a JSON boolean.
  if (isTruthy(raw.is_outgoing) || isTruthy(raw.from_business)) return "out";
  return null;
}

/**
 * Whether a `/get/conversation` row is a Wabis EVENT rather than a message.
 *
 * The endpoint returns the panel's activity log interleaved with the actual
 * conversation. The first real read of this account produced:
 *
 *     { sender: "system", message_content: "Label added: Meta Leads",
 *       wa_message_id: null, message_status: null }
 *
 * which is somebody tagging a contact inside Wabis. Imported as-is it becomes an
 * outbound chat bubble reading "Label added: Meta Leads" — noise in a thread a
 * consultant is trying to read, and permanent.
 *
 * Both conditions are required, because either alone would catch real messages.
 * A WhatsApp message that Wabis actually sent or received carries Meta's own
 * payload as JSON in `message_content`, and carries a wamid. An internal event
 * has plain prose and no wamid, because Meta never saw it.
 */
export function isWabisInternalEvent(raw: Record<string, unknown>): boolean {
  const hasWamid = !!pick(raw, "wa_message_id", "message_id", "wamid");
  if (hasWamid) return false;
  const content = typeof raw.message_content === "string" ? raw.message_content.trim() : "";
  return content.length > 0 && !content.startsWith("{");
}

function isTruthy(v: unknown): boolean {
  if (v === true || v === 1) return true;
  return typeof v === "string" && ["1", "true", "yes"].includes(v.trim().toLowerCase());
}

/**
 * Wabis timestamps are `Y-m-d H:i:s` with NO timezone marker.
 *
 * Left to JavaScript that string is read in the server's zone — UTC on Vercel —
 * which would shift every imported message by the offset and scramble a thread
 * that mixes imported and live messages. The panel displays IST and the account
 * is Asia/Kolkata, so it is read as IST here.
 *
 * That is an assumption, not a documented fact. It is one constant to change,
 * and the dry run surfaces a raw record so it can be checked against a message
 * whose real time is known.
 */
const WABIS_UTC_OFFSET = "+05:30";

export function parseWabisTime(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;

  // Seconds optional, fractional seconds optional — MySQL DATETIME(6) renders
  // `17:56:19.000000`, and the exact-length regex sent every one of those down
  // the fallback, where `new Date()` read it in the SERVER's zone. That is the
  // very mistake WABIS_UTC_OFFSET exists to prevent, and it is worse than a
  // uniform error: the same thread ends up mixing correctly-read rows with rows
  // 5h30m later, so a reply sorts before the message it answers.
  const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (m) {
    const p = (v: string | undefined, fallback = "00") => (v ?? fallback).padStart(2, "0");
    return parseWaTimestamp(
      `${m[1]}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${m[5]}:${p(m[6])}${WABIS_UTC_OFFSET}`,
    );
  }

  // Anything else is only trusted when it carries its own zone, or is a bare
  // epoch. A zone-less string that reaches `new Date()` silently acquires the
  // server's zone, and a wrong time on a one-off import is permanent.
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(t);
  const epoch = /^\d{9,13}$/.test(t);
  if (!zoned && !epoch) return null;
  return parseWaTimestamp(t);
}

/** Redact anything that looks like a token before a raw sample reaches a browser. */
export function redactSample(raw: unknown): unknown {
  const o = asObject(raw);
  if (!o) return raw;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = /token|secret|key|auth/i.test(k) ? "«redacted»" : v;
  }
  return out;
}

/**
 * Import history. Safe to run repeatedly — messages collide on
 * `providerMessageId`, and conversation aggregates are recomputed from what is
 * stored rather than incremented.
 */
export async function importWabisHistory(opts: WabisImportOptions): Promise<WabisImportSummary> {
  const summary: WabisImportSummary = {
    dryRun: opts.dryRun,
    subscribersSeen: 0,
    conversationsTouched: 0,
    messagesFound: 0,
    messagesImported: 0,
    leadsMatched: 0,
    skippedNoPhone: 0,
    stoppedEarly: false,
    sampleRaw: null,
    observedKeys: [],
    observedSenders: [],
    rawResponse: null,
    requestSent: null,
    resumedFrom: 1,
    nextCursor: 1,
    totalProcessed: 0,
    moreToDo: false,
    rateLimited: false,
    retried: 0,
    stillFailing: 0,
    skippedNumbers: [],
    messagesUndated: 0,
    messagesUnknownSender: 0,
    eventsSkipped: 0,
    leadsNamed: 0,
    errors: [],
  };

  /**
   * Contacts to hand to the next run. Deliberately a plain array appended to
   * from concurrent work — JavaScript runs one of these at a time, so there is
   * no interleaving hazard, and the set-uniquing happens once at the end.
   */
  const stillFailing: string[] = [];
  const recordFailure = (wabisPhone: string) => {
    if (stillFailing.length < MAX_FAILED_TRACKED) stillFailing.push(wabisPhone);
  };

  const tokenOrNull = (await getSetting(WABIS_API_TOKEN_KEY).catch(() => null))?.trim();
  if (!tokenOrNull) {
    summary.errors.push("No Wabis API token set — paste it above and press Save key.");
    return summary;
  }
  // Aliased after the guard: processSubscriber below is a hoisted function
  // declaration, and TypeScript drops the narrowing for anything it captures
  // since it cannot prove the guard ran first.
  const token: string = tokenOrNull;

  // Wabis scopes conversation reads to a bot's number. Reused from the Cloud
  // settings rather than asked for twice: it is the same number either way.
  const config = {
    phoneNumberId: (await getSetting(WA_CLOUD_PHONE_NUMBER_ID_KEY).catch(() => null))?.trim() || null,
  };
  if (!config.phoneNumberId) {
    summary.errors.push(
      "No WhatsApp phone number id set — fill it in under Cloud API above. Wabis scopes both the contact list and every conversation to it.",
    );
    return summary;
  }

  const deadline = Date.now() + TIME_BUDGET_MS;
  const keys = new Set<string>();
  const senders = new Map<string, { direction: string; count: number }>();

  // First response wins — one envelope is enough to read the shape off, and
  // capturing every page would bury it.
  const capture = (raw: string, request: string) => {
    if (summary.rawResponse === null) {
      summary.rawResponse = raw;
      summary.requestSent = request;
    }
  };

  // Where the last run stopped. A sweep of a whole account cannot finish inside
  // one request, so each run picks up where the previous left off — otherwise
  // every run re-reads the same first contacts and the sweep never reaches the
  // twenty-first, while still reporting work done each time.
  //
  // A single named number is a spot check, not part of the sweep, so it neither
  // reads nor moves the cursor.
  const progress = opts.onlyPhone || opts.dryRun ? null : await readImportProgress();

  // A finished sweep stays finished until someone says otherwise. `done` used to
  // be written and never read, so the click after "the sweep is complete"
  // re-fetched the whole account from the first contact — re-running storeThread
  // over threads the live mirror had since taken ownership of.
  if (progress?.done && !opts.restart && !opts.onlyPhone) {
    summary.resumedFrom = progress.cursor;
    summary.nextCursor = progress.cursor;
    summary.totalProcessed = progress.processed;
    summary.moreToDo = false;
    summary.errors.push(
      "The sweep already reached the end. Press Start over if you genuinely want to run it again from the first contact.",
    );
    return summary;
  }

  const startOffset = opts.restart || !progress ? 1 : progress.cursor;
  summary.resumedFrom = startOffset;
  summary.nextCursor = startOffset;
  summary.totalProcessed = opts.restart ? 0 : (progress?.processed ?? 0);

  // Contacts are processed several at a time: each is one round trip of a second
  // or two, and waiting on them sequentially spent the whole budget on latency.
  // Returns false when the batch did not finish, which is what holds the cursor.
  async function runBatchOf(
    page: Record<string, unknown>[],
  ): Promise<{ finished: boolean; consumed: number }> {
    for (let i = 0; i < page.length; i += IMPORT_CONCURRENCY) {
      if (Date.now() > deadline) {
        summary.stoppedEarly = true;
        return { finished: false, consumed: i };
      }
      const slice = page.slice(i, i + IMPORT_CONCURRENCY);
      const done = await Promise.all(slice.map((sub) => processSubscriber(sub)));
      if (done.some((ok) => !ok)) return { finished: false, consumed: i + slice.length };
    }
    return { finished: true, consumed: page.length };
  }

  let exhausted = false;
  /** Contacts counted in subscribersSeen that were retries of earlier failures. */
  let retriedSeen = 0;

  if (opts.onlyPhone) {
    // Typed by a person, not returned by the API — so here the CRM's domestic
    // default IS the right reading: someone entering a bare ten-digit mobile in
    // this box means the Indian one. Normalised up front so the loop below only
    // ever sees the full-international shape a chat_id already has.
    const typed = typedPhoneToE164(opts.onlyPhone);
    if (!typed) {
      summary.errors.push(`Could not read "${opts.onlyPhone}" as a phone number.`);
      return summary;
    }
    await processSubscriber({ chat_id: typed.slice(1) });
    exhausted = true;
  } else {
    // Contacts a previous run could not fetch, retried before the sweep goes any
    // further — a failure that is only ever recorded and never revisited is the
    // same as one that was dropped.
    const retrying = opts.restart ? [] : (progress?.failed ?? []);
    if (retrying.length > 0) {
      summary.retried = retrying.length;
      const { consumed } = await runBatchOf(retrying.map((chatId) => ({ chat_id: chatId })));
      // Anything that failed again has already put itself back on the list; the
      // ones this run never reached have to be kept by hand, or the retry list
      // would quietly empty itself without the work being done.
      stillFailing.push(...retrying.slice(consumed));
      // A retry is work redone, not ground gained. Counting it toward the swept
      // total would walk "N contacts swept so far" past the size of the account.
      retriedSeen = summary.subscribersSeen;
    }

    // Page by page, advancing the cursor ONLY past a page that finished. A page
    // redone after an interrupted run costs a few re-fetches, all of which
    // dedupe; a cursor that steps over contacts nobody processed loses their
    // history permanently, and the summary reports success either way.
    let offset = startOffset;
    while (summary.subscribersSeen < opts.maxSubscribers) {
      if (Date.now() > deadline) {
        summary.stoppedEarly = true;
        break;
      }

      let page: Awaited<ReturnType<typeof fetchSubscriberPage>>;
      try {
        page = await fetchSubscriberPage(token, offset, capture, config.phoneNumberId);
      } catch (e) {
        // Either way the cursor stays put, so nothing is lost — but only one of
        // these is worth an operator's attention.
        if (isRateLimit(e)) summary.rateLimited = true;
        else summary.errors.push(e instanceof Error ? e.message : String(e));
        break;
      }

      if (page.subscribers.length === 0) {
        exhausted = true;
        break;
      }

      const { finished } = await runBatchOf(page.subscribers);
      if (!finished) break;

      // Only now, with every contact on it accounted for, does the page count as
      // swept.
      offset = page.nextOffset;
      summary.nextCursor = offset;
      if (page.lastPage) {
        exhausted = true;
        break;
      }
    }
  }

  /**
   * One contact, start to finish.
   *
   * Returns FALSE when the contact could not be finished — which is how the
   * cursor learns not to step over them. Everything this function reports as
   * true is either imported or deliberately recorded as skipped; nothing falls
   * between the two silently.
   */
  async function processSubscriber(sub: Record<string, unknown>): Promise<boolean> {
    summary.subscribersSeen++;

    const rawPhone = subscriberPhone(sub);
    const phoneE164 = waIdToE164(rawPhone);
    if (!phoneE164) {
      summary.skippedNoPhone++;
      // Named, not just counted: "5 contacts had no usable number" cannot be
      // acted on, and on a one-shot run the list is the only chance to act.
      if (summary.skippedNumbers.length < 50 && rawPhone) summary.skippedNumbers.push(rawPhone);
      return true;
    }
    // Wabis wants the same digits back without the plus. Derived from the value
    // we just settled on rather than re-parsed from the raw field, so what we ask
    // Wabis about and what we file the answer under cannot drift apart.
    const wabisPhone = phoneE164.slice(1);

    const messages: WabisRawMessage[] = [];
    // Guards against pagination not advancing and returning the same page
    // forever, which would silently burn the whole time budget on one contact
    // and look like a slow import rather than a bug.
    const seenIds = new Set<string>();
    // Wabis's spec describes `offset` as "Page number of pagination. Default 1",
    // but its response returns `nextOffset: 101` for a limit of 10 — which is a
    // record offset, not a page. The page documents both and reconciles neither.
    //
    // So neither is assumed: we start at the documented default and then follow
    // whatever `nextOffset` the response gives us. That is correct under either
    // reading, and needs no round-trip to settle which one is real.
    let offset = 1;
    for (let page = 1; ; page++) {
      if (Date.now() > deadline) {
        // Abandon the contact rather than store what we have. A half-fetched
        // thread looks complete in the inbox — the aggregates recompute over the
        // partial set — so nobody could tell it was missing most of its history
        // without going back to Wabis for that specific number. Refetching it
        // whole next run costs a round trip; the alternative costs a repair
        // script and someone knowing to write one.
        summary.stoppedEarly = true;
        return false;
      }
      let payload: unknown;
      let batch: Record<string, unknown>[];
      try {
        payload = await wabisPost(
          "/get/conversation",
          token,
          {
            // Digits only, no leading plus — Wabis's own send spec is explicit
            // that phone_number is "E164 digits, country code, no +". Passing
            // the CRM's stored "+91…" is why the first run matched nothing.
            phone_number: wabisPhone,
            phone_number_id: config.phoneNumberId ?? "",
            // Both required; limit is capped at 50 by the API.
            limit: String(PAGE_SIZE),
            offset: String(offset),
          },
          capture,
        );
        batch = findRecordArray(payload);
      } catch (e) {
        // Rate limiting says nothing about this contact, so it must not be
        // recorded as a failure or stepped over. Returning false leaves the page
        // unfinished, which holds the cursor exactly where it is.
        if (isRateLimit(e)) {
          summary.rateLimited = true;
          return false;
        }
        // Remembered by number, not just reported. A one-off run's error strings
        // live in a browser tab; the contact behind them has to outlive it or
        // their history is simply gone, and nobody can name whose.
        summary.errors.push(`${phoneE164}: ${e instanceof Error ? e.message : String(e)}`);
        recordFailure(wabisPhone);
        return true;
      }
      if (batch.length === 0) break;

      let fresh = 0;
      for (const raw of batch) {
        if (!summary.sampleRaw) summary.sampleRaw = redactSample(raw);
        for (const k of Object.keys(raw)) keys.add(k);

        const normalised = normalizeWabisMessage(raw);

        // Panel activity ("Label added: …") is not conversation. Checked before
        // the sender tally so the log's own senders do not pad the list an
        // operator is reading to spot a real misfile.
        if (isWabisInternalEvent(raw)) {
          summary.eventsSkipped++;
          continue;
        }

        const senderValue = pick(raw, "sender") ?? "(absent)";
        const seenSender = senders.get(senderValue);
        if (seenSender) seenSender.count++;
        else senders.set(senderValue, { direction: normalised.direction ?? "unrecognised", count: 1 });

        // An unrecognised sender is left out rather than filed on a guess. It
        // shows up in observedSenders, the map gets one more value, and a re-run
        // picks the record up — none of which is possible once a wrong direction
        // has been written and deduped against.
        if (normalised.direction === null) {
          summary.messagesUnknownSender++;
          continue;
        }

        // Identity for the repeat check. Falling back to the whole record keeps
        // the guard working for a provider that returns no id at all — without
        // it, an id-less response would loop until the deadline.
        const identity = normalised.providerMessageId ?? JSON.stringify(raw);
        if (seenIds.has(identity)) continue;
        seenIds.add(identity);
        fresh++;
        messages.push(normalised);
      }
      summary.messagesFound += fresh;

      // Nothing new on this page means pagination is not advancing. Stop rather
      // than ask again for the same rows.
      if (fresh === 0) break;
      if (batch.length < PAGE_SIZE) break;

      // Follow the server's own cursor when it offers one; fall back to
      // incrementing the page number, which is the other documented reading.
      const next = nextOffsetOf(payload);
      offset = next !== null && next !== offset ? next : offset + 1;
    }

    if (messages.length === 0) return true;
    if (opts.dryRun) {
      summary.conversationsTouched++;
      return true;
    }

    try {
      const imported = await storeThread(phoneE164, messages, subscriberName(sub));
      summary.conversationsTouched++;
      summary.messagesImported += imported.stored;
      summary.messagesUndated += imported.undated;
      if (imported.leadMatched) summary.leadsMatched++;
      if (imported.namedLead) summary.leadsNamed++;
    } catch (e) {
      summary.errors.push(`${phoneE164}: ${e instanceof Error ? e.message : String(e)}`);
      recordFailure(wabisPhone);
    }
    return true;
  }

  // The cursor is written from pages that FINISHED — summary.nextCursor was
  // advanced page by page above and is still `startOffset` if none did. A dry
  // run must not move it at all, or the sweep would skip everyone it previewed,
  // and a single named number is a spot check rather than part of the sweep.
  if (!opts.onlyPhone && !opts.dryRun) {
    summary.totalProcessed += summary.subscribersSeen - retriedSeen;
    summary.moreToDo = !exhausted || stillFailing.length > 0;
    await writeImportProgress({
      // Keep the final position rather than rewinding to 1. Resetting it made
      // "the sweep is complete" and "start again from the beginning" the same
      // state, so the next click silently re-imported the whole account.
      cursor: summary.nextCursor,
      processed: summary.totalProcessed,
      done: exhausted && stillFailing.length === 0,
      failed: [...new Set(stillFailing)].slice(0, MAX_FAILED_TRACKED),
    });
  } else {
    summary.moreToDo = !exhausted;
  }
  summary.stillFailing = [...new Set(stillFailing)].length;

  summary.observedKeys = [...keys].sort();
  summary.observedSenders = [...senders.entries()]
    .map(([value, v]) => ({ value, direction: v.direction, count: v.count }))
    .sort((a, b) => b.count - a.count);
  if (summary.errors.length) logger.warn("wabis_import_errors", { count: summary.errors.length });
  return summary;
}

/**
 * Write one imported thread.
 *
 * Two deliberate differences from live ingest:
 *
 *   - `unreadCount` stays 0. These conversations were already handled in Wabis;
 *     marking months of history unread would hand the team a badge showing
 *     thousands and destroy the signal the inbox exists to give.
 *   - aggregates are RECOMPUTED from the stored rows rather than advanced
 *     message-by-message, because history arrives out of order and the
 *     forward-only guard would otherwise take whichever page happened to land last.
 */
async function storeThread(
  phoneE164: string,
  messages: readonly WabisRawMessage[],
  contactName: string | null,
): Promise<{ stored: number; leadMatched: boolean; undated: number; namedLead: boolean }> {
  const lead = await prisma.lead.findFirst({
    where: { OR: [{ phoneE164 }, { altPhoneE164: phoneE164 }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, assignedToId: true, candidateName: true },
  });

  // History with no readable time is dropped, never stamped with the clock.
  // `occurredAt: new Date()` turned an absent field into a wrong-but-plausible
  // one: a 2025 message dated today, pinned to the top of the thread, and — if
  // inbound — opening a 24-hour reply window that closed months ago, so the
  // composer offers free text that Meta then rejects. parseWaTimestamp goes out
  // of its way not to guess; this threw that away one line later.
  // The predicate narrows both fields at once: an unrecognised sender was
  // already dropped upstream, and saying so here keeps that guarantee in the
  // types rather than in a comment somebody has to trust.
  const datable = messages.filter(
    (m): m is WabisRawMessage & { occurredAt: Date; direction: "in" | "out" } =>
      !!m.occurredAt && m.direction !== null,
  );
  const undated = messages.length - datable.length;

  const conversation = await prisma.waConversation.upsert({
    where: { phoneE164 },
    create: {
      phoneE164,
      leadId: lead?.id ?? null,
      assignedToId: lead?.assignedToId ?? null,
      // Historic threads arrive closed. The inbox's default view is "needs
      // reply", so importing a year of conversations open would bury every
      // genuinely unanswered live thread under hundreds of dead ones — the same
      // harm the deliberate `unreadCount: 0` decision below was taken to avoid.
      status: "closed",
    },
    // An existing conversation belongs to the live mirror; the import adds
    // messages to it and does not touch its triage state.
    update: lead ? { leadId: lead.id } : {},
    select: { id: true, status: true },
  });

  const stored = await prisma.waMessage.createMany({
    data: datable.map((m) => ({
      conversationId: conversation.id,
      direction: m.direction,
      type: m.type,
      body: m.body,
      mediaUrl: m.mediaUrl,
      // A row with no wamid cannot dedupe: Postgres treats NULLs as distinct, so
      // `skipDuplicates` never fires and every re-run inserts another copy. The
      // synthetic key is namespaced by provider and phone so it can never be
      // mistaken for — or collide with — a Meta wamid.
      providerMessageId: m.providerMessageId ?? syntheticMessageKey(phoneE164, m),
      provider: "wabis",
      templateName: m.templateName,
      waStatus: m.waStatus,
      waErrorMessage: m.waErrorMessage,
      readAt: m.readAt,
      occurredAt: m.occurredAt,
    })),
    // The replay guard: re-running after adjusting the field mapping cannot
    // duplicate anything that already landed.
    skipDuplicates: true,
  });

  // Recompute from what is actually stored, so imported and live messages agree.
  const [newest, newestInbound] = await Promise.all([
    prisma.waMessage.findFirst({
      where: { conversationId: conversation.id },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true, direction: true },
    }),
    prisma.waMessage.findFirst({
      where: { conversationId: conversation.id, direction: "in" },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    }),
  ]);

  const lastMessageAt = newest?.occurredAt ?? null;
  const lastInboundAt = newestInbound?.occurredAt ?? null;

  await prisma.waConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt,
      lastInboundAt,
      sessionExpiresAt: lastInboundAt ? sessionExpiryFrom(lastInboundAt) : null,
      // Only a thread whose reply window is genuinely still open can be waiting
      // on us — anything older cannot be answered with free text anyway, so
      // flagging it adds a task nobody can do. Decided from the newest message's
      // DIRECTION rather than comparing two second-precision timestamps, because
      // a bot answering inside the same second reads as a tie and ties resolved
      // to "awaiting".
      awaitingReply:
        !!lastInboundAt && isSessionOpen(sessionExpiryFrom(lastInboundAt)) && newest?.direction === "in",
    },
  });

  // Give a placeholder lead its real name. `createInboundLead` names an unknown
  // number after the number itself, deliberately — but Wabis knows who they are,
  // so leaving the digits in place would be choosing the worse of two values we
  // hold at once. A lead somebody has actually named is never overwritten.
  let namedLead = false;
  if (lead && contactName && lead.candidateName === phoneE164) {
    await prisma.lead
      .updateMany({ where: { id: lead.id, candidateName: phoneE164 }, data: { candidateName: contactName } })
      .then((r) => {
        namedLead = r.count > 0;
      })
      .catch(() => undefined);
  }

  return { stored: stored.count, leadMatched: !!lead, undated, namedLead };
}

/**
 * A dedupe key for a message Wabis gave us no wamid for.
 *
 * Deterministic, so the same row on a later run collides with itself rather than
 * inserting a second copy — which is the entire point, since re-running is the
 * documented way to recover from a mapping fix. Namespaced with a `wabis:`
 * prefix that no Meta wamid can have.
 */
function syntheticMessageKey(phoneE164: string, m: WabisRawMessage): string {
  const at = m.occurredAt ? m.occurredAt.toISOString() : "undated";
  const body = (m.body ?? m.mediaUrl ?? "").slice(0, 80);
  return `wabis:${phoneE164}:${at}:${m.direction}:${body}`;
}
