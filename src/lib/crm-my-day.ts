/**
 * My Day — one ordered answer to a consultant's "who do I contact next?".
 *
 * Before this the answer lived in four places that did not know about each
 * other: the inbox's Needs-reply filter, the task board, the uncontacted-lead
 * pop-up and the quality reminder. This reads all four for the signed-in
 * consultant and puts them in the order the work should be done:
 *
 *   1. candidates waiting for a reply on WhatsApp — oldest wait first, because
 *      the 24-hour window is closing on them and they are the ones who wrote;
 *   2. newly assigned leads nobody has contacted yet (past the alarm window);
 *   3. tasks overdue, then due today;
 *   4. quality ratings due.
 *
 * Always the viewer's own work, whatever their role. Read-only: every action
 * happens on the lead or the inbox thread it links to.
 */
import { prisma } from "./prisma";
import { uncontactedLeadsFor } from "./crm-uncontacted-leads";
import { qualityRemindersFor } from "./crm-lead-quality-data";
import { startOfLocalDay, startOfNextLocalDay } from "./crm-team";

const LIST_LIMIT = 50;
const HOUR_MS = 3_600_000;

export type MyDayWaiting = {
  conversationId: string;
  leadId: string | null;
  candidateName: string;
  phoneE164: string;
  waitingSince: string | null;
  /** Hours left in WhatsApp's 24-hour reply window, or null when it has closed. */
  windowHoursLeft: number | null;
};

export type MyDayTask = {
  taskId: string;
  leadId: string;
  candidateName: string;
  phone: string | null;
  subject: string;
  dueAt: string;
  overdue: boolean;
};

export type MyDayLead = { leadId: string; candidateName: string; phone: string | null; since: string; detail: string | null };

export type MyDay = {
  waiting: MyDayWaiting[];
  waitingTotal: number;
  uncontacted: MyDayLead[];
  uncontactedTotal: number;
  tasks: MyDayTask[];
  tasksOverdue: number;
  tasksToday: number;
  quality: MyDayLead[];
  qualityTotal: number;
};

/** Whole hours left until `expiresAt`, or null when it has passed (or there is none). */
export function windowHoursLeft(expiresAt: Date | null, now: Date): number | null {
  if (!expiresAt) return null;
  const ms = expiresAt.getTime() - now.getTime();
  return ms > 0 ? Math.floor(ms / HOUR_MS) : null;
}

/** "3h", "2d 4h" — how long something has been waiting. */
export function formatWait(since: Date, now: Date): string {
  const hours = Math.max(0, Math.floor((now.getTime() - since.getTime()) / HOUR_MS));
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${d}d ${h}h` : `${d}d`;
}

/** The first lead to open from My Day, in the order the page lists the work. */
export function firstLeadId(day: MyDay): string | null {
  return (
    day.waiting.find((w) => w.leadId)?.leadId ??
    day.uncontacted[0]?.leadId ??
    day.tasks[0]?.leadId ??
    day.quality[0]?.leadId ??
    null
  );
}

export async function getMyDay(userId: string, now: Date = new Date()): Promise<MyDay> {
  const today = startOfLocalDay(now);
  const tomorrow = startOfNextLocalDay(now);
  const waitingWhere = { assignedToId: userId, awaitingReply: true };
  const taskWhere = { assignedToId: userId, status: "open", dueAt: { lt: tomorrow } };

  const [waitingRows, waitingTotal, uncontacted, taskRows, tasksOverdue, tasksToday, quality] = await Promise.all([
    prisma.waConversation.findMany({
      where: waitingWhere,
      orderBy: [{ lastInboundAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      take: LIST_LIMIT,
      select: {
        id: true,
        phoneE164: true,
        lastInboundAt: true,
        sessionExpiresAt: true,
        lead: { select: { id: true, candidateName: true } },
      },
    }),
    prisma.waConversation.count({ where: waitingWhere }),
    uncontactedLeadsFor(userId, "own", now),
    prisma.crmTask.findMany({
      where: taskWhere,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: LIST_LIMIT * 2,
      select: {
        id: true,
        subject: true,
        dueAt: true,
        lead: { select: { id: true, candidateName: true, phone: true } },
      },
    }),
    prisma.crmTask.count({ where: { ...taskWhere, dueAt: { lt: today } } }),
    prisma.crmTask.count({ where: { ...taskWhere, dueAt: { gte: today, lt: tomorrow } } }),
    qualityRemindersFor(userId),
  ]);

  return {
    waiting: waitingRows.map((c) => ({
      conversationId: c.id,
      leadId: c.lead?.id ?? null,
      candidateName: c.lead?.candidateName ?? c.phoneE164,
      phoneE164: c.phoneE164,
      waitingSince: c.lastInboundAt?.toISOString() ?? null,
      windowHoursLeft: windowHoursLeft(c.sessionExpiresAt, now),
    })),
    waitingTotal,
    uncontacted: uncontacted.leads.map((l) => ({
      leadId: l.id,
      candidateName: l.candidateName,
      phone: l.phone,
      since: l.assignedAt,
      detail: l.source,
    })),
    uncontactedTotal: uncontacted.total,
    tasks: taskRows.map((t) => ({
      taskId: t.id,
      leadId: t.lead.id,
      candidateName: t.lead.candidateName,
      phone: t.lead.phone,
      subject: t.subject,
      dueAt: t.dueAt!.toISOString(),
      overdue: t.dueAt!.getTime() < today.getTime(),
    })),
    tasksOverdue,
    tasksToday,
    quality: quality.leads.map((l) => ({
      leadId: l.id,
      candidateName: l.candidateName,
      phone: null,
      since: l.dueAt,
      detail: [l.source, l.campaign].filter(Boolean).join(" · ") || null,
    })),
    qualityTotal: quality.total,
  };
}
