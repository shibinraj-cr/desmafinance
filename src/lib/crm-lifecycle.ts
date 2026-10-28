/**
 * Lead lifecycle caps — the Sales SOP's anti-idle rules, enforced by a clock
 * instead of by memory:
 *
 *   - Follow-Up: a lead may stay with its consultant for {@link FOLLOW_UP_CAP_DAYS}
 *     days. From day {@link FOLLOW_UP_REVIEW_DAYS} it appears on the Marketing
 *     Admin's review list; an extension ({@link FOLLOW_UP_EXTENSION_DAYS} days,
 *     with a reason) keeps it with the consultant. Past the cap with no
 *     extension, it moves to the Centralised pool.
 *   - Re-marketing: a lead may rest there on its consultant's name for
 *     {@link REMARKETING_CAP_DAYS} days, then moves to the Centralised pool.
 *   - The Centralised pool is unassigned; a lead that leaves it with fresh
 *     interest goes to a DIFFERENT consultant (enforced in assignLeadTo).
 *
 * The clock is `Lead.stageEnteredAt`, stamped by a database trigger on every
 * stage change, so no write path can forget it. Each cap has its own switch and
 * both ship OFF: the first run would otherwise move the whole backlog at once,
 * so an admin previews the dry run on /crm/lifecycle and turns each cap on
 * deliberately. The Follow-Up clock additionally starts no earlier than the day
 * that cap was switched on — thousands of leads already sit in Follow-Up, and
 * they get a full 45 days from that moment rather than being swept on day one.
 *
 * Pure rules first (unit-tested, no prisma at module scope beyond the import),
 * then the sweep.
 */
import { prisma } from "./prisma";
import { getSetting, setSetting } from "./app-settings";
import { isCentralisedStatus } from "./crm-leads";
import { releaseLeads } from "./crm-assign";
import { REMARKETING_STATUS_CODE } from "./crm-reinquiry";
import { FOLLOW_UP_STATUS_CODE } from "./crm-remarketing";
import { recordLeadActivity } from "./crm-activity";

export const FOLLOW_UP_CAP_DAYS = 45;
/** Day the lead joins the Marketing Admin's review list, ahead of the cap. */
export const FOLLOW_UP_REVIEW_DAYS = 40;
export const FOLLOW_UP_EXTENSION_DAYS = 30;
export const REMARKETING_CAP_DAYS = 60;

/** AppSetting keys: "1" = on. */
export const LIFECYCLE_FOLLOW_UP_ENABLED_KEY = "crm_lifecycle_followup_cap_enabled";
export const LIFECYCLE_REMARKETING_ENABLED_KEY = "crm_lifecycle_remarketing_cap_enabled";
/** ISO time the Follow-Up cap was first switched on; the clock starts no earlier. */
export const LIFECYCLE_FOLLOW_UP_SINCE_KEY = "crm_lifecycle_followup_cap_since";

const DAY_MS = 86_400_000;
/** Leads moved per write — the same chunk the bulk stage change uses. */
const BATCH = 200;
/** Stop starting new batches past this so a large run ends cleanly inside 300s. */
const DEFAULT_BUDGET_MS = 240_000;
/** Rows a dry run returns for display; the counts are always exact. */
const PREVIEW_LIMIT = 200;

export type LifecycleRule = "followup_cap" | "remarketing_cap";

export type LifecycleConfig = {
  followUpEnabled: boolean;
  remarketingEnabled: boolean;
  /** When the Follow-Up cap was switched on (its clock starts no earlier). */
  followUpSince: Date | null;
};

export type LifecycleSubject = {
  statusCode: string;
  stageEnteredAt: Date | null;
  createdAt: Date;
  followUpExtendedUntil: Date | null;
};

// ── Pure rules ──────────────────────────────────────────────────────────────

/** Whole days elapsed since `since` (never negative). */
export function wholeDaysSince(now: Date, since: Date): number {
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS));
}

/**
 * When this lead's Follow-Up clock started: when it entered the stage, but no
 * earlier than the moment the cap was switched on.
 */
export function followUpClockStart(lead: LifecycleSubject, since: Date | null): Date {
  const entered = lead.stageEnteredAt ?? lead.createdAt;
  return since && since.getTime() > entered.getTime() ? since : entered;
}

