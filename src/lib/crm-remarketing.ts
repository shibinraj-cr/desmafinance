/**
 * Re-marketing nurturing engine.
 *
 * When a lead enters the Re-marketing stage a campaign opens (CrmRemarketingCampaign)
 * and a fixed sequence of three WhatsApp touch-points is sent through Wabis on a
 * calendar schedule — by default day 5 / 19 / 33 from the stage change, tunable
 * via the `wabis_remarketing_offsets` AppSetting.
 *
 * The touches themselves ride the SAME transactional outbox as the lead-assignment
 * intro (CrmWebhookDelivery, event `remarketing_touch` — see src/lib/crm-webhook.ts):
 * this module only decides *which* touch is due and enqueues it; delivery + retry
 * are the outbox's job. A single global Wabis Webhook-Workflow URL receives every
 * touch with a `touch` field (1|2|3) so one flow can branch to the right approved
 * template. Routing is global rather than per-consultant because re-engagement is
 * driven back through our own inbound endpoint, not a per-agent Wabis inbox.
 *
 * A campaign ends one of three ways:
 *   - `responded` — the candidate replied inside Wabis (a keyword-reply flow hit
 *     handleRemarketingReply); the lead auto-advances to Follow-Up.
 *   - `completed` — all touches sent, the window elapsed, no response. The lead
 *     STAYS in Re-marketing; the Follow-Up centralisation sweep (built later)
 *     reads status `completed` + endedReason `no_response` to pull it central.
 *   - `stopped` — the lead left Re-marketing by some other path.
 *
 * Every DB helper here is best-effort (try/catch, never throws) like
 * recordLeadActivity — a nurturing failure must never break the user action or
 * the cron that triggered it.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { normalizePhone } from "./crm";
import {
  getSetting,
  WABIS_REMARKETING_ENABLED_KEY,
  WABIS_REMARKETING_URLS_KEY,
  WABIS_REMARKETING_OFFSETS_KEY,
  WABIS_REMARKETING_KEYWORDS_KEY,
} from "./app-settings";
import {
  REMARKETING_TOUCH_EVENT,
  TEST_EVENT,
  toWabisPhone,
  resolveAgent,
  istTimestamp,
  isWabisWebhookUrl,
  attemptDelivery,
  getWabisWebhookConfig,
  postWebhook,
} from "./crm-webhook";
import { recordLeadActivity } from "./crm-activity";
import { REMARKETING_STATUS_CODE } from "./crm-reinquiry";

/** The Follow-Up stage a responding lead advances to. */
export const FOLLOW_UP_STATUS_CODE = "follow_up";
/** Touch-point offsets (calendar days from stage entry) when none are configured. */
const DEFAULT_OFFSETS = [5, 19, 33, 45] as const;
/** Fixed number of touch-points (matches the four timestamp columns). */
const TOTAL_TOUCHES = 4;
/** Days after the final touch before a silent campaign is deemed complete. */
const COMPLETION_GRACE_DAYS = 7;

// ── Config ──────────────────────────────────────────────────────────────────

export type RemarketingConfig = {
  enabled: boolean;
  /**
   * One Wabis workflow callback URL PER TOUCH (positional: urls[0] = touch 1).
   * Wabis workflows are single-template, so the routing lives here, not in Wabis.
   */
  urls: string[];
  /** Calendar-day offsets from stage entry, ascending, ≤ 4 entries. */
  offsets: number[];
  /** Positive-intent reply keywords (lowercased). Empty = advance on any reply. */
  keywords: string[];
};

export async function getRemarketingConfig(): Promise<RemarketingConfig> {
  const [enabled, urls, offsets, keywords] = await Promise.all([
    getSetting(WABIS_REMARKETING_ENABLED_KEY).catch(() => null),
    getSetting(WABIS_REMARKETING_URLS_KEY).catch(() => null),
    getSetting(WABIS_REMARKETING_OFFSETS_KEY).catch(() => null),
    getSetting(WABIS_REMARKETING_KEYWORDS_KEY).catch(() => null),
  ]);
  return {
    enabled: enabled === "1",
    urls: parseUrls(urls),
    offsets: parseOffsets(offsets),
    keywords: parseKeywords(keywords),
  };
}

