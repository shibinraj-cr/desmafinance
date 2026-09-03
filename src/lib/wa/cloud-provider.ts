/**
 * Meta WhatsApp Cloud API adapter — the transport we own.
 *
 * This is the other half of the seam. Where the Wabis adapter can only poke a
 * workflow that has one template welded into it, this addresses Meta directly:
 * any template by name, free text inside the session window, real media, and the
 * template catalogue. Every capability the Wabis adapter has to report as
 * unsupported is simply available here.
 *
 * The single most valuable difference is the return value. A send comes back
 * with a `wamid`, so a delivery status arriving minutes later is matched by key
 * instead of guessed at from phone + campaign + touch. That is what turns
 * broadcast reporting from an approximation into a fact.
 *
 * Credentials are resolved per call rather than cached at module load, because
 * an admin rotating the token in Settings must take effect without a redeploy —
 * and a serverless instance can outlive a rotation.
 */
import {
  getSetting,
  WA_CLOUD_API_VERSION_KEY,
  WA_CLOUD_PHONE_NUMBER_ID_KEY,
  WA_CLOUD_TOKEN_KEY,
  WA_CLOUD_WABA_ID_KEY,
} from "../app-settings";
import { logger } from "../logger";
import {
  unsupportedMutation,
  unsupportedResult,
  type WaCapability,
  type WaMedia,
  type WaMediaStream,
  type WaSendAudioInput,
  type WaUploadInput,
  type WaUploadResult,
  type WaSendResult,
  type WaSendTemplateInput,
  type WaSendTextInput,
  type WaTemplateMutationResult,
  type WaTemplateSubmission,
  type WaTemplateSummary,
  type WhatsAppProvider,
} from "./provider";

/** Pinned so a Graph release cannot change behaviour under us. */
const DEFAULT_API_VERSION = "v21.0";
const GRAPH_HOST = "https://graph.facebook.com";
const REQUEST_TIMEOUT_MS = 10_000;
/** Longer than an API call: this one is a file transfer, not a JSON round trip. */
const MEDIA_TIMEOUT_MS = 25_000;
const MAX_RESPONSE_CHARS = 2_000;

/**
 * Default template language. Meta requires a language on every template send and
 * rejects a mismatch outright, so this is deliberately explicit rather than
 * inferred from the CRM's locale.
 */
const DEFAULT_TEMPLATE_LANGUAGE = "en";

export type CloudConfig = {
  phoneNumberId: string;
  wabaId: string | null;
  token: string;
  apiVersion: string;
};

export async function getCloudConfig(): Promise<CloudConfig | null> {
  const [phoneNumberId, wabaId, token, version] = await Promise.all([
    getSetting(WA_CLOUD_PHONE_NUMBER_ID_KEY).catch(() => null),
    getSetting(WA_CLOUD_WABA_ID_KEY).catch(() => null),
    getSetting(WA_CLOUD_TOKEN_KEY).catch(() => null),
    getSetting(WA_CLOUD_API_VERSION_KEY).catch(() => null),
  ]);

  const id = phoneNumberId?.trim() || process.env.WA_CLOUD_PHONE_NUMBER_ID || null;
  const tok = token?.trim() || process.env.WA_CLOUD_ACCESS_TOKEN || null;
  if (!id || !tok) return null;

  return {
    phoneNumberId: id,
    wabaId: wabaId?.trim() || process.env.WA_CLOUD_WABA_ID || null,
    token: tok,
    apiVersion: version?.trim() || process.env.WA_CLOUD_API_VERSION || DEFAULT_API_VERSION,
  };
}

export async function isCloudConfigured(): Promise<boolean> {
  return (await getCloudConfig()) !== null;
}

function truncate(s: string): string {
  return s.length > MAX_RESPONSE_CHARS ? `${s.slice(0, MAX_RESPONSE_CHARS)}…` : s;
}

