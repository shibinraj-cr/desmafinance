import { prisma } from "@/lib/prisma";
import { getSetting, setSetting } from "@/lib/app-settings";
import { isAdmin, fromLegacyString, type Permissions } from "@/lib/rbac";
import { canApproveHr } from "@/lib/hr-rbac";

/**
 * eTimeOffice subscription-expiry tracking + renewal alerts.
 *
 * The eTimeOffice API exposes NO account/subscription endpoint (only punch
 * data) — the "Account will expire in N days" lives solely in their web portal.
 * So the renewal date is entered manually (once a year) on the Biometric Sync
 * settings page and stored in AppSetting. Everything downstream is automatic:
 * a countdown on the attendance screen, and in-app notifications to admins + HR
 * approvers as expiry nears (piggybacked on the sync cron).
 */

export const SUBSCRIPTION_EXPIRY_KEY = "etimeoffice_subscription_expiry";
const NOTIFY_MARKER_PREFIX = "etimeoffice_expiry_notified"; // :<expiryISO>:<threshold>

/** Days-before-expiry at which to notify. (Plus an implicit 0 = expired.) */
export const EXPIRY_NOTIFY_DAYS = [7, 1];
/** Within this many days the attendance-screen banner turns red. */
export const EXPIRY_BANNER_DAYS = 7;

export type SubscriptionTone = "none" | "ok" | "warn" | "expired";

export type SubscriptionStatus = {
  expiry: string | null; // YYYY-MM-DD
  daysLeft: number | null;
  tone: SubscriptionTone;
  label: string;
};

/** Pure status from an expiry date and "now" — unit-tested. */
export function subscriptionStatus(expiry: Date | null, now: Date): SubscriptionStatus {
  if (!expiry) return { expiry: null, daysLeft: null, tone: "none", label: "Renewal date not set" };
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const exp = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  const daysLeft = Math.round((exp - today) / 86_400_000);
  const iso = expiry.toISOString().slice(0, 10);
  if (daysLeft < 0)
    return { expiry: iso, daysLeft, tone: "expired", label: `Subscription expired ${-daysLeft} day(s) ago` };
  if (daysLeft <= EXPIRY_BANNER_DAYS)
    return { expiry: iso, daysLeft, tone: "warn", label: `Subscription renews in ${daysLeft} day(s)` };
  return { expiry: iso, daysLeft, tone: "ok", label: `Subscription renews in ${daysLeft} day(s)` };
}

function parseExpiry(v: string | null | undefined): Date | null {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}

export async function getSubscriptionExpiry(): Promise<Date | null> {
  return parseExpiry(await getSetting(SUBSCRIPTION_EXPIRY_KEY).catch(() => null));
}

export async function getSubscriptionStatus(now: Date = new Date()): Promise<SubscriptionStatus> {
  return subscriptionStatus(await getSubscriptionExpiry(), now);
}

/** Store the renewal date (YYYY-MM-DD). Returns false on a bad date. */
export async function setSubscriptionExpiry(iso: string, userId: string | null): Promise<boolean> {
  if (!parseExpiry(iso)) return false;
  await setSetting(SUBSCRIPTION_EXPIRY_KEY, iso.slice(0, 10), userId);
  return true;
}

/** Build a Permissions object from a user's roleRef (or legacy string role). */
function permsForUser(user: {
  role: string;
  roleRef: { isAdmin: boolean; canApprove: boolean; needsApproval: boolean; pages: string[]; name: string } | null;
}): Permissions {
  const r = user.roleRef;
  if (!r) return fromLegacyString(user.role);
  return {
    isAdmin: r.isAdmin,
    canApprove: r.canApprove,
    needsApproval: r.needsApproval,
    draftFirst: false,
    pages: r.pages,
    roleName: r.name,
  };
}

/** Active users who should get renewal alerts: system admins + HR approvers. */
export async function subscriptionAlertRecipients(): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { isActive: true }, include: { roleRef: true } });
  return users.filter((u) => {
    const p = permsForUser(u);
    return isAdmin(p) || canApproveHr(p);
  }).map((u) => u.id);
}

/**
 * Check the expiry and, for the nearest crossed threshold not yet sent for the
 * current expiry date, notify every admin + HR approver. Deduped via an
 * AppSetting marker per (expiry, threshold) so the thrice-daily cron doesn't
 * spam — each threshold fires exactly once per subscription cycle, and a fresh
 * renewal date resets the markers. Best-effort: never throws.
 */
export async function checkAndNotifyExpiry(
  now: Date = new Date(),
): Promise<{ notified: number; threshold: number | null }> {
  try {
    const expiry = await getSubscriptionExpiry();
    if (!expiry) return { notified: 0, threshold: null };
    const st = subscriptionStatus(expiry, now);
    if (st.daysLeft == null) return { notified: 0, threshold: null };

    // Largest crossed threshold first, so at 6 days we send the "7-day" alert.
    const thresholds = [...EXPIRY_NOTIFY_DAYS, 0].sort((a, b) => b - a);
    for (const t of thresholds) {
      if (st.daysLeft > t) continue;
      const marker = `${NOTIFY_MARKER_PREFIX}:${st.expiry}:${t}`;
      if (await getSetting(marker).catch(() => null)) continue; // already sent

      const recipients = await subscriptionAlertRecipients();
      const expired = st.daysLeft < 0;
      const title = expired
        ? "Biometric subscription EXPIRED"
        : `Biometric subscription renews in ${st.daysLeft} day(s)`;
      const body = expired
        ? `The eTimeOffice attendance subscription expired on ${st.expiry}. Attendance sync will stop until it is renewed.`
        : `The eTimeOffice attendance subscription expires on ${st.expiry}. Please renew it to keep attendance syncing.`;
      for (const userId of recipients) {
        await prisma.crmNotification
          .create({
            data: { userId, kind: "etime_subscription_expiry", title, body, linkUrl: "/hr/attendance/settings" },
          })
          .catch(() => {});
      }
      await setSetting(marker, now.toISOString(), null).catch(() => {});
      return { notified: recipients.length, threshold: t };
    }
    return { notified: 0, threshold: null };
  } catch (e) {
    console.error("[etime-subscription] notify check failed:", e);
    return { notified: 0, threshold: null };
  }
}
