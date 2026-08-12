// Admin-managed key/value settings (AppSetting), so integrations can be
// configured in-app instead of via environment variables.
import { prisma } from "./prisma";

export const SHEET_LEADS_SECRET_KEY = "sheet_leads_webhook_secret";

/**
 * User id of the CRM/marketing supervisor who is notified (and owns the
 * follow-up task for unassigned leads) whenever a re-inquiry is detected. Set on
 * the CRM → Settings page; falls back to the CRM_REINQUIRY_SUPERVISOR_USER_ID
 * env var. When unresolved, re-inquiry tasks on unassigned leads stay unassigned
 * and the supervisor email is skipped (the in-app task still exists).
 */
export const REINQUIRY_SUPERVISOR_KEY = "crm_reinquiry_supervisor_user_id";

/**
 * Outbound Wabis WhatsApp automation (CRM → Settings → Integrations). Only the
 * global switch and the shared secret live here: destinations and per-consultant
 * agent overrides are WabisWebhookEndpoint rows, since Wabis needs one workflow
 * per consultant. See src/lib/crm-webhook.ts.
 *
 * The superseded `wabis_webhook_url` and `wabis_agent_overrides` rows are read
 * once by the 20260722090000 migration to seed that table, then left in place —
 * deleting configuration during a migration is irreversible and buys nothing.
 */
export const WABIS_WEBHOOK_ENABLED_KEY = "wabis_webhook_enabled";
/** Optional shared secret, sent as the `X-Webhook-Secret` request header. */
export const WABIS_WEBHOOK_SECRET_KEY = "wabis_webhook_secret";

/**
 * Re-marketing nurturing engine (CRM → Settings → Integrations). Separate on/off
 * from the lead-assignment webhook above: a site can run the assignment intro
 * without the drip, or vice-versa. See src/lib/crm-remarketing.ts.
 *
 * - ENABLED_KEY: "1" to run the daily scheduler + drain remarketing touches.
 * - URLS_KEY: one Wabis Webhook-Workflow callback URL PER TOUCH — Wabis workflows
 *   are single-template (one workflow = one URL = one template, no in-flow
 *   branching), so the CRM routes by touch index. Newline-separated and positional
 *   (line 1 = touch 1, …). The consultant's name/phone ride along in the payload
 *   for the template to display. Global (not per-consultant) — re-engagement
 *   returns through our own inbound endpoint, not a per-agent Wabis inbox.
 * - OFFSETS_KEY: comma-separated calendar-day offsets from remarketingStartedAt,
 *   default "5,19,33,45".
 * - KEYWORDS_KEY: comma-separated positive-intent reply keywords that auto-advance
 *   a lead to Follow-Up. Empty = advance on ANY reply (see crm-remarketing).
 * - INBOUND_SECRET_KEY: shared secret Wabis's inbound HTTP-API block must send
 *   (header `x-wabis-secret` or `?key=`) to authenticate a candidate reply.
 */
export const WABIS_REMARKETING_ENABLED_KEY = "wabis_remarketing_enabled";
export const WABIS_REMARKETING_URLS_KEY = "wabis_remarketing_urls";
export const WABIS_REMARKETING_OFFSETS_KEY = "wabis_remarketing_offsets";
export const WABIS_REMARKETING_KEYWORDS_KEY = "wabis_remarketing_keywords";
export const WABIS_INBOUND_SECRET_KEY = "wabis_inbound_secret";

/**
 * Inbound WhatsApp lead capture (CRM → Settings → Lead Capture). A Wabis
 * keyword-reply flow whose "Forward Data to Webhook" points at
 * /api/crm/integrations/wabis/capture creates a CRM lead when a candidate first
 * messages the marketing number with the campaign keyword (e.g. "study abroad").
 * Authenticated with the shared WABIS_INBOUND_SECRET_KEY above — same Wabis
 * account, so one inbound secret covers both the re-marketing reply hook and this.
 *
 * - ENABLED_KEY: "1" to accept capture posts; fail-closed when off.
 * - KEYWORD_KEY: server-side safety-net phrase the message must contain
 *   (case-insensitive). Blank = trust Wabis's own keyword gate.
 * - CAMPAIGN_KEY: campaign label stamped on captured leads (default "Study Abroad").
 */
export const WABIS_CAPTURE_ENABLED_KEY = "wabis_capture_enabled";
export const WABIS_CAPTURE_KEYWORD_KEY = "wabis_capture_keyword";
export const WABIS_CAPTURE_CAMPAIGN_KEY = "wabis_capture_campaign";

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string, userId?: string | null): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value, updatedById: userId ?? null },
    update: { value, updatedById: userId ?? null },
  });
}

/**
 * The shared secret for the lead-spreadsheet webhook. Prefers the in-app value
 * (AppSetting, managed on the CRM Integrations page); falls back to the
 * SHEET_LEADS_WEBHOOK_SECRET env var so an env-only setup keeps working.
 */
export async function getSheetLeadsSecret(): Promise<string | null> {
  const fromDb = await getSetting(SHEET_LEADS_SECRET_KEY).catch(() => null);
  if (fromDb) return fromDb;
  return process.env.SHEET_LEADS_WEBHOOK_SECRET || null;
}
