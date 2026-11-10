/**
 * The DB side of contact tracking (rules: crm-contact.ts, deadline: crm-cutoff.ts).
 *
 *   - recordAssignmentChange: called by every path that gives a lead an owner or
 *     takes it away, right after that change commits. Best-effort — a failure
 *     never fails the assignment; syncAssignments repairs it within one cron tick.
 *   - syncAssignments: the safety net. Opens rows for current owners that have
 *     none and closes rows whose lead has moved on.
 *   - evaluateAssignments: applies the contact rule to every row still pending
 *     (and recent misses, which can turn into contacted_late) and stores the result.
 *
 * Tracking starts at the AppSetting `crm_lead_report_start` (stamped by the
 * migration), so the safety net never back-fills leads assigned before go-live.
 */
import { prisma } from "./prisma";
import { logger } from "./logger";
import { getSetting } from "./app-settings";
import { loadHolidaySet } from "./ops-dates";
import { nextCutoff } from "./crm-cutoff";
import {
  CONTACT_ACTIVITY_TYPES,
  activityToContactEvent,
  evaluateContact,
  planAssignmentSync,
  type AssignmentRowState,
  type ContactEvent,
  type LeadOwnerState,
} from "./crm-contact";

export const LEAD_REPORT_START_KEY = "crm_lead_report_start";

