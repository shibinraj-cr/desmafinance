/**
 * The lead-cutoff cron's work (every 5 minutes, /api/cron/lead-cutoff) and the
 * handover notifications. Rules and wording: crm-lead-cutoff.ts.
 *
 * One tick:
 *   1. keep assignment rows in step with lead owners (syncAssignments)
 *   2. re-judge pending assignments — past the cutoff they become missed
 *   3. pending handovers past their deadline become overdue
 *   4. settle handovers whose number reached the BDE by another route
 *   5. in the hour before today's cutoff, remind each BDE with work left
 *   6. from the cutoff, generate every BDE's report for the day (they submit
 *      nothing), catching up the day before if a tick was missed
 *   7. from the cutoff, send the Marketing Admin the day's misses
 * Every step is idempotent and each runs even if an earlier one failed.
 * Notifications go once per person per IST day.
 */
import { prisma } from "./prisma";
import { logger } from "./logger";
import { loadHolidaySet } from "./ops-dates";
import { addDays, istDateString } from "./lead-pulse-dates";
import { istDayWindow } from "./crm-daily-report";
import { cutoffOn } from "./crm-cutoff";
import { evaluateAssignments, leadReportStart, syncAssignments } from "./crm-contact-data";
import { linkArrivedLeads, markOverdueHandovers, type SavedHandover } from "./crm-handover-data";
import { generateDayReports } from "./crm-lead-report-data";
import { HANDOVER_REJECT_REASONS, handoverChannel } from "./crm-handover";
import { marketingAdminUserIds } from "./crm-notify";
import {
  HANDOVER_ASSIGNED_KIND,
  HANDOVER_DUPLICATE_KIND,
  HANDOVER_REJECTED_KIND,
  REMINDER_KIND,
  SUMMARY_KIND,
  cutoffPhase,
  cutoffSummaryNotification,
  handoverAssignedNotification,
  handoverDuplicateNotification,
  handoverRejectedNotification,
  reminderNotification,
} from "./crm-lead-cutoff";

/** Where the notifications point: the BDE's My Day, the manager's team report. */
export const MY_DAY_URL = "/crm/my-day";
export const TEAM_REPORT_URL = "/crm/report";

async function names(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, username: true, leadPulseRole: { select: { displayName: true } } },
  });
  return new Map(users.map((u) => [u.id, u.leadPulseRole?.displayName ?? u.username]));
}

async function activeOnly(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { id: true } });
  return users.map((u) => u.id);
}

/** Who already got `kind` since `since` — for once-a-day notifications. */
async function alreadyNotified(kind: string, userIds: string[], since: Date): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await prisma.crmNotification.findMany({
    where: { kind, userId: { in: userIds }, createdAt: { gte: since } },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

// ── The tick ─────────────────────────────────────────────────────────────────

export type TickSummary = {
  opened: number;
  closed: number;
  judged: number;
  overdue: number;
  linked: number;
  reminders: number;
  /** Day reports generated this tick (today's and any caught-up from the day before). */
  reports: number;
  summaries: number;
  errors: string[];
};

export async function runLeadCutoffTick(now: Date = new Date()): Promise<TickSummary> {
  const out: TickSummary = { opened: 0, closed: 0, judged: 0, overdue: 0, linked: 0, reminders: 0, reports: 0, summaries: 0, errors: [] };
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.errors.push(`${name}: ${message}`);
      logger.error("lead_cutoff_step_failed", { step: name, error: message });
    }
  };

  await step("sync", async () => void Object.assign(out, await syncAssignments(now)));
  await step("judge", async () => void (out.judged = await evaluateAssignments({ now })));
  await step("overdue", async () => void (out.overdue = await markOverdueHandovers(now)));
  await step("link", async () => void (out.linked = await linkArrivedLeads(now)));

  const today = istDateString(now);
  const yesterday = addDays(today, -1);
  const holidays = await loadHolidaySet(prisma);
  const cutoff = cutoffOn(today, holidays);
  const phase = cutoffPhase(cutoff, now);
  if (cutoff && phase.reminder) await step("reminders", async () => void (out.reminders = await sendCutoffReminders(today, cutoff)));
  // A generated day is skipped, so once everyone's report exists these are one query each.
  // The catch-up never reaches back before tracking began (go-live day).
  await step("reports", async () => {
    const start = await leadReportStart();
    const tracked = !start || yesterday >= istDateString(start);
    if (tracked && cutoffOn(yesterday, holidays)) out.reports += await generateDayReports(yesterday, now);
    if (cutoff && now.getTime() >= cutoff.getTime()) out.reports += await generateDayReports(today, now);
  });
  if (cutoff && phase.summary) await step("summary", async () => void (out.summaries = await sendCutoffSummary(today, cutoff)));
  return out;
}

