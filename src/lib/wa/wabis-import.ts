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
import { isAwaitingReply } from "./inbox";
import { sessionExpiryFrom } from "./mirror";

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
  errors: string[];
};

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
type ImportProgress = { cursor: number; processed: number; done: boolean };

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
    };
  } catch {
    return null;
  }
}

async function writeImportProgress(p: ImportProgress): Promise<void> {
  await setSetting(WA_IMPORT_PROGRESS_KEY, JSON.stringify(p)).catch(() => undefined);
}

/**
 * Every Wabis subscriber, up to `max`, paged.
 *
 * Sends `limit` and `phone_number_id` because Wabis refuses without either — the
 * contact list is scoped to a bot's number exactly as the conversation read is,
 * which is not what "list my subscribers" suggests. Both were learnt from
 * rejections rather than documentation, one per round trip, which is why the dry
 * run reports the raw envelope.
 *
 * Pages by following the server's own `nextOffset`, the same way conversations
 * do, since the spec's description of `offset` as a page number contradicts the
 * record offset it actually returns. Stops on a page that adds nobody new, so a
 * server ignoring pagination cannot spin until the deadline.
 */
async function listSubscribers(
  token: string,
  max: number,
  deadline: number,
  capture: (raw: string, request: string) => void,
  startOffset: number,
  phoneNumberId: string | null,
): Promise<{ subscribers: Record<string, unknown>[]; nextOffset: number; exhausted: boolean }> {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let offset = startOffset;
  let exhausted = false;

  for (let page = 1; out.length < max; page++) {
    if (Date.now() > deadline) break;

    const payload = await wabisPost(
      "/subscriber/list",
      token,
      {
        limit: String(PAGE_SIZE),
        offset: String(offset),
        phone_number_id: phoneNumberId ?? "",
      },
      capture,
    );
    const batch = findRecordArray(payload);
    // An empty page means we have reached the end of the list — the sweep is
    // finished, as distinct from merely stopping on this run's limit.
    if (batch.length === 0) {
      exhausted = true;
      break;
    }

    let fresh = 0;
    for (const s of batch) {
      const identity = JSON.stringify(s);
      if (seen.has(identity)) continue;
      seen.add(identity);
      out.push(s);
      fresh++;
      if (out.length >= max) break;
    }

    const next = nextOffsetOf(payload);
    const advanced = next !== null && next !== offset ? next : offset + 1;

    if (fresh === 0) {
      exhausted = true;
      break;
    }
    if (batch.length < PAGE_SIZE) {
      // A short page is the last page; the cursor still moves past it so a
      // resume does not re-read what we just took.
      offset = advanced;
      exhausted = true;
      break;
    }
    offset = advanced;
  }

  return { subscribers: out.slice(0, max), nextOffset: offset, exhausted };
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
  direction: "in" | "out";
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
    direction: wabisDirection(raw),
    type,
    body,
    mediaUrl,
    occurredAt: parseWabisTime(raw.conversation_time) ?? parseWaTimestamp(raw.timestamp ?? raw.created_at ?? raw.sent_at),
    templateName: isTemplate ? pick(inner!, "name") : null,
    // Wabis already recorded what Meta did with each message, so imported
    // threads arrive with real delivery ticks instead of a wall of unknowns.
    waStatus: normalizeWabisStatus(pick(raw, "message_status")),
    waErrorMessage: pick(raw, "failed_reason"),
    readAt: parseWabisTime(raw.read_time),
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
 * Which way a Wabis message went.
 *
 * The field is `sender`, and its value set is NOT documented — the spec's only
 * example shows `"bot"`. So the outbound markers we know are matched explicitly
 * and everything else falls to inbound, which is the safer misfile: a wrongly
 * inbound message reads as the candidate saying something odd, a wrongly
 * outbound one looks like we said something we never did.
 *
 * `agent_name` is a separate axis — human versus automation — but a message
 * carrying one was necessarily sent BY us, so it settles direction too.
 */
export function wabisDirection(raw: Record<string, unknown>): "in" | "out" {
  const sender = (
    pick(raw, "sender", "direction", "type_of_message", "message_direction", "sent_by", "is_sent") ?? ""
  ).toLowerCase();
  const OUTBOUND = new Set(["bot", "agent", "business", "out", "outgoing", "sent", "system", "automation"]);
  if (OUTBOUND.has(sender)) return "out";
  if (pick(raw, "agent_name")) return "out";
  if (raw.is_outgoing === true || raw.from_business === true) return "out";
  return "in";
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
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return parseWaTimestamp(t);
  return parseWaTimestamp(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${WABIS_UTC_OFFSET}`);
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
    errors: [],
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
  const startOffset = opts.restart || !progress ? 1 : progress.cursor;
  summary.resumedFrom = startOffset;
  summary.nextCursor = startOffset;
  summary.totalProcessed = opts.restart ? 0 : (progress?.processed ?? 0);

  let subscribers: Record<string, unknown>[];
  let listedNext = startOffset;
  let exhausted = false;
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
    subscribers = [{ chat_id: typed.slice(1) }];
    exhausted = true;
  } else {
    try {
      const listed = await listSubscribers(
        token,
        opts.maxSubscribers,
        deadline,
        capture,
        startOffset,
        config.phoneNumberId,
      );
      subscribers = listed.subscribers;
      listedNext = listed.nextOffset;
      exhausted = listed.exhausted;
    } catch (e) {
      summary.errors.push(e instanceof Error ? e.message : String(e));
      return summary;
    }
  }

  // Contacts are processed several at a time: each is one round trip of a second
  // or two, and waiting on them sequentially spent the whole budget on latency.
  for (let i = 0; i < subscribers.length; i += IMPORT_CONCURRENCY) {
    if (Date.now() > deadline) {
      summary.stoppedEarly = true;
      break;
    }
    await Promise.all(subscribers.slice(i, i + IMPORT_CONCURRENCY).map((sub) => processSubscriber(sub)));
  }

  async function processSubscriber(sub: Record<string, unknown>): Promise<void> {
    summary.subscribersSeen++;

    const rawPhone = subscriberPhone(sub);
    const phoneE164 = waIdToE164(rawPhone);
    if (!phoneE164) {
      summary.skippedNoPhone++;
      return;
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
        summary.stoppedEarly = true;
        break;
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
        summary.errors.push(`${phoneE164}: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
      if (batch.length === 0) break;

      let fresh = 0;
      for (const raw of batch) {
        if (!summary.sampleRaw) summary.sampleRaw = redactSample(raw);
        for (const k of Object.keys(raw)) keys.add(k);

        const normalised = normalizeWabisMessage(raw);

        const senderValue = pick(raw, "sender") ?? "(absent)";
        const seenSender = senders.get(senderValue);
        if (seenSender) seenSender.count++;
        else senders.set(senderValue, { direction: normalised.direction, count: 1 });

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

    if (messages.length === 0) return;
    if (opts.dryRun) {
      summary.conversationsTouched++;
      return;
    }

    try {
      const imported = await storeThread(phoneE164, messages);
      summary.conversationsTouched++;
      summary.messagesImported += imported.stored;
      if (imported.leadMatched) summary.leadsMatched++;
    } catch (e) {
      summary.errors.push(`${phoneE164}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Advance the cursor only for a real sweep that actually got through its batch.
  // A dry run must not move it, or the sweep would skip everyone it previewed.
  if (!opts.onlyPhone && !opts.dryRun) {
    summary.nextCursor = listedNext;
    summary.totalProcessed += summary.subscribersSeen;
    summary.moreToDo = !exhausted;
    await writeImportProgress({
      cursor: exhausted ? 1 : listedNext,
      processed: summary.totalProcessed,
      done: exhausted,
    });
  } else {
    summary.moreToDo = !exhausted;
  }

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
): Promise<{ stored: number; leadMatched: boolean }> {
  const lead = await prisma.lead.findFirst({
    where: { OR: [{ phoneE164 }, { altPhoneE164: phoneE164 }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, assignedToId: true },
  });

  const conversation = await prisma.waConversation.upsert({
    where: { phoneE164 },
    create: {
      phoneE164,
      leadId: lead?.id ?? null,
      assignedToId: lead?.assignedToId ?? null,
      status: "open",
    },
    update: lead ? { leadId: lead.id } : {},
    select: { id: true },
  });

  const stored = await prisma.waMessage.createMany({
    data: messages.map((m) => ({
      conversationId: conversation.id,
      direction: m.direction,
      type: m.type,
      body: m.body,
      mediaUrl: m.mediaUrl,
      providerMessageId: m.providerMessageId,
      provider: "wabis",
      templateName: m.templateName,
      waStatus: m.waStatus,
      waErrorMessage: m.waErrorMessage,
      readAt: m.readAt,
      occurredAt: m.occurredAt ?? new Date(),
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
      select: { occurredAt: true },
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
      awaitingReply: isAwaitingReply({ lastInboundAt, lastMessageAt }),
    },
  });

  return { stored: stored.count, leadMatched: !!lead };
}