/**
 * Newline-separated, positional touch URLs — line i (1-based) is touch i's Wabis
 * workflow URL. Preserves interior blanks (position = touch), drops trailing ones.
 */
export function parseUrls(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const lines = raw.split("\n").map((s) => s.trim());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

/** The Wabis workflow URL for a given 1-based touch, or null if unset/invalid. */
function urlForTouch(config: RemarketingConfig, touch: number): string | null {
  const u = config.urls[touch - 1]?.trim();
  return u && isWabisWebhookUrl(u) ? u : null;
}

// ── Pure helpers (unit-tested; no I/O) ──────────────────────────────────────

/**
 * Parse the offsets setting ("5,19,33") into ascending, de-duplicated, non-negative
 * day counts, capped at three. Falls back to the default on anything unusable, so a
 * fat-fingered setting can never silently disable the schedule.
 */
export function parseOffsets(raw: string | null | undefined): number[] {
  if (!raw) return [...DEFAULT_OFFSETS];
  const nums = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const cleaned = Array.from(new Set(nums)).sort((a, b) => a - b).slice(0, TOTAL_TOUCHES);
  return cleaned.length ? cleaned : [...DEFAULT_OFFSETS];
}

/** Parse the keyword allow-list ("interested, yes") into lowercased, trimmed terms. */
export function parseKeywords(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Whole calendar days between two instants (≥ 0; 0 when `to` precedes `from`). */
export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

/**
 * The 1-based index of the earliest un-sent touch whose offset has arrived, or
 * null when nothing is due. Earliest-first (one per run) so a campaign that fell
 * behind catches up one touch per day rather than firing the backlog at once.
 */
export function dueTouchIndex(input: {
  startedAt: Date;
  now: Date;
  offsets: number[];
  sent: readonly boolean[];
}): number | null {
  const elapsed = daysBetween(input.startedAt, input.now);
  const n = Math.min(input.offsets.length, TOTAL_TOUCHES);
  for (let i = 0; i < n; i++) {
    if (!input.sent[i] && elapsed >= input.offsets[i]) return i + 1;
  }
  return null;
}

/** All configured touches sent AND the grace window past the last one elapsed. */
export function isCampaignExpired(input: {
  startedAt: Date;
  now: Date;
  offsets: number[];
  sent: readonly boolean[];
}): boolean {
  const n = Math.min(input.offsets.length, TOTAL_TOUCHES);
  if (n === 0) return false;
  for (let i = 0; i < n; i++) if (!input.sent[i]) return false;
  const lastOffset = input.offsets[n - 1] ?? 0;
  return daysBetween(input.startedAt, input.now) >= lastOffset + COMPLETION_GRACE_DAYS;
}

/**
 * Does a candidate's reply count as re-engagement? With no keywords configured,
 * any reply advances. With keywords, the reply must contain one (case-insensitive
 * substring) — the guard against a "STOP" / "not interested" reviving a lead.
 */
export function matchesReengageKeyword(text: string | null | undefined, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return false;
  return keywords.some((k) => t.includes(k));
}

// ── Campaign lifecycle ──────────────────────────────────────────────────────

/**
 * Open a nurturing campaign for a lead that just entered Re-marketing. Idempotent:
 * a lead already running a campaign is left alone (so re-saving the stage doesn't
 * restart the drip). Stamps `remarketingStartedAt` — the schedule counts from here.
 */
export async function openRemarketingCampaign(opts: {
  leadId: string;
  actorId?: string | null;
}): Promise<void> {
  try {
    const running = await prisma.crmRemarketingCampaign.findFirst({
      where: { leadId: opts.leadId, status: "running" },
      select: { id: true },
    });
    if (running) return;

    const lead = await prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: { assignedToId: true },
    });
    if (!lead) return;

    const now = new Date();
    await prisma.$transaction([
      prisma.crmRemarketingCampaign.create({
        data: {
          leadId: opts.leadId,
          ownerUserId: lead.assignedToId,
          startedAt: now,
          status: "running",
        },
      }),
      prisma.lead.update({
        where: { id: opts.leadId },
        data: { remarketingStartedAt: now },
      }),
    ]);

    await recordLeadActivity({
      leadId: opts.leadId,
      actorId: opts.actorId ?? null,
      type: "REMARKETING_STARTED",
      summary: "Re-marketing campaign started",
      metadata: { startedAt: now.toISOString() },
    });
  } catch (e) {
    console.error("[crm-remarketing] openRemarketingCampaign failed:", e);
  }
}

