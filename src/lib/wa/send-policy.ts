/**
 * One send policy for every AUTOMATED WhatsApp message.
 *
 * To a candidate, DesGro is one WhatsApp number. Before this, five senders — the
 * assignment intro, the re-marketing drip, broadcasts, task reminders, the
 * e-sign notice — each kept its own consent check and its own idea of when it
 * was polite to send, and nothing stopped three of them landing on the same
 * person the same evening. This module is the shared answer to three
 * questions, asked at SEND time (never only when a message was queued, since a
 * deferred send can wake hours later):
 *
 *   1. Consent, per PHONE. A person is a phone here; the CRM holds several lead
 *      rows per phone by design (re-enrollment, duplicates), and an opt-out on
 *      one of them is an opt-out for the number.
 *   2. Quiet hours, in the candidate's own timezone, inferred from the number's
 *      country code. Many candidates are Indian nurses working in the Gulf on
 *      +91 numbers, so the +91 marketing window (10:00–19:30 IST) is chosen to
 *      also fall inside Gulf working hours.
 *   3. A contact limit for MARKETING: at most {@link MARKETING_PER_DAY} per
 *      rolling 24 hours and {@link MARKETING_PER_WEEK} per rolling 7 days, across
 *      every sender. Service messages (reminders, the intro) are logged but
 *      never limited.
 *
 * A send the policy holds back is DEFERRED, not dropped: callers get the moment
 * it may go and retry then. A consultant's own messages never pass through here.
 */
import { prisma } from "../prisma";
import { logger } from "../logger";

export type SendPurpose = "marketing" | "service";
export type SendSource = "broadcast" | "drip" | "reminder" | "intro";

export const MARKETING_PER_DAY = 1;
export const MARKETING_PER_WEEK = 3;

const MIN = 60_000;
const DAY_MS = 86_400_000;

export type PolicyVerdict =
  | { ok: true }
  | { ok: false; reason: "opted_out" }
  | { ok: false; reason: "quiet_hours" | "contact_limit"; notBefore: Date };

// ── Pure rules (unit-tested) ────────────────────────────────────────────────

/** Calling code → IANA timezone. Longest prefix wins; unknown numbers use India. */
const TIMEZONE_BY_PREFIX: ReadonlyArray<[string, string]> = [
  ["+971", "Asia/Dubai"],
  ["+966", "Asia/Riyadh"],
  ["+974", "Asia/Qatar"],
  ["+965", "Asia/Kuwait"],
  ["+968", "Asia/Muscat"],
  ["+973", "Asia/Bahrain"],
  ["+977", "Asia/Kathmandu"],
  ["+353", "Europe/Dublin"],
  ["+91", "Asia/Kolkata"],
  ["+61", "Australia/Sydney"],
  ["+64", "Pacific/Auckland"],
  ["+44", "Europe/London"],
  ["+65", "Asia/Singapore"],
  ["+60", "Asia/Kuala_Lumpur"],
  ["+63", "Asia/Manila"],
  ["+1", "America/New_York"],
];
const DEFAULT_TIMEZONE = "Asia/Kolkata";

export function timezoneForPhone(phoneE164: string): string {
  const hit = [...TIMEZONE_BY_PREFIX].sort((a, b) => b[0].length - a[0].length).find(([p]) => phoneE164.startsWith(p));
  return hit ? hit[1] : DEFAULT_TIMEZONE;
}

/** Allowed local-time window, as minutes after local midnight: [start, end). */
export function sendWindow(phoneE164: string, purpose: SendPurpose): { tz: string; startMin: number; endMin: number } {
  const tz = timezoneForPhone(phoneE164);
  // +91 marketing: 10:00–19:30 IST, which is also 08:30–18:00 in the UAE and
  // 07:30–17:00 in Saudi — inside working hours for an Indian nurse abroad.
  if (purpose === "marketing" && tz === "Asia/Kolkata") return { tz, startMin: 10 * 60, endMin: 19 * 60 + 30 };
  return { tz, startMin: 9 * 60, endMin: 20 * 60 };
}

/** Minutes after local midnight in `tz` at instant `now`. */
export function localMinutes(now: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  return Number(parts.hour) * 60 + Number(parts.minute);
}