/** The moment a Follow-Up lead must have moved on: cap from clock start, or the extension if later. */
export function followUpDeadline(lead: LifecycleSubject, since: Date | null): Date {
  const cap = new Date(followUpClockStart(lead, since).getTime() + FOLLOW_UP_CAP_DAYS * DAY_MS);
  const ext = lead.followUpExtendedUntil;
  return ext && ext.getTime() > cap.getTime() ? ext : cap;
}

/**
 * Which cap, if any, moves this lead to the central pool now. "More than N
 * days": day N itself is still inside the cap.
 */
export function lifecycleVerdict(
  lead: LifecycleSubject,
  cfg: LifecycleConfig,
  now: Date,
): { rule: LifecycleRule; daysInStage: number } | null {
  const entered = lead.stageEnteredAt ?? lead.createdAt;
  const daysInStage = wholeDaysSince(now, entered);
  if (lead.statusCode === REMARKETING_STATUS_CODE) {
    if (cfg.remarketingEnabled && daysInStage > REMARKETING_CAP_DAYS) return { rule: "remarketing_cap", daysInStage };
    return null;
  }
  if (lead.statusCode === FOLLOW_UP_STATUS_CODE) {
    if (cfg.followUpEnabled && now.getTime() > followUpDeadline(lead, cfg.followUpSince).getTime()) {
      return { rule: "followup_cap", daysInStage };
    }
  }
  return null;
}

/**
 * Is this Follow-Up lead on the Marketing Admin's review list — past the review
 * day, not yet past its deadline, and not already extended?
 */
export function needsFollowUpReview(lead: LifecycleSubject, cfg: LifecycleConfig, now: Date): boolean {
  if (!cfg.followUpEnabled || lead.statusCode !== FOLLOW_UP_STATUS_CODE) return false;
  if (lead.followUpExtendedUntil && lead.followUpExtendedUntil.getTime() > now.getTime()) return false;
  const start = followUpClockStart(lead, cfg.followUpSince);
  const reviewFrom = start.getTime() + FOLLOW_UP_REVIEW_DAYS * DAY_MS;
  return now.getTime() >= reviewFrom && now.getTime() <= followUpDeadline(lead, cfg.followUpSince).getTime();
}

/** New extension end: {@link FOLLOW_UP_EXTENSION_DAYS} past the later of now and the current deadline. */
export function extendedFollowUpUntil(lead: LifecycleSubject, since: Date | null, now: Date): Date {
  const deadline = followUpDeadline(lead, since);
  const base = deadline.getTime() > now.getTime() ? deadline : now;
  return new Date(base.getTime() + FOLLOW_UP_EXTENSION_DAYS * DAY_MS);
}

export function ruleLabel(rule: LifecycleRule): string {
  return rule === "followup_cap"
    ? `over ${FOLLOW_UP_CAP_DAYS} days in Follow-Up`
    : `over ${REMARKETING_CAP_DAYS} days in Re-marketing`;
}

// ── Config ──────────────────────────────────────────────────────────────────

export async function getLifecycleConfig(): Promise<LifecycleConfig> {
  const [fu, rm, since] = await Promise.all([
    getSetting(LIFECYCLE_FOLLOW_UP_ENABLED_KEY),
    getSetting(LIFECYCLE_REMARKETING_ENABLED_KEY),
    getSetting(LIFECYCLE_FOLLOW_UP_SINCE_KEY),
  ]);
  const sinceDate = since ? new Date(since) : null;
  return {
    followUpEnabled: fu === "1",
    remarketingEnabled: rm === "1",
    followUpSince: sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : null,
  };
}

/**
 * Switch the caps. Turning the Follow-Up cap on for the first time records the
 * moment, which is where every existing Follow-Up lead's clock starts; turning it
 * off and on again keeps the original moment, so a toggle can't reset anyone.
 */
export async function saveLifecycleConfig(
  input: { followUpEnabled: boolean; remarketingEnabled: boolean },
  userId: string,
): Promise<LifecycleConfig> {
  const current = await getLifecycleConfig();
  await setSetting(LIFECYCLE_FOLLOW_UP_ENABLED_KEY, input.followUpEnabled ? "1" : "0", userId);
  await setSetting(LIFECYCLE_REMARKETING_ENABLED_KEY, input.remarketingEnabled ? "1" : "0", userId);
  if (input.followUpEnabled && !current.followUpSince) {
    await setSetting(LIFECYCLE_FOLLOW_UP_SINCE_KEY, new Date().toISOString(), userId);
  }
  return getLifecycleConfig();
}

