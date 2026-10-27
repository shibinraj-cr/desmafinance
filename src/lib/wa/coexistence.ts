/**
 * Coexistence — the server half of Embedded Signup.
 *
 * When the popup finishes, the number is connected but nothing points at us yet.
 * Meta's onboarding guide leaves four follow-ups to the integrator, and the
 * contact/history syncs only work inside 24 hours of onboarding (after that the
 * business has to disconnect and run the flow again):
 *
 *   1. subscribe OUR app to the account, or its messages go nowhere. Without
 *      this step every message to the number is lost, so it runs first;
 *   2. sync contacts (`smb_app_state_sync`), once;
 *   3. sync chat history (`history`), once — a harmless error when the business
 *      chose "Don't share chats";
 *   4. read the number back (`is_on_biz_app`, `platform_type`) as proof.
 *
 * Phone-number registration is deliberately absent: the number is already
 * registered on the handset, and registering it again is the step that would
 * take it off the app.
 *
 * Every step is attempted and reported, never thrown, so an admin sees which
 * one failed and can re-run the rest instead of reading a bare 500.
 */
import { getSetting, setSetting, WA_CLOUD_APP_SECRET_KEY, WA_COEXISTENCE_NUMBERS_KEY, WA_META_APP_ID_KEY } from "../app-settings";
import { logger } from "../logger";
import { getCloudConfig, parseGraphError } from "./cloud-provider";
import { COEXISTENCE_GRAPH_VERSION } from "./embedded-signup";

const GRAPH = `https://graph.facebook.com/${COEXISTENCE_GRAPH_VERSION}`;
const TIMEOUT_MS = 10_000;

export type CoexistenceStepKey = "token" | "subscribe" | "contacts" | "history" | "verify";

export type CoexistenceStep = { key: CoexistenceStepKey; ok: boolean; detail: string };

export type CoexistenceNumber = {
  phoneNumberId: string;
  wabaId: string;
  displayPhone: string | null;
  verifiedName: string | null;
  /** Meta's own answer to "is this still on the Business app" — true is the goal. */
  onBizApp: boolean | null;
  platformType: string | null;
  /** The popup's finish event, when the run came from the popup. */
  event: string | null;
  connectedAt: string;
  lastRunAt: string;
  steps: CoexistenceStep[];
};

/** The stored list, read leniently: a malformed row is dropped, not fatal. */
export function parseCoexistenceNumbers(raw: string | null): CoexistenceNumber[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (n): n is CoexistenceNumber =>
        !!n && typeof n === "object" && typeof n.phoneNumberId === "string" && typeof n.wabaId === "string",
    );
  } catch {
    return [];
  }
}

/** Replace by phone number id, keeping when the number was FIRST connected. */
export function upsertCoexistenceNumber(list: CoexistenceNumber[], entry: CoexistenceNumber): CoexistenceNumber[] {
  const existing = list.find((n) => n.phoneNumberId === entry.phoneNumberId);
  const merged = existing ? { ...entry, connectedAt: existing.connectedAt } : entry;
  return [...list.filter((n) => n.phoneNumberId !== entry.phoneNumberId), merged];
}

export async function listCoexistenceNumbers(): Promise<CoexistenceNumber[]> {
  return parseCoexistenceNumbers(await getSetting(WA_COEXISTENCE_NUMBERS_KEY).catch(() => null));
}

type GraphResult = { ok: boolean; json: Record<string, unknown> | null; detail: string };

async function graph(token: string, method: "GET" | "POST", path: string, body?: unknown): Promise<GraphResult> {
  try {
    const res = await fetch(`${GRAPH}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      const { code, message } = parseGraphError(text);
      return { ok: false, json: null, detail: code ? `${code}: ${message}` : message };
    }
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // A 200 without JSON still succeeded; there is just nothing to read.
    }
    return { ok: true, json, detail: "OK" };
  } catch (e) {
    return { ok: false, json: null, detail: e instanceof Error ? `${e.name}: ${e.message}` : "request failed" };
  }
}

/**
 * Trade the popup's code for a business token. The code lives 30 seconds, so
 * this has to be the first thing the server does with it.
 */
async function exchangeCode(code: string): Promise<{ token: string | null; detail: string }> {
  const [appId, appSecret] = await Promise.all([
    getSetting(WA_META_APP_ID_KEY).catch(() => null),
    getSetting(WA_CLOUD_APP_SECRET_KEY).catch(() => null),
  ]);
  if (!appId?.trim() || !appSecret?.trim()) {
    return { token: null, detail: "Meta app ID or app secret is not set" };
  }
  const qs = new URLSearchParams({ client_id: appId.trim(), client_secret: appSecret.trim(), code });
  try {
    const res = await fetch(`${GRAPH}/oauth/access_token?${qs}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      const { code: errCode, message } = parseGraphError(text);
      return { token: null, detail: errCode ? `${errCode}: ${message}` : message };
    }
    const token = (JSON.parse(text) as { access_token?: unknown }).access_token;
    return typeof token === "string" && token ? { token, detail: "Exchanged the signup code" } : { token: null, detail: "Meta returned no token" };
  } catch (e) {
    return { token: null, detail: e instanceof Error ? `${e.name}: ${e.message}` : "request failed" };
  }
}

