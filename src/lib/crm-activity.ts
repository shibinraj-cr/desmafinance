import { prisma } from "./prisma";

/**
 * The CRM activity taxonomy. Every lead state change writes one of these to
 * `LeadActivity`, which is the single source of truth for the per-lead
 * Timeline (everyone) and the admin History tab.
 */
export const CRM_ACTIVITY_TYPES = [
  "LEAD_CREATED",
  "LEAD_IMPORTED",
  "LEAD_OPENED",
  "STATUS_CHANGED",
  "FIELD_UPDATED",
  "ASSIGNED",
  "REASSIGNED",
  "UNASSIGNED",
  "RE_INQUIRY",
  "NOTE_ADDED",
  "NOTE_EDITED",
  "NOTE_DELETED",
  "EMAIL_SENT",
  "WHATSAPP_SENT",
  "CALL_LOGGED",
  "PARTY_LINKED",
  "TASK_CREATED",
  "TASK_COMPLETED",
  "TASK_REOPENED",
  "TASK_UPDATED",
  "TASK_DELETED",
  "DEAL_UPDATED",
  "ENROLLED",
  "REVENUE_DRAFTED",
  "OPS_PROJECT_CREATED",
  // Re-marketing nurturing campaign (src/lib/crm-remarketing.ts).
  "REMARKETING_STARTED",
  "REMARKETING_TOUCH_SENT",
  "REMARKETING_RESPONSE",
  "REMARKETING_ENDED",
] as const;

export type CrmActivityType = (typeof CRM_ACTIVITY_TYPES)[number];

// Passive events that should NOT bump `lastActivityAt` (would otherwise make a
// merely-viewed lead look freshly worked, defeating stale-lead sorting).
const NON_BUMPING_TYPES: ReadonlySet<CrmActivityType> = new Set<CrmActivityType>([
  "LEAD_OPENED",
]);

/**
 * Record one lead activity and (by default) bump `lead.lastActivityAt`.
 * Best-effort: wrapped in try/catch like `recordAudit` so a logging failure
 * never breaks the user's action. Fire-and-forget — returns `void`.
 */
export async function recordLeadActivity(opts: {
  leadId: string;
  actorId?: string | null;
  type: CrmActivityType;
  summary?: string | null;
  metadata?: unknown;
  /** Override the default lastActivityAt bump (defaults to true except for passive types). */
  bumpLastActivity?: boolean;
}): Promise<void> {
  try {
    const bump = opts.bumpLastActivity ?? !NON_BUMPING_TYPES.has(opts.type);
    await prisma.$transaction(async (tx) => {
      await tx.leadActivity.create({
        data: {
          leadId: opts.leadId,
          actorId: opts.actorId ?? null,
          type: opts.type,
          summary: opts.summary ?? null,
          metadata: opts.metadata ? (opts.metadata as object) : undefined,
        },
      });
      if (bump) {
        await tx.lead.update({
          where: { id: opts.leadId },
          data: { lastActivityAt: new Date() },
        });
      }
    });
  } catch (e) {
    console.error("[crm-activity] failed to record activity:", e);
  }
}

/**
 * Record a LEAD_OPENED activity at most once per (user, lead, calendar day) to
 * avoid flooding the History with page reloads. Does not bump lastActivityAt.
 */
export async function recordLeadOpenedOncePerDay(
  leadId: string,
  actorId: string,
): Promise<void> {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const existing = await prisma.leadActivity.findFirst({
      where: {
        leadId,
        actorId,
        type: "LEAD_OPENED",
        occurredAt: { gte: startOfDay },
      },
      select: { id: true },
    });
    if (existing) return;
    await recordLeadActivity({
      leadId,
      actorId,
      type: "LEAD_OPENED",
      summary: "Opened the lead",
      bumpLastActivity: false,
    });
  } catch (e) {
    console.error("[crm-activity] failed to record open:", e);
  }
}
