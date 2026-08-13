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
  unsupportedResult,
  type WaCapability,
  type WaMedia,
  type WaSendResult,
  type WaSendTemplateInput,
  type WaSendTextInput,
  type WaTemplateSummary,
  type WhatsAppProvider,
} from "./provider";

/** Pinned so a Graph release cannot change behaviour under us. */
const DEFAULT_API_VERSION = "v21.0";
const GRAPH_HOST = "https://graph.facebook.com";
const REQUEST_TIMEOUT_MS = 10_000;
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
 * Meta's template `components` for a body with positional variables.
 *
 * The Cloud API numbers body variables {{1}}, {{2}}, … positionally, so the
 * caller's named map has to be ordered before it is sent. Sorting numeric keys
 * numerically matters: a plain string sort puts "10" before "2" and silently
 * shifts every variable after the ninth.
 */
export function buildTemplateComponents(params: Record<string, string>): unknown[] {
  const keys = Object.keys(params);
  if (keys.length === 0) return [];

  const numeric = keys.every((k) => /^\d+$/.test(k));
  const ordered = numeric ? keys.sort((a, b) => Number(a) - Number(b)) : keys.sort();

  return [
    {
      type: "body",
      parameters: ordered.map((k) => ({ type: "text", text: params[k] })),
    },
  ];
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
      return { ok: false, providerMessageId: null, status: res.status, body: code ? `${code}: ${message}` : message };
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
    return { ok: false, providerMessageId: null, status: null, body: truncate(msg) };
  }
}

const SUPPORTED: ReadonlySet<WaCapability> = new Set<WaCapability>([
  "sendTemplate",
  "sendText",
  "fetchMedia",
  "listTemplates",
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

    try {
      const url = `${GRAPH_HOST}/${cfg.apiVersion}/${cfg.wabaId}/message_templates?fields=name,language,category,status&limit=200`;
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${cfg.token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return [];
      const d = (await res.json()) as { data?: { name?: string; language?: string; category?: string; status?: string }[] };
      return (d?.data ?? [])
        .filter((t): t is { name: string; language: string; category?: string; status?: string } => !!t?.name && !!t.language)
        .map((t) => ({
          name: t.name,
          language: t.language,
          category: t.category ?? null,
          status: t.status ?? "UNKNOWN",
        }));
    } catch (e) {
      logger.warn("wa_cloud_templates_failed", { message: e instanceof Error ? e.message : String(e) });
      return [];
    }
  },
};
