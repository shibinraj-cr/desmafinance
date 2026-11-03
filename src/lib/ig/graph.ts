/**
 * Instagram messaging through Meta's Graph API, via the Facebook Page the
 * Instagram professional account is linked to ("Instagram API with Facebook
 * Login"). Every call here authenticates with the PAGE access token.
 *
 * Nothing in this file throws: a Graph failure is a result the caller reports,
 * and the webhook path in particular must never die on one — the message has
 * already been stored by the time any of these run.
 *
 * Timeouts are short on purpose. These run inside the webhook request, which
 * Meta expects answered within seconds, and a profile lookup or a history check
 * that hangs is worth less than the delivery it would hold up.
 */
import {
  getSetting,
  IG_ACCESS_TOKEN_KEY,
  IG_ACCOUNT_ID_KEY,
  IG_API_VERSION_KEY,
  IG_AUTO_ASK_ENABLED_KEY,
  IG_AUTO_ASK_FOLLOWUP_KEY,
  IG_AUTO_ASK_INTRO_KEY,
  IG_AUTO_ASK_THANKS_KEY,
  IG_CAPTURE_ENABLED_KEY,
  IG_PAGE_ID_KEY,
  IG_PAGE_TOKEN_KEY,
} from "../app-settings";
import { parseGraphError } from "../wa/cloud-provider";
import { logger } from "../logger";
import type { QuickReply } from "./auto-ask";

const GRAPH_HOST = "https://graph.facebook.com";
export const DEFAULT_IG_API_VERSION = "v24.0";
const TIMEOUT_MS = 6_000;

export type IgConfig = {
  pageId: string | null;
  /** The Page token when "Check connection" derived one, else the token pasted in. */
  token: string | null;
  accountId: string | null;
  apiVersion: string;
  captureEnabled: boolean;
  autoAskEnabled: boolean;
  texts: { intro: string | null; followUp: string | null; thanks: string | null };
};

export async function getIgConfig(): Promise<IgConfig> {
  const read = (k: string) => getSetting(k).catch(() => null);
  const [pageId, accessToken, pageToken, accountId, version, capture, autoAsk, intro, followUp, thanks] =
    await Promise.all([
      read(IG_PAGE_ID_KEY),
      read(IG_ACCESS_TOKEN_KEY),
      read(IG_PAGE_TOKEN_KEY),
      read(IG_ACCOUNT_ID_KEY),
      read(IG_API_VERSION_KEY),
      read(IG_CAPTURE_ENABLED_KEY),
      read(IG_AUTO_ASK_ENABLED_KEY),
      read(IG_AUTO_ASK_INTRO_KEY),
      read(IG_AUTO_ASK_FOLLOWUP_KEY),
      read(IG_AUTO_ASK_THANKS_KEY),
    ]);
  return {
    pageId: pageId?.trim() || null,
    token: pageToken?.trim() || accessToken?.trim() || null,
    accountId: accountId?.trim() || null,
    apiVersion: version?.trim() || DEFAULT_IG_API_VERSION,
    captureEnabled: capture === "1",
    autoAskEnabled: autoAsk === "1",
    texts: { intro: intro?.trim() || null, followUp: followUp?.trim() || null, thanks: thanks?.trim() || null },
  };
}

type GraphResult = { ok: true; json: unknown } | { ok: false; detail: string };