/** 1 hour before the cutoff: each BDE with leads or handovers still due today. */
export async function sendCutoffReminders(today: string, cutoff: Date): Promise<number> {
  const { fromUtc, toUtc } = istDayWindow(today);
  const [leads, handovers] = await Promise.all([
    prisma.crmLeadAssignment.groupBy({
      by: ["userId"],
      where: { contactStatus: "pending", endedAt: null, contactDueAt: { gte: fromUtc, lt: toUtc } },
      _count: { _all: true },
    }),
    prisma.crmLeadHandover.groupBy({
      by: ["assignedBdeId"],
      where: { status: "pending", dueAt: { gte: fromUtc, lt: toUtc } },
      _count: { _all: true },
    }),
  ]);
  const work = new Map<string, { leads: number; handovers: number }>();
  for (const l of leads) work.set(l.userId, { leads: l._count._all, handovers: 0 });
  for (const h of handovers) {
    const w = work.get(h.assignedBdeId) ?? { leads: 0, handovers: 0 };
    w.handovers = h._count._all;
    work.set(h.assignedBdeId, w);
  }
  const active = await activeOnly([...work.keys()]);
  const done = await alreadyNotified(REMINDER_KIND, active, fromUtc);
  const to = active.filter((id) => !done.has(id));
  if (to.length === 0) return 0;
  await prisma.crmNotification.createMany({
    data: to.map((userId) => {
      const w = work.get(userId)!;
      return { userId, kind: REMINDER_KIND, ...reminderNotification(w.leads, w.handovers, cutoff), linkUrl: MY_DAY_URL };
    }),
  });
  return to.length;
}

/** From the cutoff: the Marketing Admin gets today's misses and the overdue handovers, per BDE. */
export async function sendCutoffSummary(today: string, cutoff: Date): Promise<number> {
  const { fromUtc, toUtc } = istDayWindow(today);
  const admins = await marketingAdminUserIds();
  const done = await alreadyNotified(SUMMARY_KIND, admins, fromUtc);
  const to = admins.filter((id) => !done.has(id));
  if (to.length === 0) return 0;

  const [missed, overdue] = await Promise.all([
    prisma.crmLeadAssignment.groupBy({
      by: ["userId"],
      where: { contactStatus: { in: ["missed", "contacted_late"] }, contactDueAt: { gte: fromUtc, lt: toUtc } },
      _count: { _all: true },
    }),
    prisma.crmLeadHandover.groupBy({ by: ["assignedBdeId"], where: { status: "overdue" }, _count: { _all: true } }),
  ]);
  if (missed.length === 0 && overdue.length === 0) return 0; // a clean day needs no message

  const per = new Map<string, { missed: number; overdue: number }>();
  for (const m of missed) per.set(m.userId, { missed: m._count._all, overdue: 0 });
  for (const o of overdue) {
    const p = per.get(o.assignedBdeId) ?? { missed: 0, overdue: 0 };
    p.overdue = o._count._all;
    per.set(o.assignedBdeId, p);
  }
  const nameOf = await names([...per.keys()]);
  const note = cutoffSummaryNotification(
    [...per].map(([id, p]) => ({ name: nameOf.get(id) ?? "Unknown", ...p })),
    cutoff,
  );
  await prisma.crmNotification.createMany({
    data: to.map((userId) => ({ userId, kind: SUMMARY_KIND, ...note, linkUrl: `${TEAM_REPORT_URL}?date=${today}` })),
  });
  return to.length;
}

