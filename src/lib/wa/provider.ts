/**
 * The WhatsApp transport seam.
 *
 * Every WhatsApp automation in the CRM — the assignment intro, the study-abroad
 * intro, the re-marketing drip — currently ends at the same instruction: POST a
 * payload to a Wabis Webhook Workflow that has one approved template baked into
 * it. That single call is the entire coupling to Wabis. Everything above it (the
 * outbox, the retry ladder, the drip scheduler, the dedupe keys) is already
 * transport-agnostic.
 *
 * This module is that call, behind an interface. A Wabis adapter implements it
 * against workflow URLs; a Cloud API adapter will implement it against Meta
 * directly. Callers state intent — "send this template to this number" — and
 * never learn which transport carried it.
 *
 * The interface is deliberately honest about the difference between the two.
 * `sendText` exists because a shared inbox needs free text, and it is the ONE
 * capability we cannot confirm Wabis exposes; rather than pretend, the Wabis
 * adapter reports it as unsupported and every caller has to handle that. When
 * the Cloud API adapter lands, the same call starts working with no change
 * above this line.
 */

/** Which transport is carrying WhatsApp traffic. Stored on every WaMessage. */
export type WaProviderKey = "wabis" | "cloud";

/**
 * What a transport can actually do.
 *
 * `sendTemplate` specifically means "address an approved template BY NAME".
 * That distinction is load-bearing: Wabis can deliver a template only via a
 * pre-built workflow URL, so it cannot answer "send template X to this number"
 * and must report false — even though its `sendTemplate` method works for a
 * caller that already resolved a URL. A capability that meant "the method
 * exists" would be useless to the composer, which needs to know whether a
 * template picker can work at all.
 */
export type WaCapability = "sendTemplate" | "sendText" | "fetchMedia" | "listTemplates";

/**
 * The outcome of one send attempt.
 *
 * `ok` is our transport verdict — the provider accepted the message. It is NOT
 * a delivery guarantee: whether Meta actually delivered it lands seconds to
 * minutes later on the status webhook, as `waStatus`. Keeping the two separate
 * is why a "sent" that later fails with 131049 is still reported correctly.
 */
export type WaSendResult = {
  ok: boolean;
  /**
   * Meta's `wamid.…`, when the transport returns one. Null through a Wabis
   * WORKFLOW, whose response carries no id — which is precisely why delivery
   * statuses have to be correlated by phone + campaign + touch today instead of
   * by key. (Wabis's send API does return one; that path is not implemented.)
   */
  providerMessageId: string | null;
  /** HTTP status, or null when the request never completed. */
  status: number | null;
  /** Response body or transport error, truncated by the adapter. */
  body: string;
  /** Set when `ok` is false for a reason the caller should not retry. */
  unsupported?: boolean;
  /** Meta's numeric error code, when the transport surfaces one. */
  errorCode?: string | null;
  /**
   * True when the failure says nothing about the recipient — a rate limit, a
   * timeout, an upstream fault. A campaign that drains over days must be able to
   * tell these apart, or one blip silently drops part of the audience.
   */
  retryable?: boolean;
};

export type WaSendTemplateInput = {
  /** Recipient in E.164 (`+91…`). Adapters re-shape it as their transport wants. */
  toE164: string;
  /**
   * Logical template key. The Wabis adapter resolves it to a workflow URL; the
   * Cloud adapter resolves it to an approved template name.
   */
  template: string;
  /** Merge values, already rendered by the caller. */
  params?: Record<string, string>;
  /**
   * Pre-resolved destination, for callers that already picked an endpoint —
   * today's outbox rows capture the URL at enqueue time so that editing settings
   * later never rewrites the history of what was actually sent where. Ignored by
   * transports that address by template name.
   */
  endpointUrl?: string | null;
};

export type WaSendTextInput = {
  toE164: string;
  body: string;
};

export type WaMedia = {
  url: string;
  mime: string | null;
  fileName: string | null;
};

export type WaTemplateSummary = {
  name: string;
  language: string;
  /** 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' — drives the frequency cap. */
  category: string | null;
  /** 'APPROVED' | 'PENDING' | 'REJECTED' | … */
  status: string;
  /**
   * The template's actual body text, `{{1}}` placeholders intact.
   *
   * Without this a "preview" can only show the template's name, which tells a
   * consultant nothing about what the candidate will receive — and picking a
   * send by name alone is how the wrong message goes out.
   */
  body: string | null;
  /** Header text, when the template has a text header. */
  header: string | null;
  /**
   * How many `{{n}}` placeholders the body carries.
   *
   * Meta rejects a template send whose parameter count does not match, so this
   * is what lets the composer collect the values instead of failing at the API.
   */
  variableCount: number;
};

export interface WhatsAppProvider {
  readonly key: WaProviderKey;
  /** Human label for settings screens and delivery logs. */
  readonly label: string;
  supports(capability: WaCapability): boolean;
  sendTemplate(input: WaSendTemplateInput): Promise<WaSendResult>;
  /**
   * Free-text reply. Only legal within 24 hours of the candidate's last inbound
   * message — callers must check `WaConversation.sessionExpiresAt` first; this
   * layer does not know the window.
   */
  sendText(input: WaSendTextInput): Promise<WaSendResult>;
  fetchMedia(mediaId: string): Promise<WaMedia | null>;
  listTemplates(): Promise<WaTemplateSummary[]>;
}

/** The stock answer for a capability a transport genuinely cannot do. */
export function unsupportedResult(what: string): WaSendResult {
  return { ok: false, providerMessageId: null, status: null, body: what, unsupported: true };
}