/**
 * Close any running campaign(s) for a lead that has left Re-marketing by a path
 * other than a candidate reply — a manual stage change, an admin move. Clears the
 * `remarketingStartedAt` stamp either way.
 */
export async function stopRemarketingCampaigns(opts: {
  leadId: string;
  reason?: string;
  actorId?: string | null;
}): Promise<void> {
  try {
    const now = new Date();
    const closed = await prisma.crmRemarketingCampaign.updateMany({
      where: { leadId: opts.leadId, status: "running" },
      data: { status: "stopped", endedReason: opts.reason ?? "left_stage", endedAt: now },
    });
    await prisma.lead
      .update({ where: { id: opts.leadId }, data: { remarketingStartedAt: null } })
      .catch(() => undefined);
    if (closed.count > 0) {
      await recordLeadActivity({
        leadId: opts.leadId,
        actorId: opts.actorId ?? null,
        type: "REMARKETING_ENDED",
        summary: "Re-marketing campaign ended (left the stage)",
        metadata: { reason: opts.reason ?? "left_stage" },
      });
    }
  } catch (e) {
    console.error("[crm-remarketing] stopRemarketingCampaigns failed:", e);
  }
}

// ── Outbound touch delivery ─────────────────────────────────────────────────

type SchedulerLead = {
  id: string;
  candidateName: string;
  phone: string | null;
  email: string | null;
  assignedToId: string | null;
  source: { label: string } | null;
  service: { name: string } | null;
};

/**
 * Enqueue one touch through the shared outbox and attempt it inline. Returns true
 * when the touch is "handled" (queued, already queued, or a permanent skip that
 * shouldn't be retried tomorrow) — i.e. whether the caller should stamp the touch
 * as sent. Returns false only for a transient reason to try again next run
 * (missing/invalid URL).
 */