// ── Handover events (best-effort: never fail the save or the reject) ─────────

export async function notifyHandoversSaved(input: {
  saved: SavedHandover[];
  channel: string;
  assignedBdeId: string;
  actorId: string;
  now?: Date;
}): Promise<void> {
  try {
    const now = input.now ?? new Date();
    const channelLabel = handoverChannel(input.channel)?.label ?? input.channel;
    const pending = input.saved.filter((h) => h.status === "pending");
    const dups = input.saved.filter((h) => h.status === "duplicate");
    const data: { userId: string; kind: string; title: string; body: string; linkUrl: string; leadId?: string }[] = [];

    if (pending.length && input.assignedBdeId !== input.actorId) {
      data.push({
        userId: input.assignedBdeId,
        kind: HANDOVER_ASSIGNED_KIND,
        ...handoverAssignedNotification(
          pending.map((h) => ({ leadName: h.leadName, phone: h.phoneE164 })),
          channelLabel,
          pending[0].dueAt,
          now,
        ),
        linkUrl: MY_DAY_URL,
      });
    }

    if (dups.length) {
      const nameOf = await names([input.assignedBdeId, ...dups.flatMap((d) => (d.existingOwnerId ? [d.existingOwnerId] : []))]);
      const rows = dups.map((d) => ({
        leadName: d.leadName,
        phone: d.phoneE164,
        bdeName: nameOf.get(input.assignedBdeId) ?? "the BDE",
        ownerName: d.existingOwnerId ? (nameOf.get(d.existingOwnerId) ?? null) : null,
      }));
      const recipients = new Set([
        ...(await marketingAdminUserIds()),
        input.assignedBdeId,
        ...dups.flatMap((d) => (d.existingOwnerId ? [d.existingOwnerId] : [])),
      ]);
      recipients.delete(input.actorId);
      const note = handoverDuplicateNotification(rows);
      const single = dups.length === 1 ? dups[0].linkedLeadId : null;
      for (const userId of await activeOnly([...recipients])) {
        data.push({
          userId,
          kind: HANDOVER_DUPLICATE_KIND,
          ...note,
          linkUrl: single ? `/crm/leads/${single}` : "/crm/handovers",
          ...(single ? { leadId: single } : {}),
        });
      }
    }
    if (data.length) await prisma.crmNotification.createMany({ data });
  } catch (err) {
    logger.warn("handover_notify_failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

export async function notifyHandoverRejected(handoverId: string, actorId: string): Promise<void> {
  try {
    const h = await prisma.crmLeadHandover.findUnique({
      where: { id: handoverId },
      select: { leadName: true, phone: true, assignedBdeId: true, rejectReason: true, rejectNote: true },
    });
    if (!h) return;
    const admins = (await marketingAdminUserIds()).filter((id) => id !== actorId);
    if (admins.length === 0) return;
    const nameOf = await names([actorId]);
    const note = handoverRejectedNotification({
      leadName: h.leadName,
      phone: h.phone,
      bdeName: nameOf.get(actorId) ?? "A BDE",
      reasonLabel: HANDOVER_REJECT_REASONS.find((r) => r.code === h.rejectReason)?.label ?? "Rejected",
      note: h.rejectNote,
    });
    await prisma.crmNotification.createMany({
      data: admins.map((userId) => ({ userId, kind: HANDOVER_REJECTED_KIND, ...note, linkUrl: "/crm/handovers" })),
    });
  } catch (err) {
    logger.warn("handover_notify_failed", { error: err instanceof Error ? err.message : String(err) });
  }
}