// ── Sweep ───────────────────────────────────────────────────────────────────

export type LifecycleLead = {
  id: string;
  candidateName: string;
  assignedToId: string | null;
  ownerName: string | null;
  stage: string;
  rule: LifecycleRule;
  daysInStage: number;
};

export type LifecycleReviewLead = {
  id: string;
  candidateName: string;
  ownerName: string | null;
  daysInStage: number;
  deadline: string;
};

export type LifecycleResult = {
  config: LifecycleConfig;
  dryRun: boolean;
  targetLabel?: string;
  /** Leads due to move now, per rule. */
  due: { followup_cap: number; remarketing_cap: number };
  moved: number;
  /** Consultants released (an already-unassigned lead isn't counted). */
  unassigned: number;
  campaignsStopped: number;
  /** Due leads left for the next run because the time budget ran out. */
  remaining: number;
  /** Follow-Up leads on the review list (day 40 → cap, not extended). */
  reviewCount: number;
  skipped?: string;
  /** Dry run only: the leads that would move, longest-waiting first. */
  preview?: LifecycleLead[];
  /** Dry run only: the review list, nearest deadline first. */
  review?: LifecycleReviewLead[];
};

const LEAD_SELECT = {
  id: true,
  candidateName: true,
  createdAt: true,
  stageEnteredAt: true,
  followUpExtendedUntil: true,
  assignedToId: true,
  assignedTo: { select: { username: true, leadPulseRole: { select: { displayName: true } } } },
} as const;

/**
 * Apply the caps. A dry run reports what would move (and the review list)
 * without writing anything; like a real run, a cap that is switched off moves
 * nothing. Pass `previewAsIfEnabled` with a dry run to see what switching both
 * caps on right now would do.
 *
 * Per lead, the same outcome as the bulk "Change stage" into the pool: the
 * consultant is released (owner, their open tasks and the WhatsApp thread), the
 * stage moves with a STATUS_CHANGED entry, and a running drip is stopped. On
 * purpose: the actor is the system unless a person ran it; `lastActivityAt` is
 * not bumped (a clock moving a lead is not anyone working it); release runs
 * before the stage write so a failure in between heals on the next run; and the
 * stage write is conditional on the stage this run read, so a lead a person
 * moved mid-run stays where they put it.
 */