/**
 * Run the follow-ups for one connected number and record the outcome.
 *
 * With a `code` (straight from the popup) the business token it buys is used;
 * without one — a re-run, or a code that expired — the CRM's own System User
 * token is, which works because the account belongs to our own portfolio. The
 * business token is never stored: it expires, and the System User token is the
 * one the rest of the module already relies on.
 */
export async function completeCoexistenceOnboarding(input: {
  code: string | null;
  wabaId: string;
  phoneNumberId: string;
  event: string | null;
  userId: string;
}): Promise<CoexistenceNumber> {
  const steps: CoexistenceStep[] = [];

  let token: string | null = null;
  if (input.code) {
    const exchanged = await exchangeCode(input.code);
    token = exchanged.token;
    if (!token) steps.push({ key: "token", ok: false, detail: `${exchanged.detail} — falling back to the CRM's access token` });
    else steps.push({ key: "token", ok: true, detail: exchanged.detail });
  }
  if (!token) {
    const cfg = await getCloudConfig();
    token = cfg?.token ?? null;
    if (!input.code) {
      steps.push(
        token
          ? { key: "token", ok: true, detail: "Using the CRM's access token" }
          : { key: "token", ok: false, detail: "No access token is configured" },
      );
    }
  }

  const now = new Date().toISOString();
  const entry: CoexistenceNumber = {
    phoneNumberId: input.phoneNumberId,
    wabaId: input.wabaId,
    displayPhone: null,
    verifiedName: null,
    onBizApp: null,
    platformType: null,
    event: input.event,
    connectedAt: now,
    lastRunAt: now,
    steps,
  };

  if (token) {
    const subscribed = await graph(token, "POST", `${input.wabaId}/subscribed_apps`);
    steps.push({ key: "subscribe", ok: subscribed.ok, detail: subscribed.detail });

    const contacts = await graph(token, "POST", `${input.phoneNumberId}/smb_app_data`, {
      messaging_product: "whatsapp",
      sync_type: "smb_app_state_sync",
    });
    steps.push({ key: "contacts", ok: contacts.ok, detail: contacts.detail });

    const history = await graph(token, "POST", `${input.phoneNumberId}/smb_app_data`, {
      messaging_product: "whatsapp",
      sync_type: "history",
    });
    steps.push({ key: "history", ok: history.ok, detail: history.detail });

    const verified = await graph(
      token,
      "GET",
      `${input.phoneNumberId}?fields=display_phone_number,verified_name,is_on_biz_app,platform_type`,
    );
    steps.push({ key: "verify", ok: verified.ok, detail: verified.detail });
    if (verified.json) {
      const j = verified.json;
      entry.displayPhone = typeof j.display_phone_number === "string" ? j.display_phone_number : null;
      entry.verifiedName = typeof j.verified_name === "string" ? j.verified_name : null;
      entry.onBizApp = typeof j.is_on_biz_app === "boolean" ? j.is_on_biz_app : null;
      entry.platformType = typeof j.platform_type === "string" ? j.platform_type : null;
    }
  }

  const failed = steps.filter((s) => !s.ok).map((s) => s.key);
  if (failed.length) logger.warn("wa_coexistence_steps_failed", { phoneNumberId: input.phoneNumberId, failed });

  const list = upsertCoexistenceNumber(await listCoexistenceNumbers(), entry);
  await setSetting(WA_COEXISTENCE_NUMBERS_KEY, JSON.stringify(list), input.userId);
  return list.find((n) => n.phoneNumberId === input.phoneNumberId) ?? entry;
}
