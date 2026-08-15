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
import { normalizePhone } from "../crm";
import { toWabisPhone } from "../crm-webhook";
import { logger } from "../logger";
import { getSetting, WABIS_API_TOKEN_KEY, WA_CLOUD_PHONE_NUMBER_ID_KEY } from "../app-settings";
import { normalizeMessageType, parseWaTimestamp, type WaMessageType } from "./inbound";
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
};

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
  capture?.(text.slice(0, 1500), `POST ${path} ${new URLSearchParams({ apiToken: "«redacted»", ...params })}`);
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
  const dirRaw = (pick(raw, "direction", "type_of_message", "message_direction", "is_sent", "sent_by") ?? "").toLowerCase();
  const outbound =
    dirRaw === "out" ||
    dirRaw === "outgoing" ||
    dirRaw === "sent" ||
    dirRaw === "business" ||
    dirRaw === "agent" ||
    dirRaw === "1" ||
    raw.is_outgoing === true ||
    raw.from_business === true;

  const content = pick(raw, "message_content", "message", "text", "body", "content", "caption");
  // Wabis rewrites incoming media to its own storage; the console renders that
  // URL inline in the message content, so it may arrive as the body itself.
  const mediaUrl =
    pick(raw, "media_url", "mediaUrl", "file_url", "attachment_url", "url") ??
    (content && /^https?:\/\/\S+$/i.test(content) ? content : null) ??
    (content?.match(/https?:\/\/\S*wasabisys\.com\/\S+/i)?.[0] ?? null);

  return {
    providerMessageId: pick(raw, "wa_message_id", "message_id", "wamid", "id"),
    direction: outbound ? "out" : "in",
    type: normalizeMessageType(pick(raw, "message_type", "type", "media_type")),
    body: content,
    mediaUrl,
    occurredAt: parseWaTimestamp(
      raw.timestamp ?? raw.created_at ?? raw.createdAt ?? raw.sent_at ?? raw.date ?? raw.time,
    ),
  };
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
    rawResponse: null,
    requestSent: null,
    errors: [],
  };

  const token = (await getSetting(WABIS_API_TOKEN_KEY).catch(() => null))?.trim();
  if (!token) {
    summary.errors.push("No Wabis API token set — paste it above and press Save key.");
    return summary;
  }

  // Wabis scopes conversation reads to a bot's number. Reused from the Cloud
  // settings rather than asked for twice: it is the same number either way.
  const config = {
    phoneNumberId: (await getSetting(WA_CLOUD_PHONE_NUMBER_ID_KEY).catch(() => null))?.trim() || null,
  };

  const deadline = Date.now() + TIME_BUDGET_MS;
  const keys = new Set<string>();

  // First response wins — one envelope is enough to read the shape off, and
  // capturing every page would bury it.
  const capture = (raw: string, request: string) => {
    if (summary.rawResponse === null) {
      summary.rawResponse = raw;
      summary.requestSent = request;
    }
  };

  // A single number is the safest first test: one subscriber, one thread.
  let subscribers: Record<string, unknown>[];
  if (opts.onlyPhone) {
    subscribers = [{ phone_number: opts.onlyPhone }];
  } else {
    try {
      subscribers = findRecordArray(
        await wabisPost("/subscriber/list", token, { page: "1" }, capture),
      ).slice(0, opts.maxSubscribers);
    } catch (e) {
      summary.errors.push(e instanceof Error ? e.message : String(e));
      return summary;
    }
  }

  for (const sub of subscribers) {
    if (Date.now() > deadline) {
      summary.stoppedEarly = true;
      break;
    }
    summary.subscribersSeen++;

    const rawPhone = pick(sub, "phone_number", "phone", "wa_id", "msisdn", "mobile");
    const phoneE164 = normalizePhone(rawPhone);
    const wabisPhone = toWabisPhone(rawPhone);
    if (!phoneE164 || !wabisPhone) {
      summary.skippedNoPhone++;
      continue;
    }

    const messages: WabisRawMessage[] = [];
    for (let page = 1; ; page++) {
      if (Date.now() > deadline) {
        summary.stoppedEarly = true;
        break;
      }
      let batch: Record<string, unknown>[];
      try {
        batch = findRecordArray(
          await wabisPost(
            "/get/conversation",
            token,
            {
              // Digits only, no leading plus — Wabis's own send spec is explicit
              // that phone_number is "E164 digits, country code, no +". Passing
              // the CRM's stored "+91…" is why the first run matched nothing.
              phone_number: wabisPhone,
              phone_number_id: config.phoneNumberId ?? "",
              page: String(page),
            },
            capture,
          ),
        );
      } catch (e) {
        summary.errors.push(`${phoneE164}: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
      if (batch.length === 0) break;

      for (const raw of batch) {
        if (!summary.sampleRaw) summary.sampleRaw = redactSample(raw);
        for (const k of Object.keys(raw)) keys.add(k);
        messages.push(normalizeWabisMessage(raw));
      }
      summary.messagesFound += batch.length;
      if (batch.length < PAGE_SIZE) break;
    }

    if (messages.length === 0) continue;
    if (opts.dryRun) {
      summary.conversationsTouched++;
      continue;
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

  summary.observedKeys = [...keys].sort();
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