const DAY_MS = 86_400_000;
/** How far back the safety net looks for assignments it may have missed. */
const SYNC_WINDOW_DAYS = 3;
/** How long a miss is re-checked so a late contact turns it into contacted_late. */
const MISSED_RECHECK_DAYS = 14;
const CHUNK = 500;

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** When contact tracking began, or null if the setting is missing or unreadable. */
export async function leadReportStart(): Promise<Date | null> {
  const raw = await getSetting(LEAD_REPORT_START_KEY);
  const d = raw ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/**
 * Leads changed owner at `at` (the exact `Lead.assignedAt` written, or the
 * release time). Closes each lead's earlier open row and opens one for the new
 * owner, due at the next cutoff. `userId: null` means the lead was released.
 */
export async function recordAssignmentChange(
  at: Date,
  leads: { leadId: string; userId: string | null }[],
): Promise<void> {
  if (leads.length === 0) return;
  try {
    for (const part of chunks(leads)) {
      await prisma.crmLeadAssignment.updateMany({
        // Only rows that began before this change: a row the safety net opened
        // for this very assignment a moment ago must stay open.
        where: { leadId: { in: part.map((l) => l.leadId) }, endedAt: null, assignedAt: { lt: at } },
        data: { endedAt: at },
      });
    }
    const owned = leads.filter((l): l is { leadId: string; userId: string } => !!l.userId);
    if (owned.length === 0) return;
    const contactDueAt = nextCutoff(at, await loadHolidaySet(prisma));
    for (const part of chunks(owned)) {
      await prisma.crmLeadAssignment.createMany({
        data: part.map((l) => ({ leadId: l.leadId, userId: l.userId, assignedAt: at, contactDueAt })),
        skipDuplicates: true,
      });
    }
  } catch (err) {
    // The lead-cutoff cron's syncAssignments repairs whatever this missed.
    logger.warn("crm_contact_assignment_write_failed", {
      error: err instanceof Error ? err.message : String(err),
      leads: leads.length,
    });
  }
}

/** The safety net — see planAssignmentSync. */
export async function syncAssignments(now: Date = new Date()): Promise<{ opened: number; closed: number }> {
  const start = await leadReportStart();
  if (!start) return { opened: 0, closed: 0 };
  const floor = new Date(Math.max(start.getTime(), now.getTime() - SYNC_WINDOW_DAYS * DAY_MS));

  const [recentLeads, openRows] = await Promise.all([
    prisma.lead.findMany({
      where: { assignedToId: { not: null }, assignedAt: { gte: floor } },
      select: { id: true, assignedToId: true, assignedAt: true },
    }),
    prisma.crmLeadAssignment.findMany({
      where: { endedAt: null, assignedAt: { gte: floor } },
      select: {
        id: true,
        leadId: true,
        userId: true,
        assignedAt: true,
        endedAt: true,
        lead: { select: { assignedToId: true, assignedAt: true } },
      },
    }),
  ]);

  const leads = new Map<string, LeadOwnerState>();
  for (const l of recentLeads) leads.set(l.id, { assignedToId: l.assignedToId, assignedAt: l.assignedAt });
  for (const r of openRows) leads.set(r.leadId, r.lead);

  // Every row (open or closed) for the recently assigned leads, so an
  // assignment already recorded is never opened twice.
  const rows = new Map<string, AssignmentRowState>();
  for (const r of openRows) rows.set(r.id, r);
  for (const part of chunks(recentLeads.map((l) => l.id))) {
    const found = await prisma.crmLeadAssignment.findMany({
      where: { leadId: { in: part } },
      select: { id: true, leadId: true, userId: true, assignedAt: true, endedAt: true },
    });
    for (const r of found) rows.set(r.id, r);
  }

  const plan = planAssignmentSync(leads, [...rows.values()], floor, now);

  for (const c of plan.close) {
    await prisma.crmLeadAssignment.updateMany({ where: { id: c.id, endedAt: null }, data: { endedAt: c.endedAt } });
  }
  if (plan.open.length) {
    const holidays = await loadHolidaySet(prisma);
    for (const part of chunks(plan.open)) {
      await prisma.crmLeadAssignment.createMany({
        data: part.map((o) => ({ ...o, contactDueAt: nextCutoff(o.assignedAt, holidays) })),
        skipDuplicates: true,
      });
    }
  }
  return { opened: plan.open.length, closed: plan.close.length };
}

/**
 * Re-judge every assignment that can still change — pending ones, and misses
 * from the last {@link MISSED_RECHECK_DAYS} days — and store any new verdict.
 * Scope to one BDE with `userId` (My Day refreshes its own rows on open).
 * Returns how many rows changed.
 */
export async function evaluateAssignments(opts: { userId?: string; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const rows = await prisma.crmLeadAssignment.findMany({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      OR: [
        { contactStatus: "pending" },
        { contactStatus: "missed", assignedAt: { gte: new Date(now.getTime() - MISSED_RECHECK_DAYS * DAY_MS) } },
      ],
    },
    select: {
      id: true,
      leadId: true,
      userId: true,
      assignedAt: true,
      contactDueAt: true,
      endedAt: true,
      contactStatus: true,
      firstContactedAt: true,
    },
  });

  let changed = 0;
  for (const part of chunks(rows)) {
    const since = new Date(Math.min(...part.map((r) => r.assignedAt.getTime())));
    const activities = await prisma.leadActivity.findMany({
      where: {
        leadId: { in: [...new Set(part.map((r) => r.leadId))] },
        actorId: { in: [...new Set(part.map((r) => r.userId))] },
        type: { in: [...CONTACT_ACTIVITY_TYPES] },
        occurredAt: { gte: since },
      },
      select: { leadId: true, type: true, actorId: true, occurredAt: true, metadata: true },
    });
    const byLead = new Map<string, ContactEvent[]>();
    for (const a of activities) {
      const event = activityToContactEvent(a);
      if (!event) continue;
      const list = byLead.get(a.leadId);
      if (list) list.push(event);
      else byLead.set(a.leadId, [event]);
    }

    const updates = [];
    for (const r of part) {
      const v = evaluateContact(r, byLead.get(r.leadId) ?? [], now);
      const same =
        v.status === r.contactStatus &&
        (v.firstContactedAt?.getTime() ?? null) === (r.firstContactedAt?.getTime() ?? null);
      if (same) continue;
      updates.push(
        prisma.crmLeadAssignment.update({
          where: { id: r.id },
          data: { contactStatus: v.status, firstContactedAt: v.firstContactedAt },
        }),
      );
    }
    if (updates.length) await prisma.$transaction(updates);
    changed += updates.length;
  }
  return changed;
}