/** When this send may go, or null when now is inside the candidate's window. */
export function quietHoursNotBefore(now: Date, phoneE164: string, purpose: SendPurpose): Date | null {
  const { tz, startMin, endMin } = sendWindow(phoneE164, purpose);
  const local = localMinutes(now, tz);
  if (local >= startMin && local < endMin) return null;
  const minutesUntilStart = local < startMin ? startMin - local : 24 * 60 - local + startMin;
  // Whole minutes are fine: the next drain/scheduler run is what actually sends.
  return new Date(Math.floor(now.getTime() / MIN) * MIN + minutesUntilStart * MIN);
}

/**
 * When the next marketing message may go to a phone with these recent
 * marketing sends, or null when it may go now.
 */
export function contactLimitNotBefore(recentMarketingSends: Date[], now: Date): Date | null {
  const t = now.getTime();
  const lastDay = recentMarketingSends.filter((d) => t - d.getTime() < DAY_MS).sort((a, b) => +a - +b);
  const lastWeek = recentMarketingSends.filter((d) => t - d.getTime() < 7 * DAY_MS).sort((a, b) => +a - +b);
  let notBefore: number | null = null;
  if (lastDay.length >= MARKETING_PER_DAY) {
    notBefore = lastDay[lastDay.length - MARKETING_PER_DAY].getTime() + DAY_MS;
  }
  if (lastWeek.length >= MARKETING_PER_WEEK) {
    const w = lastWeek[lastWeek.length - MARKETING_PER_WEEK].getTime() + 7 * DAY_MS;
    notBefore = notBefore === null ? w : Math.max(notBefore, w);
  }
  return notBefore === null ? null : new Date(notBefore);
}

// ── Database ────────────────────────────────────────────────────────────────

/** Has anyone on this number asked us to stop? Matches both phone fields of every lead. */
export async function isPhoneOptedOut(phoneE164: string): Promise<boolean> {
  const n = await prisma.lead.count({
    where: { OR: [{ phoneE164 }, { altPhoneE164: phoneE164 }], whatsappOptedOutAt: { not: null } },
  });
  return n > 0;
}

/**
 * May this automated message go to this phone now?
 *
 * `quietHours: false` is for a message the candidate is waiting for at that
 * moment — the assignment intro, sent seconds after she filled in a form.
 */
export async function checkAutomatedSend(input: {
  phoneE164: string;
  purpose: SendPurpose;
  quietHours?: boolean;
  now?: Date;
}): Promise<PolicyVerdict> {
  const now = input.now ?? new Date();
  if (await isPhoneOptedOut(input.phoneE164)) return { ok: false, reason: "opted_out" };

  if (input.quietHours !== false) {
    const quiet = quietHoursNotBefore(now, input.phoneE164, input.purpose);
    if (quiet) return { ok: false, reason: "quiet_hours", notBefore: quiet };
  }

  if (input.purpose === "marketing") {
    const recent = await prisma.waContactLog.findMany({
      where: { phoneE164: input.phoneE164, purpose: "marketing", sentAt: { gt: new Date(now.getTime() - 7 * DAY_MS) } },
      select: { sentAt: true },
    });
    const limit = contactLimitNotBefore(
      recent.map((r) => r.sentAt),
      now,
    );
    if (limit) return { ok: false, reason: "contact_limit", notBefore: limit };
  }
  return { ok: true };
}

/** Record an automated send that went out. Best-effort: a ledger hiccup must never fail a send. */
export async function logAutomatedSend(input: {
  phoneE164: string;
  purpose: SendPurpose;
  source: SendSource;
  leadId?: string | null;
  at?: Date;
}): Promise<void> {
  try {
    await prisma.waContactLog.create({
      data: {
        phoneE164: input.phoneE164,
        purpose: input.purpose,
        source: input.source,
        leadId: input.leadId ?? null,
        sentAt: input.at ?? new Date(),
      },
    });
  } catch (e) {
    logger.warn("wa_contact_log_failed", { source: input.source, message: e instanceof Error ? e.message : String(e) });
  }
}