async function enqueueRemarketingTouch(opts: {
  campaignId: string;
  lead: SchedulerLead;
  touchIndex: number;
  config: RemarketingConfig;
  now: Date;
}): Promise<boolean> {
  const { lead, touchIndex, config } = opts;
  const dedupeKey = `${REMARKETING_TOUCH_EVENT}:${opts.campaignId}:${touchIndex}`;

  const url = urlForTouch(config, touchIndex);
  if (!url) {
    // No valid workflow URL for this touch — leave it for a future run once an
    // admin sets it, rather than burning the touch. Not stamped.
    console.warn(`[crm-remarketing] no valid workflow URL for touch ${touchIndex}; deferred`);
    return false;
  }

  const phone = toWabisPhone(lead.phone);
  if (!phone) {
    // Wabis keys the subscriber on the number — nothing to send. Record it as a
    // skipped delivery so it shows in the log, and stamp it (a phoneless lead must
    // not be re-attempted every day forever).
    await prisma.crmWebhookDelivery
      .create({
        data: {
          event: REMARKETING_TOUCH_EVENT,
          dedupeKey,
          leadId: lead.id,
          assigneeUserId: lead.assignedToId,
          url,
          endpointLabel: `Re-marketing touch ${touchIndex}`,
          payload: {},
          status: "failed",
          attempts: 0,
          maxAttempts: 0,
          responseBody: "Not sent — the lead has no phone number Wabis can use as a subscriber.",
        },
      })
      .catch(() => undefined);
    return true;
  }

  const role = lead.assignedToId
    ? await prisma.leadPulseRole.findUnique({
        where: { userId: lead.assignedToId },
        select: { displayName: true, phone: true },
      })
    : null;
  const { agent, agentPhone } = resolveAgent({
    displayName: role?.displayName,
    phone: role?.phone,
    endpoint: null,
  });

  const payload = {
    name: (lead.candidateName ?? "").trim(),
    phone,
    email: (lead.email ?? "").trim(),
    agent,
    agent_phone: agentPhone,
    consultant: agent,
    source: (lead.source?.label ?? "").trim(),
    service: (lead.service?.name ?? "").trim(),
    lead_id: lead.id,
    campaign_id: opts.campaignId,
    // The field a single Wabis flow branches on to pick template 1/2/3.
    touch: touchIndex,
    touch_label: `Touch ${touchIndex}`,
    sent_at: istTimestamp(opts.now),
  };

  try {
    const created = await prisma.crmWebhookDelivery.create({
      data: {
        event: REMARKETING_TOUCH_EVENT,
        dedupeKey,
        leadId: lead.id,
        assigneeUserId: lead.assignedToId,
        url,
        endpointLabel: `Re-marketing touch ${touchIndex}`,
        payload,
      },
      select: { id: true },
    });
    await attemptDelivery(created.id);
    return true;
  } catch (e) {
    // Almost always the unique-constraint on dedupeKey: a prior run already queued
    // this touch. Treat as handled so it's stamped and we move on.
    const exists = await prisma.crmWebhookDelivery
      .findUnique({ where: { dedupeKey }, select: { id: true } })
      .catch(() => null);
    if (exists) return true;
    console.error("[crm-remarketing] enqueueRemarketingTouch failed:", e);
    return false;
  }
}

// ── Daily scheduler (driven by /api/cron/crm-webhooks) ──────────────────────

/**
 * Advance every running campaign by one calendar day: send the earliest due touch,
 * or complete a campaign whose window has elapsed in silence. Called from the
 * daily webhooks cron before the outbox drain. Best-effort per campaign — one bad
 * row never stops the rest.
 */
export async function runRemarketingScheduler(): Promise<{
  touchesSent: number;
  completed: number;
  stopped: number;
  skipped?: string;
}> {
  const config = await getRemarketingConfig();
  if (!config.enabled) return { touchesSent: 0, completed: 0, stopped: 0, skipped: "remarketing disabled" };

  const now = new Date();
  const campaigns = await prisma.crmRemarketingCampaign.findMany({
    where: { status: "running" },
    select: {
      id: true,
      leadId: true,
      startedAt: true,
      touch1SentAt: true,
      touch2SentAt: true,
      touch3SentAt: true,
      touch4SentAt: true,
      lead: {
        select: {
          id: true,
          candidateName: true,
          phone: true,
          email: true,
          assignedToId: true,
          status: { select: { code: true } },
          source: { select: { label: true } },
          service: { select: { name: true } },
        },
      },
    },
  });

  let touchesSent = 0;
  let completed = 0;
  let stopped = 0;

  for (const c of campaigns) {
    try {
      // The lead left Re-marketing without closing the campaign (e.g. a path we
      // don't hook yet). Close it rather than keep messaging.
      if (c.lead.status.code !== REMARKETING_STATUS_CODE) {
        await prisma.crmRemarketingCampaign.update({
          where: { id: c.id },
          data: { status: "stopped", endedReason: "left_stage", endedAt: now },
        });
        stopped++;
        continue;
      }

      const sent = [!!c.touch1SentAt, !!c.touch2SentAt, !!c.touch3SentAt, !!c.touch4SentAt] as const;
      const due = dueTouchIndex({ startedAt: c.startedAt, now, offsets: config.offsets, sent });

      if (due) {
        const handled = await enqueueRemarketingTouch({
          campaignId: c.id,
          lead: c.lead,
          touchIndex: due,
          config,
          now,
        });
        if (handled) {
          touchesSent++;
          await prisma.crmRemarketingCampaign.update({
            where: { id: c.id },
            // Explicit per-touch field (not a computed key) so it satisfies the
            // typed update input.
            data:
              due === 1
                ? { touch1SentAt: now }
                : due === 2
                  ? { touch2SentAt: now }
                  : due === 3
                    ? { touch3SentAt: now }
                    : { touch4SentAt: now },
          });
          await recordLeadActivity({
            leadId: c.leadId,
            type: "REMARKETING_TOUCH_SENT",
            summary: `Re-marketing touch ${due} sent`,
            metadata: { touch: due },
          });
        }
        continue; // at most one touch per campaign per run
      }

      if (isCampaignExpired({ startedAt: c.startedAt, now, offsets: config.offsets, sent })) {
        await prisma.crmRemarketingCampaign.update({
          where: { id: c.id },
          data: { status: "completed", endedReason: "no_response", endedAt: now },
        });
        completed++;
        await recordLeadActivity({
          leadId: c.leadId,
          type: "REMARKETING_ENDED",
          summary: "Re-marketing campaign completed — no response",
          metadata: { reason: "no_response" },
        });
        // The lead deliberately stays in Re-marketing; the Follow-Up
        // centralisation sweep reads this state to move it to Centralised.
      }
    } catch (e) {
      console.error(`[crm-remarketing] campaign ${c.id} scheduler error:`, e);
    }
  }

  return { touchesSent, completed, stopped };
}