export async function runLifecycleSweep(
  opts: {
    dryRun?: boolean;
    previewAsIfEnabled?: boolean;
    actorId?: string | null;
    budgetMs?: number;
    now?: Date;
  } = {},
): Promise<LifecycleResult> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const actorId = opts.actorId ?? null;
  const dryRun = !!opts.dryRun;
  const saved = await getLifecycleConfig();
  const config: LifecycleConfig =
    dryRun && opts.previewAsIfEnabled
      ? { followUpEnabled: true, remarketingEnabled: true, followUpSince: saved.followUpSince ?? now }
      : saved;

  const result: LifecycleResult = {
    config: saved,
    dryRun,
    due: { followup_cap: 0, remarketing_cap: 0 },
    moved: 0,
    unassigned: 0,
    campaignsStopped: 0,
    remaining: 0,
    reviewCount: 0,
  };

  const statuses = await prisma.crmLeadStatus.findMany({ select: { id: true, code: true, label: true, active: true } });
  const followUp = statuses.find((s) => s.code === FOLLOW_UP_STATUS_CODE);
  const remarketing = statuses.find((s) => s.code === REMARKETING_STATUS_CODE);
  const pools = statuses.filter((s) => s.active && isCentralisedStatus(s));
  // Refuse to guess: with no pool there is nowhere to move to, and with two the
  // sweep can't know which one marketing works from.
  if (pools.length !== 1) return { ...result, skipped: `expected one active Centralised stage, found ${pools.length}` };
  const target = pools[0];
  result.targetLabel = target.label;

  const watched = [followUp, remarketing].filter((s): s is NonNullable<typeof s> => !!s);
  if (watched.length === 0) return { ...result, skipped: "no Follow-Up or Re-marketing stage" };
  const codeById = new Map(watched.map((s) => [s.id, s.code]));
  const labelById = new Map(watched.map((s) => [s.id, s.label]));

  const leads = await prisma.lead.findMany({
    where: { statusId: { in: watched.map((s) => s.id) } },
    select: { ...LEAD_SELECT, statusId: true },
  });

  const ownerName = (l: (typeof leads)[number]) =>
    l.assignedTo?.leadPulseRole?.displayName ?? l.assignedTo?.username ?? null;
  const due: Array<LifecycleLead & { statusId: string }> = [];
  const review: LifecycleReviewLead[] = [];
  for (const l of leads) {
    const subject: LifecycleSubject = {
      statusCode: codeById.get(l.statusId) ?? "",
      stageEnteredAt: l.stageEnteredAt,
      createdAt: l.createdAt,
      followUpExtendedUntil: l.followUpExtendedUntil,
    };
    const v = lifecycleVerdict(subject, config, now);
    if (v) {
      due.push({
        id: l.id,
        statusId: l.statusId,
        candidateName: l.candidateName,
        assignedToId: l.assignedToId,
        ownerName: ownerName(l),
        stage: labelById.get(l.statusId) ?? "",
        rule: v.rule,
        daysInStage: v.daysInStage,
      });
      result.due[v.rule]++;
    } else if (needsFollowUpReview(subject, config, now)) {
      review.push({
        id: l.id,
        candidateName: l.candidateName,
        ownerName: ownerName(l),
        daysInStage: wholeDaysSince(now, l.stageEnteredAt ?? l.createdAt),
        deadline: followUpDeadline(subject, config.followUpSince).toISOString(),
      });
    }
  }
  due.sort((a, b) => b.daysInStage - a.daysInStage);
  review.sort((a, b) => a.deadline.localeCompare(b.deadline));
  result.reviewCount = review.length;

  if (dryRun) {
    return {
      ...result,
      remaining: due.length,
      preview: due.slice(0, PREVIEW_LIMIT).map(({ statusId: _s, ...rest }) => rest),
      review: review.slice(0, PREVIEW_LIMIT),
    };
  }

  const releasedByOwner = new Map<string, number>();
  for (let i = 0; i < due.length; i += BATCH) {
    if (Date.now() - started > budgetMs) {
      result.remaining = due.length - i;
      break;
    }
    const chunk = due.slice(i, i + BATCH);
    const byId = new Map(chunk.map((l) => [l.id, l]));

    // Re-read: a person may have moved or reassigned some since the scan.
    const fresh = await prisma.lead.findMany({
      where: { OR: watched.map((s) => ({ statusId: s.id, id: { in: chunk.filter((c) => c.statusId === s.id).map((c) => c.id) } })) },
      select: { id: true, assignedToId: true, statusId: true },
    });
    if (fresh.length === 0) continue;

    result.unassigned += await releaseLeads(fresh, actorId);
    for (const l of fresh) {
      if (l.assignedToId) releasedByOwner.set(l.assignedToId, (releasedByOwner.get(l.assignedToId) ?? 0) + 1);
    }

    const at = new Date();
    const moved = await prisma.$transaction(async (tx) => {
      const landed: string[] = [];
      for (const s of watched) {
        const ids = fresh.filter((l) => l.statusId === s.id).map((l) => l.id);
        if (ids.length === 0) continue;
        // Conditional on the stage read above — the lead's trigger restarts its
        // clock and clears any extension as the stage changes.
        await tx.lead.updateMany({
          where: { id: { in: ids }, statusId: s.id },
          data: { statusId: target.id, remarketingStartedAt: null },
        });
      }
      const now2 = await tx.lead.findMany({
        where: { id: { in: fresh.map((l) => l.id) }, statusId: target.id },
        select: { id: true },
      });
      for (const r of now2) landed.push(r.id);
      if (landed.length === 0) return { landed, stopped: 0 };

      const running = await tx.crmRemarketingCampaign.findMany({
        where: { leadId: { in: landed }, status: "running" },
        select: { leadId: true },
      });
      const runningLeads = Array.from(new Set(running.map((c) => c.leadId)));
      await tx.crmRemarketingCampaign.updateMany({
        where: { leadId: { in: landed }, status: "running" },
        data: { status: "stopped", endedReason: "left_stage", endedAt: at },
      });
      await tx.leadActivity.createMany({
        data: [
          ...runningLeads.map((leadId) => ({
            leadId,
            actorId,
            type: "REMARKETING_ENDED",
            summary: "Re-marketing campaign ended (left the stage)",
            metadata: { reason: "left_stage" },
            occurredAt: at,
          })),
          ...landed.map((leadId) => {
            const l = byId.get(leadId)!;
            return {
              leadId,
              actorId,
              type: "STATUS_CHANGED",
              summary: `Status changed: ${l.stage} → ${target.label} (${ruleLabel(l.rule)})`,
              metadata: {
                from: l.stage,
                to: target.label,
                bulk: true,
                source: "lifecycle",
                rule: l.rule,
                daysInStage: l.daysInStage,
              },
              occurredAt: at,
            };
          }),
        ],
      });
      return { landed, stopped: runningLeads.length };
    });
    result.moved += moved.landed.length;
    result.campaignsStopped += moved.stopped;
  }

  // One notification per released consultant, and one review digest for the
  // supervisors — best-effort; the moves have already committed.
  try {
    if (releasedByOwner.size > 0) {
      await prisma.crmNotification.createMany({
        data: Array.from(releasedByOwner, ([userId, n]) => ({
          userId,
          kind: "lifecycle_centralised",
          title: `${n} lead${n === 1 ? "" : "s"} moved to ${target.label}`,
          body: `${n === 1 ? "It" : "They"} passed the Follow-Up / Re-marketing time limit, so ${n === 1 ? "it has" : "they have"} moved to the central pool and ${n === 1 ? "is" : "are"} no longer assigned to you.`,
        })),
      });
    }
    if (review.length > 0) await notifyReviewDigest(review.length, now);
  } catch (e) {
    console.error("[crm-lifecycle] notifications failed:", e);
  }

  return result;
}