/**
 * Meta wants a bare international number with no `+` and no separators. Our
 * E.164 carries the plus, so it is stripped here rather than at every call site.
 */
export function toCloudRecipient(e164: string): string {
  return e164.replace(/[^0-9]/g, "");
}

/**
 * Meta's template `components`.
 *
 * A plain key ("1", "2") is a BODY variable, which is the common case. A key may
 * also name its component explicitly — `header.1`, `button.0.1` — because a
 * template is not always body-only: an approved template with a header variable
 * or a URL button rejects a send that omits that component, and Meta fails the
 * whole request. Sending only body parameters therefore breaks every recipient
 * of any template that is not body-only, which is not a shape we can assume.
 *
 * Within a component the Cloud API numbers variables {{1}}, {{2}}, …
 * positionally, so the map is ordered before it is sent. Sorting numerically
 * matters: a plain string sort puts "10" before "2" and silently shifts every
 * variable after the ninth into the wrong slot.
 */
export function buildTemplateComponents(params: Record<string, string>): unknown[] {
  if (Object.keys(params).length === 0) return [];

  // component key -> { slot -> value }. Button components carry their index.
  const groups = new Map<string, { type: string; index?: string; slots: Map<string, string> }>();

  for (const [rawKey, value] of Object.entries(params)) {
    const parts = rawKey.split(".");
    let type = "body";
    let index: string | undefined;
    let slot = rawKey;

    if (parts.length === 2) {
      [type, slot] = parts;
    } else if (parts.length === 3) {
      [type, index, slot] = parts;
    }

    const groupKey = index ? `${type}.${index}` : type;
    let group = groups.get(groupKey);
    if (!group) {
      group = { type, index, slots: new Map() };
      groups.set(groupKey, group);
    }
    group.slots.set(slot, value);
  }

  const orderSlots = (slots: Map<string, string>): string[] => {
    const keys = [...slots.keys()];
    const numeric = keys.every((k) => /^\d+$/.test(k));
    return numeric ? keys.sort((a, b) => Number(a) - Number(b)) : keys.sort();
  };

  // Meta expects header before body before buttons.
  const RANK: Record<string, number> = { header: 0, body: 1, button: 2 };
  return [...groups.values()]
    .sort((a, b) => (RANK[a.type] ?? 9) - (RANK[b.type] ?? 9) || Number(a.index ?? 0) - Number(b.index ?? 0))
    .map((group) => ({
      type: group.type,
      ...(group.type === "button" ? { sub_type: "url", index: group.index ?? "0" } : {}),
      parameters: orderSlots(group.slots).map((k) => ({ type: "text", text: group.slots.get(k)! })),
    }));
}

/**
 * Meta error codes worth retrying.
 *
 * Rate limits and transient upstream faults come back as ordinary failures, and
 * treating them as permanent burns a recipient who was never actually
 * unreachable — on a campaign that drains over days, a single rate-limit blip
 * would silently drop part of the audience. Genuine rejections (bad number,
 * template not approved, expired token) stay terminal.
 */
const RETRYABLE_CODES = new Set(["4", "80007", "130429", "131048", "131056", "133016", "500", "502", "503"]);

export function isRetryableGraphError(code: string | null, status: number | null): boolean {
  if (code && RETRYABLE_CODES.has(code)) return true;
  // No status at all means the request never completed — a timeout or a dropped
  // connection, which says nothing about the recipient.
  if (status === null) return true;
  return status === 429 || status >= 500;
}

/** Pull Meta's error code/message out of a Graph error envelope. */
export function parseGraphError(body: string): { code: string | null; message: string } {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown; error_data?: { details?: unknown } } };
    const err = parsed?.error;
    if (!err) return { code: null, message: truncate(body) };
    const details = err.error_data && typeof err.error_data === "object" ? (err.error_data as { details?: unknown }).details : null;
    return {
      code: err.code != null ? String(err.code) : null,
      message: String(details ?? err.message ?? "Send failed"),
    };
  } catch {
    return { code: null, message: truncate(body) };
  }
}