// ── Inbound reply (Wabis keyword flow → auto-advance) ───────────────────────

const REPLY_LEAD_SELECT = {
  id: true,
  candidateName: true,
  assignedToId: true,
  status: { select: { code: true, label: true } },
} as const;

export type RemarketingReplyResult =
  | { ok: true; action: "advanced"; leadId: string }
  | { ok: true; action: "ignored"; reason: string; leadId?: string }
  | { ok: false; reason: string };

/**
 * Handle a candidate reply relayed by a Wabis keyword-reply flow. Resolves the
 * lead (by echoed lead_id, else by phone among running-campaign leads), and — if
 * it is in Re-marketing and the reply clears the keyword gate — auto-advances it
 * to Follow-Up as a system action and closes the campaign `responded`. The reply
 * is logged either way, so a non-matching reply is still visible on the timeline.
 */
export async function handleRemarketingReply(input: {
  leadId?: string | null;
  phone?: string | null;
  text?: string | null;
}): Promise<RemarketingReplyResult> {
  const config = await getRemarketingConfig();

  let lead: {
    id: string;
    candidateName: string;
    assignedToId: string | null;
    status: { code: string; label: string };
  } | null = null;

  if (input.leadId) {
    lead = await prisma.lead.findUnique({ where: { id: input.leadId }, select: REPLY_LEAD_SELECT });
  }
  if (!lead && input.phone) {
    const e164 = normalizePhone(input.phone);
    if (e164) {
      lead = await prisma.lead.findFirst({
        where: { phoneE164: e164, status: { code: REMARKETING_STATUS_CODE } },
        orderBy: { remarketingStartedAt: "desc" },
        select: REPLY_LEAD_SELECT,
      });
    }
  }
  if (!lead) return { ok: false, reason: "lead_not_found" };
  const found = lead;

  if (found.status.code !== REMARKETING_STATUS_CODE) {
    return { ok: true, action: "ignored", reason: "not_in_remarketing", leadId: found.id };
  }

  const campaign = await prisma.crmRemarketingCampaign.findFirst({
    where: { leadId: found.id, status: "running" },
    select: { id: true },
  });

  const advance = matchesReengageKeyword(input.text, config.keywords);
  await recordLeadActivity({
    leadId: found.id,
    type: "REMARKETING_RESPONSE",
    summary: advance
      ? "Candidate replied in Wabis — advancing to Follow-Up"
      : "Candidate replied in Wabis (no matching intent keyword)",
    metadata: { text: (input.text ?? "").slice(0, 500), matched: advance, keywords: config.keywords },
  });

  if (!advance) {
    return { ok: true, action: "ignored", reason: "no_keyword_match", leadId: found.id };
  }

  const followUp = await prisma.crmLeadStatus.findUnique({
    where: { code: FOLLOW_UP_STATUS_CODE },
    select: { id: true, label: true },
  });
  if (!followUp) return { ok: false, reason: "follow_up_status_missing" };

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: found.id },
      data: { statusId: followUp.id, remarketingStartedAt: null },
    });
    if (campaign) {
      await tx.crmRemarketingCampaign.update({
        where: { id: campaign.id },
        data: { status: "responded", endedReason: "responded_in_wabis", endedAt: now },
      });
    }
  });

  await recordLeadActivity({
    leadId: found.id,
    type: "STATUS_CHANGED",
    summary: `Status changed: ${found.status.label} → ${followUp.label}`,
    metadata: { from: found.status.label, to: followUp.label, via: "wabis_reply" },
  });

  if (found.assignedToId) await notifyRemarketingResponse(found.assignedToId, found.id, found.candidateName);

  return { ok: true, action: "advanced", leadId: found.id };
}

