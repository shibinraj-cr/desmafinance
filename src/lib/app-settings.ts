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
 * WhatsApp conversation mirror (src/lib/wa/*).
 *
 * - PROVIDER_KEY: which transport carries WhatsApp — "wabis" (default) or
 *   "cloud" once the number is migrated onto our own WABA. One setting is the
 *   whole cutover switch; nothing above the provider interface reads it.
 * - MIRROR_ENABLED_KEY: whether the ingest endpoint stores conversations at all.
 *   Off by default so deploying the tables changes no behaviour until an admin
 *   turns it on.
 * - MIRROR_SECRET_KEY: shared secret the message webhook must present, sent as
 *   `x-wa-secret` or `?key=`. Separate from the re-marketing inbound secret so
 *   rotating one never silently breaks the other.
 * - MIRROR_AUTOCREATE_KEY: create a Lead for a number we have never seen. On by
 *   default — an unknown number messaging us IS an inbound lead, and this is the
 *   gap the Wabis keyword flow could never close.
 */
export const WA_PROVIDER_KEY = "wa_provider";
export const WA_MIRROR_ENABLED_KEY = "wa_mirror_enabled";
export const WA_MIRROR_SECRET_KEY = "wa_mirror_secret";
export const WA_MIRROR_AUTOCREATE_KEY = "wa_mirror_autocreate_leads";

/**
 * Meta WhatsApp Cloud API credentials, used once `wa_provider = "cloud"`.
 *
 * Settings-first with an env fallback, matching how the SMTP credentials work —
 * an admin can configure the integration in-app, and a deployment can pin it.
 *
 * - PHONE_NUMBER_ID: the sending number's id (NOT the number itself).
 * - WABA_ID: the WhatsApp Business Account, needed only to list templates.
 * - TOKEN: a permanent System User access token. The one true secret here.
 * - APP_SECRET: verifies Meta's `X-Hub-Signature-256` on inbound webhooks. Without
 *   it the mirror falls back to the shared-secret check, which is weaker but
 *   still closed.
 * - API_VERSION: pinned (e.g. "v21.0") so a Graph API release cannot change
 *   behaviour underneath us.
 */
export const WA_CLOUD_PHONE_NUMBER_ID_KEY = "wa_cloud_phone_number_id";
export const WA_CLOUD_WABA_ID_KEY = "wa_cloud_waba_id";
export const WA_CLOUD_TOKEN_KEY = "wa_cloud_access_token";
export const WA_CLOUD_APP_SECRET_KEY = "wa_cloud_app_secret";
export const WA_CLOUD_API_VERSION_KEY = "wa_cloud_api_version";

/**
 * Wabis developer API key (avatar menu → API Developer). Used ONLY by the
 * one-off history import (src/lib/wa/wabis-import.ts) — sending still goes
 * through the provider seam. Sent as an `apiToken` request parameter, which is
 * Wabis's scheme: no header, no signing, so it is POSTed rather than put in a
 * query string where it would land in access logs.
 */
export const WABIS_API_TOKEN_KEY = "wabis_api_token";

/** Marketing broadcasts (src/lib/wa/broadcast.ts). */
export const WA_BROADCAST_ENABLED_KEY = "wa_broadcast_enabled";
/** Messages per drain run — the throttle that keeps us inside Meta's rate limits. */
export const WA_BROADCAST_BATCH_KEY = "wa_broadcast_batch_size";

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