/** One Graph POST. Never throws — a transport failure is a result, not an error. */
async function graphPost(cfg: CloudConfig, path: string, payload: unknown): Promise<WaSendResult> {
  try {
    const res = await fetch(`${GRAPH_HOST}/${cfg.apiVersion}/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");

    if (!res.ok) {
      const { code, message } = parseGraphError(text);
      logger.warn("wa_cloud_send_rejected", { status: res.status, code });
      return {
        ok: false,
        providerMessageId: null,
        status: res.status,
        body: code ? `${code}: ${message}` : message,
        errorCode: code,
        retryable: isRetryableGraphError(code, res.status),
      };
    }

    // { messages: [{ id: "wamid.…" }] } — the id that makes delivery correlation
    // exact instead of a phone-and-timing guess.
    let providerMessageId: string | null = null;
    try {
      const parsed = JSON.parse(text) as { messages?: { id?: unknown }[] };
      const first = parsed?.messages?.[0]?.id;
      if (typeof first === "string" && first) providerMessageId = first;
    } catch {
      // A 2xx we cannot parse still means Meta accepted it; losing the id costs
      // status correlation, not the message.
      logger.warn("wa_cloud_send_unparseable_ok", { status: res.status });
    }

    return { ok: true, providerMessageId, status: res.status, body: truncate(text) };
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : "request failed";
    // The request never completed, so this says nothing about the recipient.
    return { ok: false, providerMessageId: null, status: null, body: truncate(msg), retryable: true };
  }
}

/**
 * One Graph call that CHANGES a template, with the template-shaped answer.
 *
 * Separate from `graphPost` rather than sharing it, because the two speak about
 * different things: a send comes back with a `wamid` and a retryable/terminal
 * verdict that a drain loop acts on, while this comes back with a template id
 * and a review status and is never retried automatically — a resubmission that
 * quietly ran twice would put two identical templates in front of Meta's
 * reviewers. Never throws; a transport failure is a result.
 */
async function graphMutate(
  cfg: CloudConfig,
  path: string,
  method: "POST" | "DELETE",
  payload: unknown,
): Promise<WaTemplateMutationResult> {
  try {
    const res = await fetch(`${GRAPH_HOST}/${cfg.apiVersion}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${cfg.token}`,
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");

    if (!res.ok) {
      const { code, message } = parseGraphError(text);
      logger.warn("wa_cloud_template_rejected", { status: res.status, code });
      return { ok: false, detail: message || `HTTP ${res.status}`, code };
    }

    // Create answers { id, status, category }; edit and delete answer
    // { success: true } with no id, which is why none of these are required.
    const parsed = (() => {
      try {
        return JSON.parse(text) as { id?: unknown; status?: unknown; category?: unknown; success?: unknown };
      } catch {
        return null;
      }
    })();

    return {
      ok: true,
      metaId: typeof parsed?.id === "string" && parsed.id ? parsed.id : null,
      status: typeof parsed?.status === "string" ? parsed.status : null,
      category: typeof parsed?.category === "string" ? parsed.category : null,
    };
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : "request failed";
    return { ok: false, detail: truncate(msg), code: null };
  }
}

/**
 * How many distinct `{{n}}` placeholders a template body carries.
 *
 * Counts DISTINCT indexes, not occurrences — `{{1}}` used twice is still one
 * value to collect. Meta rejects a send whose parameter count does not match the
 * template, so this is what lets the composer ask for the values rather than
 * discovering the mismatch as an API error.
 */
export function countTemplateVariables(body: string | null | undefined): number {
  if (!body) return 0;
  const found = new Set<number>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) found.add(n);
  }
  return found.size;
}

/** Substitute `{{n}}` placeholders for a preview. Unfilled ones stay visible. */
export function renderTemplatePreview(body: string | null, params: Record<string, string>): string {
  if (!body) return "";
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, n: string) => {
    const v = params[n]?.trim();
    return v ? v : whole;
  });
}

export type SubscribedApp = { id: string | null; name: string | null };

/**
 * Which Meta apps receive this WABA's webhooks.
 *
 * Configuring a callback URL on an app and subscribing that app to a WABA are
 * two DIFFERENT objects, and only the first is visible in Meta's dashboard. A
 * setup can therefore verify green, subscribe to the `messages` field, and still
 * receive nothing — which is exactly what happened here: the endpoint logged the
 * GET handshake and then never saw a single POST.
 *
 * No Meta UI lists this anywhere (Business Settings shows partner *businesses*,
 * not apps), so the Graph call is the only way to see it.
 */
export async function listSubscribedApps(): Promise<{ ok: boolean; apps: SubscribedApp[]; detail: string }> {
  const cfg = await getCloudConfig();
  if (!cfg?.wabaId) return { ok: false, apps: [], detail: "WhatsApp Business Account ID is not set" };

  try {
    const res = await fetch(`${GRAPH_HOST}/${cfg.apiVersion}/${cfg.wabaId}/subscribed_apps`, {
      headers: { authorization: `Bearer ${cfg.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      const { code, message } = parseGraphError(text);
      return { ok: false, apps: [], detail: code ? `${code}: ${message}` : message };
    }
    const parsed = JSON.parse(text) as { data?: { whatsapp_business_api_data?: { id?: string; name?: string } }[] };
    const apps = (parsed?.data ?? []).map((d) => ({
      id: d?.whatsapp_business_api_data?.id ?? null,
      name: d?.whatsapp_business_api_data?.name ?? null,
    }));
    return { ok: true, apps, detail: truncate(text) };
  } catch (e) {
    return { ok: false, apps: [], detail: e instanceof Error ? `${e.name}: ${e.message}` : "request failed" };
  }
}

/**
 * Subscribe OUR app to the WABA, so Meta starts delivering its events to us.
 *
 * Additive: `subscribed_apps` is a list, and the app is identified by the token
 * making the call, so this cannot touch another partner's subscription. That is
 * the property the whole run-alongside-Wabis plan depends on, and the caller
 * lists the apps afterwards so it is demonstrated rather than assumed.
 */
export async function subscribeAppToWaba(): Promise<{ ok: boolean; detail: string }> {
  const cfg = await getCloudConfig();
  if (!cfg?.wabaId) return { ok: false, detail: "WhatsApp Business Account ID is not set" };

  try {
    const res = await fetch(`${GRAPH_HOST}/${cfg.apiVersion}/${cfg.wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      const { code, message } = parseGraphError(text);
      logger.warn("wa_waba_subscribe_failed", { status: res.status, code });
      return { ok: false, detail: code ? `${code}: ${message}` : message };
    }
    return { ok: true, detail: truncate(text) };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? `${e.name}: ${e.message}` : "request failed" };
  }
}

type RawTemplate = {
  id?: string;
  name?: string;
  language?: string;
  category?: string;
  status?: string;
  rejected_reason?: string;
  components?: { type?: string; format?: string; text?: string }[];
};

/** Meta returns 25 templates a page by default; this asks for the maximum. */
const TEMPLATE_PAGE_SIZE = 200;
/** A backstop, not a cap we expect to reach: 20 pages is 4,000 templates. */
const MAX_TEMPLATE_PAGES = 20;

/** One page of Meta's catalogue, flattened into the shape the CRM speaks. */
function mapTemplatePage(rows: RawTemplate[]): WaTemplateSummary[] {
  return rows
    .filter((t): t is { name: string; language: string } & typeof t => !!t?.name && !!t.language)
    .map((t) => {
      const components = t.components ?? [];
      const partOf = (type: string) =>
        components.find((c) => (c.type ?? "").toUpperCase() === type && typeof c.text === "string")?.text ?? null;
      const body = partOf("BODY");
      const reason = (t.rejected_reason ?? "").trim();
      return {
        id: t.id ?? null,
        name: t.name,
        language: t.language,
        category: t.category ?? null,
        status: t.status ?? "UNKNOWN",
        body,
        header: partOf("HEADER"),
        variableCount: countTemplateVariables(body),
        // Meta says NONE rather than omitting the field, and a literal
        // "NONE" rendered next to an approved template reads as a rejection.
        rejectedReason: reason && reason.toUpperCase() !== "NONE" ? reason : null,
      };
    });
}

const SUPPORTED: ReadonlySet<WaCapability> = new Set<WaCapability>([
  "sendTemplate",
  "sendText",
  "fetchMedia",
  "listTemplates",
  "uploadMedia",
  "sendAudio",
  "manageTemplates",
]);

export const cloudProvider: WhatsAppProvider = {
  key: "cloud",
  label: "WhatsApp Cloud API",

  supports(capability: WaCapability): boolean {
    return SUPPORTED.has(capability);
  },

  async sendTemplate(input: WaSendTemplateInput): Promise<WaSendResult> {
    const cfg = await getCloudConfig();
    if (!cfg) return unsupportedResult("WhatsApp Cloud API is not configured — set it in CRM → Settings");

    // `template` may carry a language suffix ("welcome:en_US") because a WABA can
    // hold the same template in several languages and Meta treats them as
    // distinct sends.
    const [name, lang] = input.template.split(":");
    const components = buildTemplateComponents(input.params ?? {});

    return graphPost(cfg, `${cfg.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toCloudRecipient(input.toE164),
      type: "template",
      template: {
        name,
        language: { code: lang || DEFAULT_TEMPLATE_LANGUAGE },
        ...(components.length ? { components } : {}),
      },
    });
  },

  async sendText(input: WaSendTextInput): Promise<WaSendResult> {
    const cfg = await getCloudConfig();
    if (!cfg) return unsupportedResult("WhatsApp Cloud API is not configured — set it in CRM → Settings");

    return graphPost(cfg, `${cfg.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toCloudRecipient(input.toE164),
      type: "text",
      // Link previews are Meta's default and turn a plain reply into a card;
      // off unless we ever decide otherwise.
      text: { preview_url: false, body: input.body },
    });
  },

  /**
   * Resolve a media id to a fetchable URL.
   *
   * Meta's media URLs are short-lived AND require the bearer token to download,
   * so this returns the URL for immediate server-side use — it must never be
   * handed to a browser expecting it to work later.
   */
  async fetchMedia(mediaId: string): Promise<WaMedia | null> {
    const cfg = await getCloudConfig();
    if (!cfg) return null;

    try {
      const res = await fetch(`${GRAPH_HOST}/${cfg.apiVersion}/${mediaId}`, {
        headers: { authorization: `Bearer ${cfg.token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const d = (await res.json()) as { url?: string; mime_type?: string; file_name?: string };
      if (!d?.url) return null;
      return { url: d.url, mime: d.mime_type ?? null, fileName: d.file_name ?? null };
    } catch (e) {
      logger.warn("wa_cloud_media_failed", { mediaId, message: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  /**
   * Put bytes on the WABA and get a media id back.
   *
   * Multipart, with the mime declared on the file part rather than as a separate
   * field — that is the shape Meta's own example uses, and the API is fussier
   * about it than the field list suggests. The id it returns is good for thirty
   * days, which is far longer than the seconds we need it for.
   */
  async uploadMedia(input: WaUploadInput): Promise<WaUploadResult> {
    const cfg = await getCloudConfig();
    if (!cfg) return { ok: false, detail: "WhatsApp Cloud API is not configured" };

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", input.mime);
    form.append("file", new Blob([input.bytes as unknown as BlobPart], { type: input.mime }), input.fileName);

    try {
      const res = await fetch(`${GRAPH_HOST}/${cfg.apiVersion}/${cfg.phoneNumberId}/media`, {
        method: "POST",
        // No content-type of our own: fetch sets it with the multipart boundary,
        // and overriding it produces a body the server cannot split.
        headers: { authorization: `Bearer ${cfg.token}` },
        body: form,
        cache: "no-store",
        signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        const { code, message } = parseGraphError(text);
        logger.warn("wa_cloud_upload_rejected", { status: res.status, code });
        return { ok: false, detail: message || `Upload rejected (HTTP ${res.status})` };
      }
      const id = (JSON.parse(text) as { id?: string })?.id;
      if (!id) return { ok: false, detail: "Upload succeeded but returned no media id" };
      return { ok: true, mediaId: id };
    } catch (e) {
      logger.warn("wa_cloud_upload_failed", { message: e instanceof Error ? e.message : String(e) });
      return { ok: false, detail: "The recording could not be uploaded to WhatsApp" };
    }
  },

  async sendAudio(input: WaSendAudioInput): Promise<WaSendResult> {
    const cfg = await getCloudConfig();
    if (!cfg) return unsupportedResult("WhatsApp Cloud API is not configured");

    return graphPost(cfg, `${cfg.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toCloudRecipient(input.toE164),
      type: "audio",
      audio: { id: input.mediaId, voice: input.voice },
    });
  },

  /**
   * Open the attachment for streaming.
   *
   * Two requests, because Meta splits them: the id resolves to a signed URL, and
   * that URL still wants the bearer token on the download. Both stay inside this
   * adapter — the token unlocks every media id on the WABA, so it must not
   * travel to a route that only wants one file.
   *
   * The body is handed back unread. A voice note is small, but a document is not
   * necessarily, and buffering would put a whole attachment in memory before the
   * browser saw its first byte.
   */
  async downloadMedia(mediaId: string, range?: string | null): Promise<WaMediaStream | null> {
    const cfg = await getCloudConfig();
    if (!cfg) return null;

    // Resolved on every read, not cached: the signed URL is valid for five
    // minutes, so a stored one is a link that works in testing and fails in use.
    const media = await this.fetchMedia(mediaId);
    if (!media) return null;

    try {
      const res = await fetch(media.url, {
        headers: {
          authorization: `Bearer ${cfg.token}`,
          ...(range ? { range } : {}),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
      });
      if (!res.ok || !res.body) {
        logger.warn("wa_cloud_media_download_status", { mediaId, status: res.status });
        return null;
      }
      return {
        body: res.body,
        mime: media.mime ?? res.headers.get("content-type"),
        fileName: media.fileName,
        contentLength: res.headers.get("content-length"),
        contentRange: res.headers.get("content-range"),
        status: res.status === 206 ? 206 : 200,
      };
    } catch (e) {
      logger.warn("wa_cloud_media_download_failed", {
        mediaId,
        message: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  },

  /**
   * The WABA's template catalogue.
   *
   * Only APPROVED templates can actually be sent, but the rejected and pending
   * ones are returned too — a template picker that silently omits a template
   * someone just submitted looks broken, whereas one that shows it as PENDING
   * explains itself.
   */
  async listTemplates(): Promise<WaTemplateSummary[]> {
    const cfg = await getCloudConfig();
    if (!cfg?.wabaId) return [];

    const collected: WaTemplateSummary[] = [];
    try {
      // `components` is what carries the actual message text. Without it a
      // preview can only show the template's name, and a consultant picking by
      // name alone is how the wrong message goes out.
      // `id` and `rejected_reason` were not requested before, because nothing
      // could act on them. Both are load-bearing now: the id is how an edit or a
      // single-language delete addresses a template, and the reason is the only
      // explanation an author gets for a refusal.
      const url = `${GRAPH_HOST}/${cfg.apiVersion}/${cfg.wabaId}/message_templates?fields=id,name,language,category,status,components,rejected_reason&limit=${TEMPLATE_PAGE_SIZE}`;
      // PAGED, not a single 200-row read. The sync marks a local template
      // DELETED when Meta's catalogue no longer contains it, so a truncated
      // catalogue would quietly declare every template past the first page gone.
      let next: string | null = url;
      let pages = 0;

      while (next && pages < MAX_TEMPLATE_PAGES) {
        pages += 1;
        const res: Response = await fetch(next, {
          headers: { authorization: `Bearer ${cfg.token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        // A failure PART WAY THROUGH is not a short catalogue — it is an unknown
        // one. Returning what we have would let the sync delete the rest.
        if (!res.ok) return [];
        const d = (await res.json()) as {
          data?: {
            id?: string;
            name?: string;
            language?: string;
            category?: string;
            status?: string;
            rejected_reason?: string;
            components?: { type?: string; format?: string; text?: string }[];
          }[];
          paging?: { next?: string };
        };
        collected.push(...mapTemplatePage(d?.data ?? []));
        next = typeof d?.paging?.next === "string" && d.paging.next ? d.paging.next : null;
      }

      if (next) logger.warn("wa_cloud_templates_truncated", { pages });
      return collected;
    } catch (e) {
      logger.warn("wa_cloud_templates_failed", { message: e instanceof Error ? e.message : String(e) });
      return [];
    }
  },

  /**
   * Submit a template for review.
   *
   * A 200 here means Meta ACCEPTED the submission, not that the template is
   * usable — the response carries `status: "PENDING"` and a human decides
   * later, typically in minutes but occasionally in days. The returned id is the
   * only handle on it afterwards, so losing it means the template can never be
   * edited or deleted from this side.
   */
  async createTemplate(input: WaTemplateSubmission): Promise<WaTemplateMutationResult> {
    const cfg = await getCloudConfig();
    if (!cfg) return unsupportedMutation("WhatsApp Cloud API is not configured — set it in CRM → Settings");
    if (!cfg.wabaId) {
      return unsupportedMutation("WhatsApp Business Account ID is not set — templates live on the WABA, not the phone number");
    }

    return graphMutate(cfg, `${cfg.wabaId}/message_templates`, "POST", {
      name: input.name,
      language: input.language,
      category: input.category,
      components: input.components,
    });
  },

  /**
   * Edit an approved, rejected or paused template.
   *
   * Addressed by the TEMPLATE's id rather than the WABA's — a distinction worth
   * stating because posting an edit to the WABA silently creates a second
   * template with the same name instead of changing the one you meant. Meta
   * caps edits of an approved template at ten per month; the eleventh comes back
   * as an ordinary rejection.
   */
  async updateTemplate(
    metaId: string,
    input: Omit<WaTemplateSubmission, "name" | "language">,
  ): Promise<WaTemplateMutationResult> {
    const cfg = await getCloudConfig();
    if (!cfg) return unsupportedMutation("WhatsApp Cloud API is not configured");

    return graphMutate(cfg, metaId, "POST", { category: input.category, components: input.components });
  },

  /**
   * Delete a template.
   *
   * Meta's delete is BY NAME and takes every language with it, which is almost
   * never what deleting one row means — so `hsm_id` is sent whenever we have it,
   * narrowing the delete to that single language. Either way the template stops
   * being sendable immediately and Meta keeps the name reserved for 30 days.
   */
  async deleteTemplate(name: string, metaId?: string | null): Promise<WaTemplateMutationResult> {
    const cfg = await getCloudConfig();
    if (!cfg) return unsupportedMutation("WhatsApp Cloud API is not configured");
    if (!cfg.wabaId) return unsupportedMutation("WhatsApp Business Account ID is not set");

    const qs = new URLSearchParams({ name });
    if (metaId) qs.set("hsm_id", metaId);
    return graphMutate(cfg, `${cfg.wabaId}/message_templates?${qs.toString()}`, "DELETE", null);
  },
};