/** Tell the owning consultant their re-marketing lead replied and is live again. */
async function notifyRemarketingResponse(
  userId: string,
  leadId: string,
  candidateName: string,
): Promise<void> {
  try {
    await prisma.crmNotification.create({
      data: {
        userId,
        kind: "remarketing_response",
        title: "Re-marketing lead replied",
        body: `${candidateName || "A candidate"} replied to your re-marketing campaign and is back in Follow-Up.`,
        linkUrl: `/crm/leads/${leadId}`,
        leadId,
      },
    });
  } catch (e) {
    console.error("[crm-remarketing] notifyRemarketingResponse failed:", e);
  }
}

// ── Test send (admin "Send test touch") ─────────────────────────────────────

/**
 * POST a sample re-marketing touch to the configured workflow URL, with no real
 * lead or campaign. Two jobs: prove the CRM → Wabis pipeline end-to-end, and give
 * Wabis a sample payload so its "Send Template Message" step can bind our field
 * names for mapping. Logged like any delivery (unique dedupe key) so it can never
 * collide with — or suppress — a real touch.
 */
export async function sendTestRemarketingTouch(opts: {
  phone: string;
  touch?: number;
}): Promise<{ ok: boolean; status: number | null; body: string; error?: string }> {
  const config = await getRemarketingConfig();
  const touch = opts.touch && opts.touch >= 1 && opts.touch <= 4 ? opts.touch : 1;
  const url = urlForTouch(config, touch);
  if (!url) {
    return { ok: false, status: null, body: "", error: `Set a valid workflow URL for touch ${touch} and save it first.` };
  }
  const phone = toWabisPhone(opts.phone);
  if (!phone) {
    return { ok: false, status: null, body: "", error: "Enter a valid mobile number to send the test to." };
  }
  const now = new Date();
  const payload = {
    name: "Test Candidate",
    phone,
    email: "test@example.com",
    agent: "Test Agent",
    agent_phone: "+910000000000",
    consultant: "Test Agent",
    source: "Test",
    service: "",
    lead_id: "test-lead",
    campaign_id: "test-campaign",
    touch,
    touch_label: `Touch ${touch}`,
    sent_at: istTimestamp(now),
  };

  const wabis = await getWabisWebhookConfig();
  const result = await postWebhook(url, payload, wabis.secret);

  await prisma.crmWebhookDelivery
    .create({
      data: {
        event: TEST_EVENT,
        // Unique per test send — never occupies a real touch's key.
        dedupeKey: `${TEST_EVENT}:remarketing:${randomUUID()}`,
        url,
        endpointLabel: `Re-marketing touch ${touch} (test)`,
        payload,
        status: result.ok ? "sent" : "failed",
        attempts: 1,
        maxAttempts: 1,
        lastAttemptAt: now,
        deliveredAt: result.ok ? now : null,
        responseStatus: result.status,
        responseBody: result.body,
      },
    })
    .catch(() => undefined);

  return result;
}