async function graph(
  cfg: { apiVersion: string; token: string | null },
  method: "GET" | "POST",
  path: string,
  opts: { query?: Record<string, string>; body?: unknown; token?: string } = {},
): Promise<GraphResult> {
  const token = opts.token ?? cfg.token;
  if (!token) return { ok: false, detail: "No Instagram access token saved" };
  const url = new URL(`${GRAPH_HOST}/${cfg.apiVersion}/${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      const { code, message } = parseGraphError(text);
      return { ok: false, detail: code ? `${code}: ${message}` : message || `HTTP ${res.status}` };
    }
    try {
      return { ok: true, json: text ? (JSON.parse(text) as unknown) : {} };
    } catch {
      return { ok: true, json: {} };
    }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? `${e.name}: ${e.message}` : "request failed" };
  }
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export type IgConnectionCheck =
  | { ok: true; pageName: string | null; pageToken: string | null; accountId: string; username: string | null }
  | { ok: false; detail: string };

/**
 * Read the Page with the token the admin pasted, and from it the linked
 * Instagram account and the Page's own access token.
 *
 * A System User token reads `access_token` off a Page it has been given; a
 * Page token pasted directly may not, and is then used as-is. No Instagram
 * account on the Page is the commonest setup mistake (the account is still a
 * personal one, or linked to a different Page), so it gets its own sentence.
 */
export async function checkIgConnection(pageId: string, token: string, apiVersion: string): Promise<IgConnectionCheck> {
  const r = await graph({ apiVersion, token }, "GET", pageId, {
    query: { fields: "id,name,access_token,instagram_business_account{id,username}" },
  });
  if (!r.ok) return { ok: false, detail: r.detail };
  const page = obj(r.json);
  const ig = obj(page.instagram_business_account);
  const accountId = str(ig.id);
  if (!accountId) {
    return {
      ok: false,
      detail:
        "This Page has no Instagram professional account linked to it. Link the account to the Page in Meta Business Suite (Settings → Instagram accounts), then check again.",
    };
  }
  return { ok: true, pageName: str(page.name), pageToken: str(page.access_token), accountId, username: str(ig.username) };
}

export type PageSubscription = { name: string | null; id: string | null; fields: string[] };

/** Which apps receive this Page's webhooks, and for which fields. */
export async function listPageSubscriptions(
  cfg: IgConfig,
): Promise<{ ok: true; apps: PageSubscription[] } | { ok: false; detail: string }> {
  if (!cfg.pageId) return { ok: false, detail: "Page ID is not set" };
  const r = await graph(cfg, "GET", `${cfg.pageId}/subscribed_apps`);
  if (!r.ok) return r;
  const data = Array.isArray(obj(r.json).data) ? (obj(r.json).data as unknown[]) : [];
  return {
    ok: true,
    apps: data.map((d) => {
      const o = obj(d);
      return {
        name: str(o.name),
        id: str(o.id),
        fields: Array.isArray(o.subscribed_fields) ? o.subscribed_fields.filter((f): f is string => typeof f === "string") : [],
      };
    }),
  };
}

/**
 * Subscribe our app to the Page's messaging events.
 *
 * The same trap as WhatsApp: a callback URL verified green in the App
 * Dashboard delivers NOTHING until the app is also subscribed to the Page, and
 * no Meta screen shows that second object. Additive — other apps' entries are
 * untouched.
 */
export async function subscribePage(cfg: IgConfig): Promise<{ ok: boolean; detail: string }> {
  if (!cfg.pageId) return { ok: false, detail: "Page ID is not set" };
  const r = await graph(cfg, "POST", `${cfg.pageId}/subscribed_apps`, {
    query: { subscribed_fields: "messages,messaging_postbacks" },
  });
  if (!r.ok) {
    logger.warn("ig_page_subscribe_failed", { detail: r.detail.slice(0, 200) });
    return { ok: false, detail: r.detail };
  }
  return { ok: true, detail: "Subscribed" };
}

/** Name and username of someone who messaged us (User Profile API). Best-effort. */
export async function fetchIgProfile(cfg: IgConfig, igsid: string): Promise<{ name: string | null; username: string | null }> {
  const r = await graph(cfg, "GET", igsid, { query: { fields: "name,username" } });
  if (!r.ok) {
    logger.info("ig_profile_lookup_failed", { detail: r.detail.slice(0, 200) });
    return { name: null, username: null };
  }
  const o = obj(r.json);
  return { name: str(o.name), username: str(o.username) };
}

/**
 * Was there a conversation with this person before the message that just
 * arrived?
 *
 * The guard that keeps auto-ask out of chats that predate it: the day DesGro
 * is connected, every candidate already talking to the team looks "new" to us
 * on their next message. "unknown" when Meta would not say — the caller treats
 * that as a no, because an intro dropped into a live conversation is the
 * failure worth avoiding.
 */
export async function hasEarlierConversation(
  cfg: IgConfig,
  igsid: string,
  current: { mid: string | null; occurredAt: Date },
): Promise<"earlier" | "none" | "unknown"> {
  if (!cfg.pageId) return "unknown";
  const r = await graph(cfg, "GET", `${cfg.pageId}/conversations`, {
    query: { platform: "instagram", user_id: igsid, fields: "messages.limit(10){id,created_time}" },
  });
  if (!r.ok) {
    logger.info("ig_history_check_failed", { detail: r.detail.slice(0, 200) });
    return "unknown";
  }
  const conversations = Array.isArray(obj(r.json).data) ? (obj(r.json).data as unknown[]) : [];
  // Two minutes of slack: a burst ("hi" / "I'm Anjali" / number) can reach
  // Meta's history before its first webhook reaches us.
  const cutoff = current.occurredAt.getTime() - 2 * 60 * 1000;
  for (const c of conversations) {
    const msgs = Array.isArray(obj(obj(c).messages).data) ? (obj(obj(c).messages).data as unknown[]) : [];
    for (const m of msgs) {
      const id = str(obj(m).id);
      const created = Date.parse(str(obj(m).created_time) ?? "");
      if (id && id === current.mid) continue;
      if (Number.isFinite(created) && created < cutoff) return "earlier";
    }
  }
  return "none";
}

export type IgSendResult = { ok: true; mid: string | null } | { ok: false; detail: string };

/**
 * Send one text DM, optionally with quick-reply buttons.
 *
 * Only legal inside Instagram's 24-hour window after the candidate's last
 * message — which every auto-ask send is, since it answers a message that
 * arrived seconds ago. If Meta rejects the buttons, the text goes again
 * without them: the question matters, the buttons are a convenience.
 */
export async function sendIgText(cfg: IgConfig, igsid: string, text: string, quickReplies?: QuickReply[]): Promise<IgSendResult> {
  if (!cfg.pageId) return { ok: false, detail: "Page ID is not set" };
  const send = (withButtons: boolean) =>
    graph(cfg, "POST", `${cfg.pageId}/messages`, {
      body: {
        recipient: { id: igsid },
        message: withButtons && quickReplies?.length ? { text, quick_replies: quickReplies } : { text },
      },
    });

  let r = await send(true);
  if (!r.ok && quickReplies?.length) {
    logger.info("ig_send_quick_replies_rejected", { detail: r.detail.slice(0, 200) });
    r = await send(false);
  }
  if (!r.ok) {
    logger.warn("ig_send_failed", { detail: r.detail.slice(0, 200) });
    return { ok: false, detail: r.detail };
  }
  return { ok: true, mid: str(obj(r.json).message_id) };
}
