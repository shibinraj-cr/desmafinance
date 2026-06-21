// Server-side email sending via Gmail SMTP (nodemailer). Used by the per-lead
// "Email" action and the bulk-email flow. Credentials live in AppSetting
// (managed on CRM → Settings → Integrations) with an env-var fallback.
//
// Why Gmail SMTP: a message sent through smtp.gmail.com is automatically filed
// in the authenticated account's "Sent" folder — so a sales blast shows up in
// the team mailbox exactly like a hand-typed email, with no extra IMAP step.
import type { Transporter } from "nodemailer";
import { getSetting } from "./app-settings";
import { prisma } from "./prisma";

// AppSetting keys.
export const EMAIL_USER_KEY = "email_smtp_user"; // the Gmail address that logs in
export const EMAIL_PASS_KEY = "email_smtp_pass"; // a Google App Password (NOT the account password)
export const EMAIL_FROM_NAME_KEY = "email_from_name"; // display name on the From header
export const EMAIL_FROM_ADDR_KEY = "email_from_address"; // optional From override (a verified alias)
export const EMAIL_REPLY_TO_KEY = "email_reply_to"; // optional Reply-To
export const EMAIL_DAILY_CAP_KEY = "email_daily_cap"; // soft guard against Gmail's per-day send limit

export const DEFAULT_DAILY_CAP = 450; // gmail.com allows ~500/day; stay under it.

export type EmailConfig = {
  user: string;
  pass: string;
  fromName: string | null;
  fromAddress: string; // resolved From mailbox (alias override or the login user)
  replyTo: string | null;
  dailyCap: number;
};

/** Read the configured email sender, or null when not set up yet. */
export async function getEmailConfig(): Promise<EmailConfig | null> {
  const [user, pass, fromName, fromAddr, replyTo, capRaw] = await Promise.all([
    getSetting(EMAIL_USER_KEY),
    getSetting(EMAIL_PASS_KEY),
    getSetting(EMAIL_FROM_NAME_KEY),
    getSetting(EMAIL_FROM_ADDR_KEY),
    getSetting(EMAIL_REPLY_TO_KEY),
    getSetting(EMAIL_DAILY_CAP_KEY),
  ]);

  const u = user || process.env.EMAIL_SMTP_USER || null;
  const p = pass || process.env.EMAIL_SMTP_PASS || null;
  if (!u || !p) return null;

  const cap = Number.parseInt(capRaw || "", 10);
  return {
    user: u,
    pass: p,
    fromName: fromName || process.env.EMAIL_FROM_NAME || null,
    fromAddress: fromAddr || process.env.EMAIL_FROM_ADDRESS || u,
    replyTo: replyTo || null,
    dailyCap: Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_DAILY_CAP,
  };
}

export async function isEmailConfigured(): Promise<boolean> {
  return (await getEmailConfig()) !== null;
}

/** RFC 5322 display-name + address, with the name quoted/escaped safely. */
export function formatFrom(cfg: EmailConfig): string {
  if (!cfg.fromName) return cfg.fromAddress;
  const safe = cfg.fromName.replace(/[\r\n"]/g, " ").trim();
  return `"${safe}" <${cfg.fromAddress}>`;
}

// Cache one pooled transport per (user,pass) so a bulk run reuses a single
// authenticated connection instead of re-handshaking per message.
let cached: { key: string; transport: Transporter } | null = null;

export async function getTransport(cfg: EmailConfig): Promise<Transporter> {
  const key = `${cfg.user} ${cfg.pass}`;
  if (cached && cached.key === key) return cached.transport;
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    pool: true,
    maxConnections: 1, // Gmail is happiest with a single steady connection
    maxMessages: 100,
    // Bounded so a stuck handshake/socket can't eat the whole serverless budget
    // (default nodemailer timeouts far exceed the route's maxDuration).
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });
  cached = { key, transport };
  return transport;
}

/** Drop the cached transport (call after credentials change). */
export function resetTransport(): void {
  if (cached) {
    cached.transport.close();
    cached = null;
  }
}

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPE[c]);
}
/** Plain-text body → minimal HTML (escaped, newlines → <br>) so the email renders the same either way. */
export function textToHtml(text: string): string {
  return `<div style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#202124">${escapeHtml(
    text,
  ).replace(/\n/g, "<br>")}</div>`;
}

/**
 * Classify an SMTP send error. `rateLimited` → Gmail is throttling or the daily
 * quota is exhausted, so the caller should STOP the batch rather than hammer the
 * server with each remaining recipient. `auth` → bad/blocked App Password.
 */
export function smtpErrorInfo(e: unknown): { rateLimited: boolean; auth: boolean; message: string } {
  const err = e as { responseCode?: number; code?: string; message?: string } | null;
  const message = err?.message ?? "send failed";
  const rc = err?.responseCode;
  const rateLimited =
    rc === 421 ||
    rc === 454 ||
    rc === 450 ||
    (rc === 550 && /quota|sending limit|rate/i.test(message)) ||
    /rate limit|too many|try again later|sending limit|daily user sending|quota exceeded/i.test(message);
  const auth = rc === 535 || rc === 534 || /username and password not accepted|invalid login|5\.7\.8/i.test(message);
  return { rateLimited, auth, message };
}

/** Turn a raw SMTP error into a short, admin-friendly hint for the Settings test. */
export function friendlySmtpError(e: unknown): string {
  const { auth, rateLimited, message } = smtpErrorInfo(e);
  if (auth)
    return "Login rejected. Use a 16-character Google App Password (not the account password), with 2-Step Verification on; some Workspace accounts block App Passwords by policy.";
  if (rateLimited) return "Gmail is rate-limiting or the daily send limit is reached. Try again later.";
  return message;
}

export type SendResult = { messageId: string };

/** Send one email. Throws on failure (caller decides how to handle/record). */
export async function sendEmail(
  cfg: EmailConfig,
  msg: { to: string; subject: string; text: string },
): Promise<SendResult> {
  const transport = await getTransport(cfg);
  const info = await transport.sendMail({
    from: formatFrom(cfg),
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: textToHtml(msg.text),
    ...(cfg.replyTo ? { replyTo: cfg.replyTo } : {}),
  });
  return { messageId: info.messageId };
}

/** Verify the SMTP credentials (used by the Settings "test connection"). */
export async function verifyEmailConfig(cfg: EmailConfig): Promise<void> {
  const transport = await getTransport(cfg);
  await transport.verify();
}

/**
 * How many emails this sender has sent in the last 24h (counts EMAIL_SENT
 * timeline activities that actually went out via the provider), and how many
 * remain under the configured daily cap. The cap is a soft guard so a bulk run
 * stops cleanly instead of getting throttled/blocked by Gmail.
 */
export async function getDailyQuota(cfg: EmailConfig): Promise<{ used: number; cap: number; remaining: number }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const used = await prisma.leadActivity.count({
    where: {
      type: "EMAIL_SENT",
      occurredAt: { gte: since },
      metadata: { path: ["delivery"], equals: "gmail" },
    },
  });
  return { used, cap: cfg.dailyCap, remaining: Math.max(0, cfg.dailyCap - used) };
}
