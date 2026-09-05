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
export type WaCapability =
  | "sendTemplate"
  | "sendText"
  | "fetchMedia"
  | "listTemplates"
  | "uploadMedia"
  | "sendAudio"
  /**
   * Author a template and submit it to Meta for approval, then edit or delete
   * it. Separate from `listTemplates` because reading the catalogue and writing
   * to it are different permissions on Meta's side — a token with only
   * `whatsapp_business_messaging` can send an approved template and can list
   * nothing; management needs `whatsapp_business_management`. A CRM that offered
   * a builder against a read-only token would fail at submit, after the author
   * had written the whole thing.
   */
  | "manageTemplates";

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
   * Media for a template whose HEADER is an image/video/document. Meta requires
   * the media on every send (the sample uploaded at creation is only for
   * approval), so it rides here rather than in `params` (which is per-recipient
   * text). `link` must be a public https URL Meta can fetch. Null/omitted for
   * text-header or header-less templates.
   */
  headerMedia?: { kind: "image" | "video" | "document"; link: string; fileName?: string } | null;
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
  /**
   * Meta's own template id. Needed to EDIT a template (the edit is POSTed to the
   * template's id, not to the WABA) and to delete one language of a name without
   * taking the others with it. Null only when a transport cannot supply one.
   */
  id: string | null;
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
   * The header's format — 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT', or null when
   * the template has no header. A media header means a send must attach the media
   * (see WaSendTemplateInput.headerMedia); the composer uses this to ask for it.
   */
  headerFormat: string | null;
  /**
   * How many `{{n}}` placeholders the body carries.
   *
   * Meta rejects a template send whose parameter count does not match, so this
   * is what lets the composer collect the values instead of failing at the API.
   */
  variableCount: number;
  /**
   * Why Meta refused it — `INCORRECT_CATEGORY`, `INVALID_FORMAT`, and so on.
   * The only explanation an author ever gets, so it is carried rather than
   * flattened into the status.
   */
  rejectedReason: string | null;
};

/** The outcome of creating, editing or deleting a template at Meta. */
export type WaTemplateMutationResult =
  | { ok: true; metaId: string | null; status: string | null; category: string | null }
  | { ok: false; detail: string; code: string | null; unsupported?: boolean };

/** The fields a transport needs to submit a template. Mirrors `WaTemplateSpec`. */
export type WaTemplateSubmission = {
  name: string;
  language: string;
  category: string;
  components: unknown[];
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
  /**
   * The attachment's BYTES, ready to stream to a browser.
   *
   * Separate from `fetchMedia` because the URL that call returns is not usable
   * by anyone but this adapter: Meta's expires within minutes and needs the
   * WABA token on the download itself. A caller that wanted to serve the file
   * would have to hold the credential, which would put the key that unlocks
   * every media id on the account into whichever route happened to need one
   * attachment. Returning an opened body keeps the token where it belongs and
   * gives the caller something it can pipe.
   */
  downloadMedia(mediaId: string, range?: string | null): Promise<WaMediaStream | null>;
  /**
   * Put a file on the provider and get a handle back.
   *
   * Separate from sending because Meta separates them: bytes go up first and the
   * message then references the id. Splitting them here too means a failed
   * upload is distinguishable from a failed send, which matters — the first is
   * safe to retry and the second may already have reached the candidate.
   */
  uploadMedia(input: WaUploadInput): Promise<WaUploadResult>;
  /**
   * Send previously uploaded audio.
   *
   * `voice` asks for a push-to-talk note — waveform, microphone icon, plays
   * without downloading — rather than a file attachment with a music icon. Meta
   * honours it only for Ogg/Opus; anything else silently degrades to the
   * attachment, so callers that care must send the right container.
   */
  sendAudio(input: WaSendAudioInput): Promise<WaSendResult>;
  listTemplates(): Promise<WaTemplateSummary[]>;
  /**
   * Submit a new template for Meta's review.
   *
   * Returns as soon as Meta ACCEPTS the submission, which is not approval — the
   * status comes back `PENDING` and a human decides later. Callers must store
   * the returned id and wait for the status webhook or a sync; treating a
   * successful create as "the template can now be sent" is the mistake this
   * return shape exists to prevent.
   */
  createTemplate(input: WaTemplateSubmission): Promise<WaTemplateMutationResult>;
  /**
   * Edit an existing template, addressed by Meta's id. Name and language are
   * immutable at Meta, so changing either means creating a new template.
   */
  updateTemplate(metaId: string, input: Omit<WaTemplateSubmission, "name" | "language">): Promise<WaTemplateMutationResult>;
  /**
   * Delete a template. `metaId` narrows the delete to ONE language; without it
   * Meta removes every language sharing the name, which is rarely what someone
   * clicking delete on a single row means.
   */
  deleteTemplate(name: string, metaId?: string | null): Promise<WaTemplateMutationResult>;
}

export type WaUploadInput = {
  bytes: Uint8Array;
  mime: string;
  fileName: string;
};

export type WaUploadResult =
  | { ok: true; mediaId: string }
  | { ok: false; detail: string; unsupported?: boolean };

export type WaSendAudioInput = {
  toE164: string;
  mediaId: string;
  /** True for a voice note; false for a plain audio attachment. */
  voice: boolean;
};

/** An attachment being read, not yet buffered. */
export type WaMediaStream = {
  body: ReadableStream<Uint8Array>;
  mime: string | null;
  fileName: string | null;
  /** Null when the upstream did not say; the caller must not invent one. */
  contentLength: string | null;
  /** Set only on a partial response, and passed through verbatim. */
  contentRange: string | null;
  /** 206 when the upstream honoured a byte range, 200 otherwise. */
  status: 200 | 206;
};

/** The stock answer for a capability a transport genuinely cannot do. */
export function unsupportedResult(what: string): WaSendResult {
  return { ok: false, providerMessageId: null, status: null, body: what, unsupported: true };
}

/** The same, for the template-management calls. */
export function unsupportedMutation(what: string): WaTemplateMutationResult {
  return { ok: false, detail: what, code: null, unsupported: true };
}