/** Once a day, tell each active Lead Pulse supervisor how many Follow-Up leads await an extension decision. */
async function notifyReviewDigest(count: number, now: Date): Promise<void> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const supervisors = await prisma.leadPulseRole.findMany({
    where: { role: "supervisor", active: true },
    select: { userId: true },
  });
  if (supervisors.length === 0) return;
  const already = await prisma.crmNotification.findMany({
    where: { kind: "lifecycle_review", createdAt: { gte: dayStart }, userId: { in: supervisors.map((s) => s.userId) } },
    select: { userId: true },
  });
  const done = new Set(already.map((n) => n.userId));
  const todo = supervisors.filter((s) => !done.has(s.userId));
  if (todo.length === 0) return;
  await prisma.crmNotification.createMany({
    data: todo.map((s) => ({
      userId: s.userId,
      kind: "lifecycle_review",
      title: `${count} Follow-Up lead${count === 1 ? "" : "s"} near the ${FOLLOW_UP_CAP_DAYS}-day limit`,
      body: `Extend the ones still being worked, or they move to the central pool. Review them on CRM → Lifecycle.`,
    })),
  });
}

/**
 * Grant a Follow-Up extension. Returns the new end. The caller checks the
 * permission (Marketing Admin / admin) and that a reason was given.
 */
export async function extendFollowUp(opts: { leadId: string; actorId: string; reason: string; now?: Date }): Promise<Date> {
  const now = opts.now ?? new Date();
  const [cfg, lead] = await Promise.all([
    getLifecycleConfig(),
    prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: {
        id: true,
        createdAt: true,
        stageEnteredAt: true,
        followUpExtendedUntil: true,
        status: { select: { code: true } },
      },
    }),
  ]);
  if (!lead) throw new Error("not_found");
  if (lead.status.code !== FOLLOW_UP_STATUS_CODE) throw new Error("not_in_follow_up");
  const until = extendedFollowUpUntil(
    {
      statusCode: lead.status.code,
      stageEnteredAt: lead.stageEnteredAt,
      createdAt: lead.createdAt,
      followUpExtendedUntil: lead.followUpExtendedUntil,
    },
    cfg.followUpSince ?? now,
    now,
  );
  await prisma.lead.update({ where: { id: lead.id }, data: { followUpExtendedUntil: until } });
  await recordLeadActivity({
    leadId: lead.id,
    actorId: opts.actorId,
    type: "FIELD_UPDATED",
    summary: `Follow-Up extended to ${until.toISOString().slice(0, 10)} — ${opts.reason}`,
    metadata: { field: "followUpExtendedUntil", until: until.toISOString(), reason: opts.reason },
  });
  return until;
}
