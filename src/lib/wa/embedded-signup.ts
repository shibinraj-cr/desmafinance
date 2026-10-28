/**
 * Meta Embedded Signup — the browser half, kept pure so it can be tested.
 *
 * Embedded Signup is the ONLY place Meta offers Coexistence: connecting a number
 * that already runs on the WhatsApp Business app to the Cloud API without taking
 * it off the phone. WhatsApp Manager's "Add phone number" is the ordinary
 * new-number registration, which would mean deleting WhatsApp from the handset.
 *
 * The popup reports what happened through `window.postMessage` from a
 * facebook.com origin ("session logging"), separately from the FB.login
 * callback that carries the exchangeable code. This file reads that message; the
 * server half lives in ./coexistence.
 */

/**
 * Graph version for the SDK and the Coexistence calls. Separate from the pinned
 * send version (cloud-provider.ts) because `smb_app_data` postdates it, and
 * bumping the version every send goes through is a different decision.
 */
export const COEXISTENCE_GRAPH_VERSION = "v26.0";

/** Path the Meta app's "Valid OAuth Redirect URIs" must list exactly (Strict Mode). */
export const CONNECT_PAGE_PATH = "/crm/settings/whatsapp-connect";

/**
 * Asks the flow for the "connect your existing WhatsApp Business app" branch.
 * Meta documents this for the v3 session format; on newer flows it is on by
 * default and the extra keys are ignored, so sending them costs nothing.
 */
export const COEXISTENCE_LOGIN_EXTRAS = {
  setup: {},
  featureType: "whatsapp_business_app_onboarding",
  sessionInfoVersion: "3",
} as const;

export type EmbeddedSignupEvent =
  | {
      kind: "finish";
      /** Meta's event name — FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING is Coexistence. */
      event: string;
      coexistence: boolean;
      wabaId: string | null;
      phoneNumberId: string | null;
      businessId: string | null;
    }
  | { kind: "cancel"; currentStep: string | null; errorMessage: string | null; errorCode: string | null }
  | { kind: "error"; errorMessage: string | null; errorCode: string | null };

/**
 * Only facebook.com and its subdomains may speak for the flow. `endsWith` alone
 * (Meta's own sample) would also accept `evilfacebook.com`.
 */
export function isFacebookOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "https:" && (hostname === "facebook.com" || hostname.endsWith(".facebook.com"));
  } catch {
    return false;
  }
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Read one `message` event's payload. Returns null for anything that is not an
 * Embedded Signup session message — the SDK posts plenty of its own chatter on
 * the same channel, sometimes as a JSON string and sometimes as an object.
 */
export function parseEmbeddedSignupMessage(raw: unknown): EmbeddedSignupEvent | null {
  let msg: unknown = raw;
  if (typeof raw === "string") {
    try {
      msg = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!msg || typeof msg !== "object") return null;
  const m = msg as { type?: unknown; event?: unknown; data?: unknown };
  if (m.type !== "WA_EMBEDDED_SIGNUP") return null;

  const event = str(m.event) ?? "";
  const data = (m.data && typeof m.data === "object" ? m.data : {}) as Record<string, unknown>;
  const errorMessage = str(data.error_message);
  const errorCode = str(data.error_code);

  if (event === "CANCEL") {
    return { kind: "cancel", currentStep: str(data.current_step), errorMessage, errorCode };
  }
  if (event === "ERROR") return { kind: "error", errorMessage, errorCode };
  if (event.startsWith("FINISH")) {
    return {
      kind: "finish",
      event,
      coexistence: event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      wabaId: str(data.waba_id),
      phoneNumberId: str(data.phone_number_id),
      businessId: str(data.business_id),
    };
  }
  return null;
}
