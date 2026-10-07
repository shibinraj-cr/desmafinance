import { BankAutomationError } from "./errors";
import {
  collectBodies,
  decodeBase64Url,
  findPdfAttachment,
  type GmailPart,
} from "./email-parse";

/**
 * Thin fetch client for the Gmail + OAuth surface Bank Statement Automation
 * needs — no googleapis dependency, same shape as src/lib/youtube/google.ts.
 *
 * Scope is gmail.readonly: the automation only searches and reads; it never
 * labels, moves or deletes mail. Sheets sync, when an administrator opts in at
 * connect time, adds the spreadsheets scope to the same grant.
 *
 * Setup: in Google Cloud enable the Gmail API (and Sheets API for sync), add
 * the redirect URI shown on the Automation tab to an OAuth "Web application"
 * client, and set BANK_GOOGLE_CLIENT_ID / BANK_GOOGLE_CLIENT_SECRET (or reuse
 * the YouTube client — the code falls back to YOUTUBE_CLIENT_ID/SECRET).
 * gmail.readonly is a restricted scope: use an Internal consent screen on the
 * Workspace domain, or Google will expire refresh tokens after 7 days.
 */

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const GMAIL_CALLBACK_PATH = "/api/finance/bank-automation/gmail/callback";

export function bankGoogleOAuthConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = (process.env.BANK_GOOGLE_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID)?.trim();
  const clientSecret = (process.env.BANK_GOOGLE_CLIENT_SECRET || process.env.YOUTUBE_CLIENT_SECRET)?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function requireConfig() {
  const c = bankGoogleOAuthConfig();
  if (!c) throw new BankAutomationError("CONFIG", "BANK_GOOGLE_CLIENT_ID / BANK_GOOGLE_CLIENT_SECRET are not set");
  return c;
}

export function buildGmailAuthUrl(redirectUri: string, state: string, withSheets: boolean): string {
  const { clientId } = requireConfig();
  const scopes = ["openid", "email", GMAIL_SCOPE, ...(withSheets ? [SHEETS_SCOPE] : [])];
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      cache: "no-store",
    });
  } catch (e) {
    throw new BankAutomationError("NETWORK", `Google token endpoint unreachable: ${e instanceof Error ? e.message : e}`);
  }
  const json = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    // invalid_grant = revoked / expired refresh token: a reconnect, not a retry.
    const code = json.error === "invalid_grant" || res.status === 401 ? "GMAIL_AUTH" : "GMAIL_ERROR";
    throw new BankAutomationError(code, json.error_description || json.error || `token endpoint returned ${res.status}`);
  }
  return json as TokenResponse;
}

export function exchangeGmailCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = requireConfig();
  return tokenRequest({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" });
}

export async function gmailAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = requireConfig();
  const t = await tokenRequest({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" });
  return t.access_token;
}

export async function revokeGoogleToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    cache: "no-store",
  }).catch(() => undefined);
}

/** The e-mail address inside an OpenID id_token (already verified by Google's TLS). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(idToken.split(".")[1] ?? "")) as { email?: string };
    return payload.email?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export async function googleGet<T>(url: string, accessToken: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  } catch (e) {
    throw new BankAutomationError("NETWORK", `Google API unreachable: ${e instanceof Error ? e.message : e}`);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    const code = res.status === 401 || res.status === 403 ? "GMAIL_AUTH" : res.status >= 500 ? "NETWORK" : "GMAIL_ERROR";
    throw new BankAutomationError(code, json.error?.message || `${url.split("?")[0]} returned ${res.status}`);
  }
  return json;
}

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Message ids matching a Gmail search query, newest first (Gmail's order). */
export async function searchMessageIds(accessToken: string, q: string, cap = 500): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({ q, maxResults: "100" });
    if (pageToken) p.set("pageToken", pageToken);
    const json = await googleGet<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
      `${GMAIL}/messages?${p.toString()}`,
      accessToken,
    );
    for (const m of json.messages ?? []) ids.push(m.id);
    pageToken = json.nextPageToken;
  } while (pageToken && ids.length < cap);
  return ids;
}

export type StatementMessage = {
  id: string;
  receivedAt: Date;
  from: string;
  to: string;
  subject: string;
  bodies: string[];
  attachment: { attachmentId: string; filename: string } | null;
};

export async function getMessage(accessToken: string, id: string): Promise<StatementMessage> {
  const json = await googleGet<{
    id: string;
    internalDate?: string;
    payload?: GmailPart & { headers?: Array<{ name: string; value: string }> };
  }>(`${GMAIL}/messages/${encodeURIComponent(id)}?format=full`, accessToken);
  const header = (n: string) =>
    json.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
  return {
    id: json.id,
    receivedAt: new Date(Number(json.internalDate ?? Date.now())),
    from: header("From"),
    to: header("To"),
    subject: header("Subject"),
    bodies: collectBodies(json.payload),
    attachment: findPdfAttachment(json.payload),
  };
}

export async function getAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<Uint8Array> {
  const json = await googleGet<{ data?: string }>(
    `${GMAIL}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    accessToken,
  );
  if (!json.data) throw new BankAutomationError("PDF_INVALID", "Gmail returned an empty attachment");
  return new Uint8Array(Buffer.from(json.data.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
}

export async function gmailProfileEmail(accessToken: string): Promise<string | null> {
  const json = await googleGet<{ emailAddress?: string }>(`${GMAIL}/profile`, accessToken);
  return json.emailAddress?.toLowerCase() ?? null;
}
