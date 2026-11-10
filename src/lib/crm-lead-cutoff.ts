/**
 * When the lead-cutoff cron speaks, and what it says (rules; the DB side is
 * crm-lead-cutoff-data.ts):
 *
 *   - 1 hour before the cutoff: each BDE with leads or handovers still due today
 *   - at the cutoff: the Marketing Admin gets the day's misses and overdue
 *     handovers per BDE
 *   - when a handover is saved: its BDE; a duplicate also tells the Marketing
 *     Admin and the existing lead's owner; a rejection tells the Marketing Admin
 *
 * All in-app (CrmNotification) — the web bell and the app's notification list.
 */
import { istClock, plural } from "./crm-lead-report";
import { istDateString } from "./lead-pulse-dates";

export const REMINDER_KIND = "lead_cutoff_reminder";
export const SUMMARY_KIND = "lead_cutoff_summary";
export const HANDOVER_ASSIGNED_KIND = "handover_assigned";
export const HANDOVER_DUPLICATE_KIND = "handover_duplicate";
export const HANDOVER_REJECTED_KIND = "handover_rejected";

const MINUTE = 60_000;
export const REMINDER_BEFORE_MINUTES = 60;
/** The summary goes out on the first tick at or after the cutoff — or later, if the cron was down for a while. */
export const SUMMARY_WINDOW_MINUTES = 6 * 60;

/** Which notifications this tick may send. Both are also de-duplicated per person per day. */
export function cutoffPhase(cutoff: Date | null, now: Date): { reminder: boolean; summary: boolean } {
  if (!cutoff) return { reminder: false, summary: false };
  const t = now.getTime() - cutoff.getTime();
  return {
    reminder: t >= -REMINDER_BEFORE_MINUTES * MINUTE && t < 0,
    summary: t >= 0 && t < SUMMARY_WINDOW_MINUTES * MINUTE,
  };
}

const WEEKDAY = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** "5:00 pm today" / "3:30 pm Sat, 14 Nov" — a deadline in IST. */
export function dueLabel(due: Date, now: Date): string {
  const when = istDateString(due) === istDateString(now) ? "today" : WEEKDAY.format(due);
  return `${istClock(due)} ${when}`;
}

type Note = { title: string; body: string };

export function reminderNotification(leads: number, handovers: number, cutoff: Date): Note {
  const what = [leads ? plural(leads, "lead") : null, handovers ? plural(handovers, "handover") : null]
    .filter(Boolean)
    .join(" and ");
  return {
    title: `Contact before ${istClock(cutoff)}`,
    body: `${what} still waiting on you today. Anything not done by the cutoff counts as missed.`,
  };
}

export function cutoffSummaryNotification(
  rows: { name: string; missed: number; overdue: number }[],
  cutoff: Date,
): Note {
  const missed = rows.reduce((s, r) => s + r.missed, 0);
  const overdue = rows.reduce((s, r) => s + r.overdue, 0);
  const head = [missed ? plural(missed, "missed lead") : null, overdue ? plural(overdue, "overdue handover") : null]
    .filter(Boolean)
    .join(", ");
  const lines = rows
    .filter((r) => r.missed || r.overdue)
    .sort((a, b) => b.missed + b.overdue - (a.missed + a.overdue) || a.name.localeCompare(b.name))
    .map((r) =>
      [r.name, [r.missed ? `${r.missed} missed` : null, r.overdue ? `${r.overdue} handover${r.overdue === 1 ? "" : "s"} overdue` : null]
        .filter(Boolean)
        .join(", ")].join(" — "),
    );
  return { title: `${istClock(cutoff)} cutoff: ${head}`, body: lines.join("\n") };
}

const who = (h: { leadName: string | null; phone: string }) => (h.leadName ? `${h.leadName} (${h.phone})` : h.phone);

export function handoverAssignedNotification(
  rows: { leadName: string | null; phone: string }[],
  channelLabel: string,
  dueAt: Date,
  now: Date,
): Note {
  if (rows.length === 1) {
    return {
      title: `New handover: ${who(rows[0])}`,
      body: `${channelLabel}. Create the lead in the CRM by ${dueLabel(dueAt, now)}.`,
    };
  }
  return {
    title: `${rows.length} new handovers (${channelLabel})`,
    body: `Create them in the CRM by ${dueLabel(dueAt, now)}:\n${rows.map(who).join("\n")}`,
  };
}

export function handoverDuplicateNotification(
  rows: { leadName: string | null; phone: string; bdeName: string; ownerName: string | null }[],
): Note {
  const line = (r: (typeof rows)[number]) =>
    `${who(r)} — handed to ${r.bdeName}; already a lead, ${r.ownerName ? `owned by ${r.ownerName}` : "unassigned"}`;
  if (rows.length === 1) return { title: "Handover is already a lead", body: line(rows[0]) };
  return { title: `${rows.length} handovers are already leads`, body: rows.map(line).join("\n") };
}

export function handoverRejectedNotification(h: {
  leadName: string | null;
  phone: string;
  bdeName: string;
  reasonLabel: string;
  note: string | null;
}): Note {
  return {
    title: `Handover rejected: ${h.leadName ?? h.phone}`,
    body: [`${h.bdeName} — ${h.reasonLabel}`, h.leadName ? h.phone : null, h.note].filter(Boolean).join(" · "),
  };
}
