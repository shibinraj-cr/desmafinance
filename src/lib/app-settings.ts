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
