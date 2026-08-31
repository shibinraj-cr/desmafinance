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
  REMARKETING_TRANSPORT_KEY,
  REMARKETING_TEMPLATES_KEY,
  REMARKETING_TEMPLATE_PARAMS_KEY,
} from "./app-settings";
import {
  REMARKETING_TOUCH_EVENT,
  TEST_EVENT,
  LEAD_ASSIGNED_EVENT,
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
import {
  buildTouchParams,
  parseTouchParams,
  parseTouchTemplates,
  parseTransport,
  type TouchTemplate,
} from "./crm-remarketing-templates";
import { cloudProvider } from "./wa/cloud-provider";
import { findOrCreateConversationForLead } from "./wa/mirror";

/** The Follow-Up stage a responding lead advances to. */
export const FOLLOW_UP_STATUS_CODE = "follow_up";
/** Touch-point offsets (calendar days from stage entry) when none are configured. */
const DEFAULT_OFFSETS = [5, 19, 33, 45] as const;
/** Fixed number of touch-points (matches the four timestamp columns). */
const TOTAL_TOUCHES = 4;
/** Days after the final touch before a silent campaign is deemed complete. */
const COMPLETION_GRACE_DAYS = 7;
/**
 * Max touch-points enqueued in ONE scheduler run. Each send is an inline Wabis
 * POST, so a large backlog (e.g. after a bulk enrolment) would otherwise blast
 * Meta's per-user cap all at once. Capping drains it over several runs — the daily
 * cron and each manual "Run now" click send up to this many; undelivered rows are
 * retried by the outbox drain. A wall-clock guard (RUN_TIME_BUDGET_MS) stops the
 * run before the platform's 60s function limit even if the count isn't reached, so
 * a high cap can never time the function out mid-send.
 */
const MAX_TOUCHES_PER_RUN = 600;
/** Stop sending once this much wall-clock has elapsed in a run, leaving headroom
 * under the 60s function limit for the response + the follow-on outbox drain. */
const RUN_TIME_BUDGET_MS = 45_000;
/** How many touches to POST to Wabis at once. Each POST is ~1-2s, so sending
 * sequentially drains only ~25 in the time budget; firing a batch concurrently
 * lifts that to the low hundreds. Kept modest so we don't stampede Wabis/Meta. */
const SEND_CONCURRENCY = 20;
/**
 * Meta error codes that mark a number PERMANENTLY undeliverable (bad number / not
 * on WhatsApp) — these flag the lead so a future campaign also skips it. Transient
 * codes (e.g. 131049, the marketing frequency cap) still STOP the current campaign
 * under the "any hard failure" policy, but do not permanently flag the lead.
 */
const PERMANENT_UNDELIVERABLE_CODES: ReadonlySet<string> = new Set(["131026", "131000", "131047"]);

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
  /**
   * Which transport carries a touch. Its own switch, separate from the inbox's
   * `wa_provider`: the inbox cut over to the Cloud API long before the drip
   * could, and either must be reversible without dragging the other back.
   */
  transport: "wabis" | "cloud";
  /** Approved template per touch, positional. Cloud transport only. */
  templates: (TouchTemplate | null)[];
  /** Field tokens filling that template's variables, positional. */
  templateParams: string[][];
};

export async function getRemarketingConfig(): Promise<RemarketingConfig> {
  const [enabled, urls, offsets, keywords, transport, templates, templateParams] = await Promise.all([
    getSetting(WABIS_REMARKETING_ENABLED_KEY).catch(() => null),
    getSetting(WABIS_REMARKETING_URLS_KEY).catch(() => null),
    getSetting(WABIS_REMARKETING_OFFSETS_KEY).catch(() => null),
    getSetting(WABIS_REMARKETING_KEYWORDS_KEY).catch(() => null),
    getSetting(REMARKETING_TRANSPORT_KEY).catch(() => null),
    getSetting(REMARKETING_TEMPLATES_KEY).catch(() => null),
    getSetting(REMARKETING_TEMPLATE_PARAMS_KEY).catch(() => null),
  ]);
  return {
    enabled: enabled === "1",
    urls: parseUrls(urls),
    offsets: parseOffsets(offsets),
    keywords: parseKeywords(keywords),
    transport: parseTransport(transport),
    templates: parseTouchTemplates(templates),
    templateParams: parseTouchParams(templateParams),
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
      select: { assignedToId: true, whatsappUndeliverableAt: true, whatsappUndeliverableReason: true },
    });
    if (!lead) return;

    // A number a prior touch found undeliverable (Meta 131026) must not start a
    // fresh drip — Wabis has nowhere to deliver it. Record why, don't open.
    if (lead.whatsappUndeliverableAt) {
      await recordLeadActivity({
        leadId: opts.leadId,
        actorId: opts.actorId ?? null,
        type: "REMARKETING_STARTED",
        summary: `Re-marketing not started — number flagged undeliverable${lead.whatsappUndeliverableReason ? ` (${lead.whatsappUndeliverableReason})` : ""}`,
        metadata: { skipped: "undeliverable", reason: lead.whatsappUndeliverableReason ?? null },
      });
      return;
    }

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
/**
 * How many `{{n}}` values each configured template wants.
 *
 * Fetched ONCE per scheduler run and passed down, because a run may send several
 * hundred touches and asking Meta for the catalogue per lead would spend the
 * whole time budget on the same answer. Empty on the Wabis transport, which never
 * needs it, and empty on a failed fetch — a template whose variable count we
 * could not learn is reported as unmapped rather than sent with a guess.
 */
async function loadTemplateVariableCounts(config: RemarketingConfig): Promise<Map<string, number> | null> {
  const map = new Map<string, number>();
  if (config.transport !== "cloud") return map;
  const wanted = new Set(config.templates.filter(Boolean).map((t) => `${t!.name}:${t!.language}`));
  if (wanted.size === 0) return map;

  const catalogue = await cloudProvider.listTemplates().catch(() => []);
  // NULL means "we could not ask", which is not the same as "the template has no
  // variables" — and conflating the two would send a parameter-less template and
  // then mark the touch done. listTemplates swallows every failure into an empty
  // array, so an empty catalogue is the signal.
  if (catalogue.length === 0) return null;

  for (const t of catalogue) {
    const key = `${t.name}:${t.language}`;
    if (wanted.has(key)) map.set(key, t.variableCount);
  }
  return map;
}

async function enqueueRemarketingTouch(opts: {
  campaignId: string;
  lead: SchedulerLead;
  /** Owner when the campaign opened — used to name/assign the agent when the lead
   * has since been unassigned (e.g. a centralised-pool lead). */
  ownerUserId?: string | null;
  touchIndex: number;
  config: RemarketingConfig;
  now: Date;
  /** Cloud transport only. NULL when the catalogue could not be read. */
  templateVars?: Map<string, number> | null;
}): Promise<boolean> {
  const { lead, touchIndex, config } = opts;

  // The whole cutover, in one branch. Everything below this line is the Wabis
  // path, left exactly as it was, so flipping the switch back is a configuration
  // change rather than a deploy.
  if (config.transport === "cloud") return sendCloudTouch(opts);

  // The agent to name in the message AND for Wabis to assign the chat to: the
  // lead's current owner, else the owner recorded on the campaign.
  const ownerId = lead.assignedToId ?? opts.ownerUserId ?? null;
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
          assigneeUserId: ownerId,
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

  // Resolve the owning agent's identity the SAME way the lead-assignment intro
  // does: prefer the per-consultant Wabis endpoint's agentName/agentPhone (the
  // name Wabis actually knows the agent by — so its "assign agent" step matches),
  // falling back to the consultant's Lead Pulse displayName/phone.
  const [role, endpoint] = ownerId
    ? await Promise.all([
        prisma.leadPulseRole.findUnique({
          where: { userId: ownerId },
          select: { displayName: true, phone: true },
        }),
        prisma.wabisWebhookEndpoint.findFirst({
          where: { consultantId: ownerId, purpose: LEAD_ASSIGNED_EVENT, isActive: true },
          select: { agentName: true, agentPhone: true },
        }),
      ])
    : [null, null];
  const { agent, agentPhone } = resolveAgent({
    displayName: role?.displayName,
    phone: role?.phone,
    endpoint,
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
        assigneeUserId: ownerId,
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

/**
 * Send one touch as an approved template through our own WABA.
 *
 * Three records come out of a send, and each earns its place:
 *
 *   - a `WaMessage` on the candidate's thread, so the drip is finally VISIBLE.
 *     Under Wabis a touch went out and left no trace in the CRM, so a consultant
 *     opening a conversation could not see what the system had already said to
 *     their candidate — the most-felt limitation of the old design.
 *   - a `CrmWebhookDelivery`, because the outbox is what Campaign Delivery and
 *     the re-marketing report both read. Writing it keeps every existing view
 *     working across the cutover instead of blanking on the day it happens.
 *   - the campaign's own touch stamp, written by the caller.
 *
 * Delivery status then arrives on the message by wamid, from Meta directly,
 * rather than second-hand through a Wabis callback.
 */
async function sendCloudTouch(opts: {
  campaignId: string;
  lead: SchedulerLead;
  ownerUserId?: string | null;
  touchIndex: number;
  config: RemarketingConfig;
  now: Date;
  /** `name:language` -> variable count. NULL when the catalogue could not be read. */
  templateVars?: Map<string, number> | null;
}): Promise<boolean> {
  const { lead, touchIndex, config } = opts;
  const ownerId = lead.assignedToId ?? opts.ownerUserId ?? null;
  const dedupeKey = `${REMARKETING_TOUCH_EVENT}:${opts.campaignId}:${touchIndex}`;

  const template = config.templates[touchIndex - 1] ?? null;
  if (!template) {
    // Not stamped: an admin filling this in later should find the touch still
    // waiting, exactly as a missing workflow URL behaves on the other transport.
    console.warn(`[crm-remarketing] no template configured for touch ${touchIndex}; deferred`);
    return false;
  }

  const phoneE164 = normalizePhone(lead.phone);
  if (!phoneE164) {
    await recordTouchOutcome({
      dedupeKey,
      leadId: lead.id,
      ownerId,
      touchIndex,
      template,
      phone: "",
      name: lead.candidateName,
      campaignId: opts.campaignId,
      now: opts.now,
      status: "failed",
      detail: "Not sent — the lead has no usable phone number.",
    });
    // Stamped: a phoneless lead must not be retried every night forever.
    return true;
  }

  const [role, endpoint] = ownerId
    ? await Promise.all([
        prisma.leadPulseRole.findUnique({ where: { userId: ownerId }, select: { displayName: true, phone: true } }),
        prisma.wabisWebhookEndpoint.findFirst({
          where: { consultantId: ownerId, purpose: LEAD_ASSIGNED_EVENT, isActive: true },
          select: { agentName: true, agentPhone: true },
        }),
      ])
    : [null, null];
  const { agent, agentPhone } = resolveAgent({ displayName: role?.displayName, phone: role?.phone, endpoint });

  const key = `${template.name}:${template.language}`;

  // "We could not ask" is not "it has no variables". Deferring costs a night;
  // guessing sends a parameter-less template to every due candidate and marks
  // each touch done, so the mistake is unrepeatable and silent.
  if (!opts.templateVars) {
    console.warn(`[crm-remarketing] template catalogue unavailable; touch ${touchIndex} deferred`);
    return false;
  }
  const variableCount = opts.templateVars.get(key);
  if (variableCount === undefined) {
    console.warn(`[crm-remarketing] ${key} is not an approved template on this WABA; touch ${touchIndex} deferred`);
    return false;
  }

  const built = buildTouchParams({
    variableCount,
    tokens: config.templateParams[touchIndex - 1] ?? [],
    from: {
      name: lead.candidateName,
      agent,
      agentPhone,
      service: lead.service?.name ?? null,
      source: lead.source?.label ?? null,
      country: null,
    },
  });
  if (!built.ok) {
    // A config fault defers — mapping the variables and running again should
    // send the touch. A fault in the LEAD does not: no name means no name
    // tomorrow either, so it is recorded and the touch is stamped rather than
    // holding the campaign still forever.
    const leadFault = built.reason === "empty_value";
    console.warn(`[crm-remarketing] touch ${touchIndex} params unusable: ${built.detail}`);
    if (leadFault) {
      await recordTouchOutcome({
        dedupeKey,
        leadId: lead.id,
        ownerId,
        touchIndex,
        template,
        phone: phoneE164,
        name: lead.candidateName,
        campaignId: opts.campaignId,
        now: opts.now,
        status: "failed",
        detail: `Not sent — ${built.detail}.`,
      });
    }
    return leadFault;
  }

  // CLAIM BEFORE SENDING. This is the ordering the Wabis branch has always had
  // and the cloud path did not: it sent first and recorded afterwards, so the
  // unique `dedupeKey` — the entire duplicate guard — was checked only after the
  // candidate already had the message. Two runs overlapping (the nightly cron
  // and an admin pressing Run now) would each see an unstamped touch and each
  // send it. A row inserted first means the loser of that race loses at the
  // database and sends nothing.
  const claimed = await claimTouch({
    dedupeKey,
    leadId: lead.id,
    ownerId,
    touchIndex,
    template,
    phone: phoneE164,
    name: lead.candidateName,
    campaignId: opts.campaignId,
    now: opts.now,
  });
  if (!claimed) {
    // Somebody else holds this touch. Handled, so the caller stamps it and moves
    // on — exactly what the Wabis branch does on the same collision.
    return true;
  }

  const result = await cloudProvider.sendTemplate({
    // `name:language` in one string — the adapter's existing convention, because
    // a WABA can hold the same template in several languages and Meta treats
    // them as different templates. These four are not uniform, so the language
    // travels with every send rather than defaulting.
    toE164: phoneE164,
    template: key,
    params: built.params,
    endpointUrl: null,
  });

  await settleTouch({
    dedupeKey,
    status: result.ok ? "sent" : "failed",
    detail: result.ok ? `Sent as ${key}` : result.body,
    providerMessageId: result.providerMessageId,
    now: opts.now,
  });

  if (!result.ok) {
    // A rejection Meta will repeat tomorrow is stamped so the campaign moves on;
    // a transient one is not, so it is retried. Discarding `retryable` burned a
    // touch on a rate limit or a network blip.
    const permanent = result.retryable === false || result.unsupported === true;
    if (permanent) {
      // The policy the cloud path was missing entirely: stop the campaign, and
      // flag a number that is simply not on WhatsApp so nothing tries it again.
      await applyHardDeliveryFailure({
        leadId: lead.id,
        errorCode: result.status != null ? String(result.status) : null,
        errorMessage: result.body,
        touch: touchIndex,
        now: opts.now,
      }).catch(() => undefined);
    }
    console.warn(`[crm-remarketing] touch ${touchIndex} rejected: ${result.body}`);
    return permanent;
  }

  // The part Wabis could never do: put it in the thread.
  await recordTouchOnThread({
    lead: { id: lead.id, phoneE164, assignedToId: ownerId },
    template,
    providerMessageId: result.providerMessageId,
    now: opts.now,
  }).catch((e) => {
    // The candidate HAS the message. Failing to mirror it is a bookkeeping
    // problem and must never be reported as a failed send, or tomorrow's run
    // would send it again.
    console.error("[crm-remarketing] touch sent but not mirrored:", e);
  });

  return true;
}

/** What every outbox row for a touch carries, whichever way it ends. */
type TouchRowInput = {
  dedupeKey: string;
  leadId: string;
  ownerId: string | null;
  touchIndex: number;
  template: TouchTemplate;
  phone: string;
  name: string | null;
  campaignId: string;
  now: Date;
};

/**
 * Take the touch, or discover somebody else already has.
 *
 * The unique `dedupeKey` does the work; the insert either succeeds or it does
 * not, and nothing between here and the send can change that answer. Returning
 * false means a concurrent run owns this touch and this one must not send.
 */
async function claimTouch(input: TouchRowInput): Promise<boolean> {
  try {
    await prisma.crmWebhookDelivery.create({
      data: {
        event: REMARKETING_TOUCH_EVENT,
        dedupeKey: input.dedupeKey,
        leadId: input.leadId,
        assigneeUserId: input.ownerId,
        // No URL on this transport. Naming the template keeps the column
        // meaningful rather than blank, and it is what somebody reading the
        // delivery log actually wants to know.
        url: `cloud:${input.template.name}:${input.template.language}`,
        endpointLabel: `Re-marketing touch ${input.touchIndex}`,
        // The failures report reads `touch` out of the payload to say WHICH
        // touch failed; an empty object blanked that column.
        payload: {
          touch: input.touchIndex,
          touch_label: `Touch ${input.touchIndex}`,
          lead_id: input.leadId,
          campaign_id: input.campaignId,
          phone: input.phone,
          name: (input.name ?? "").trim(),
          template: `${input.template.name}:${input.template.language}`,
          sent_at: istTimestamp(input.now),
        },
        status: "pending",
        attempts: 1,
        maxAttempts: 1,
      },
    });
    return true;
  } catch {
    // Almost always the unique constraint: another run claimed it first.
    return false;
  }
}

/** Record how the claimed send actually went. */
async function settleTouch(input: {
  dedupeKey: string;
  status: "sent" | "failed";
  detail: string;
  providerMessageId: string | null;
  now: Date;
}): Promise<void> {
  await prisma.crmWebhookDelivery
    .updateMany({
      where: { dedupeKey: input.dedupeKey },
      data: {
        status: input.status,
        // Kept so a delivery callback can be joined back to the touch later —
        // without it the outbox row and the WaMessage share no key at all.
        responseBody: `${input.providerMessageId ? `${input.providerMessageId} — ` : ""}${input.detail}`.slice(0, 500),
        lastAttemptAt: input.now,
        deliveredAt: input.status === "sent" ? input.now : null,
      },
    })
    .catch(() => undefined);
}

/** A terminal outcome with no send attached — a lead we cannot message at all. */
async function recordTouchOutcome(
  input: TouchRowInput & { status: "sent" | "failed"; detail: string },
): Promise<void> {
  const claimed = await claimTouch(input);
  if (!claimed) return;
  await settleTouch({
    dedupeKey: input.dedupeKey,
    status: input.status,
    detail: input.detail,
    providerMessageId: null,
    now: input.now,
  });
}

/** Mirror the touch onto the candidate's WhatsApp thread. */
async function recordTouchOnThread(input: {
  lead: { id: string; phoneE164: string; assignedToId: string | null };
  template: TouchTemplate;
  providerMessageId: string | null;
  now: Date;
}): Promise<void> {
  const conversation = await findOrCreateConversationForLead(input.lead);
  if (!conversation.ok) return;

  await prisma.waMessage.create({
    data: {
      conversationId: conversation.conversationId,
      direction: "out",
      type: "template",
      body: null,
      templateName: input.template.name,
      providerMessageId: input.providerMessageId,
      provider: "cloud",
      // Our transport verdict. Meta's own answer overwrites it by wamid when the
      // status callback lands.
      waStatus: "sent",
      // No author: an automation sent this, and attributing it to the consultant
      // would put words in their mouth.
      sentById: null,
      occurredAt: input.now,
    },
  });

  // `lastMessageAt` only — sending never extends the candidate's 24-hour reply
  // window, and a template is legal outside it anyway.
  await prisma.waConversation.update({
    where: { id: conversation.conversationId },
    data: { lastMessageAt: input.now },
  });
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

  // One catalogue fetch for the whole run, not one per lead.
  const templateVars = await loadTemplateVariableCounts(config);

  const now = new Date();
  const campaigns = await prisma.crmRemarketingCampaign.findMany({
    where: { status: "running" },
    select: {
      id: true,
      leadId: true,
      ownerUserId: true,
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
          whatsappUndeliverableAt: true,
          whatsappUndeliverableReason: true,
          whatsappOptedOutAt: true,
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
  const deadline = Date.now() + RUN_TIME_BUDGET_MS;

  // Phase 1 — cheap & sequential: close campaigns that should stop/complete and
  // collect the touches that are due. No Wabis POST happens here, so it stays fast
  // even for a large backlog.
  const dueSends: { c: (typeof campaigns)[number]; due: number }[] = [];
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

      // The candidate asked us to stop. Checked BEFORE the undeliverable guard
      // because it is a promise rather than a delivery fact: a drip is marketing,
      // and continuing it after an opt-out is a consent breach even though every
      // individual send would technically succeed.
      if (c.lead.whatsappOptedOutAt) {
        await prisma.crmRemarketingCampaign.update({
          where: { id: c.id },
          data: { status: "stopped", endedReason: "opted_out", endedAt: now },
        });
        stopped++;
        continue;
      }

      // A prior touch found the number undeliverable (Meta 131026). Belt-and-braces
      // to the webhook stop: never send a later touch to a dead number.
      if (c.lead.whatsappUndeliverableAt) {
        await prisma.crmRemarketingCampaign.update({
          where: { id: c.id },
          data: {
            status: "stopped",
            endedReason: `undeliverable${c.lead.whatsappUndeliverableReason ? `_${c.lead.whatsappUndeliverableReason}` : ""}`,
            endedAt: now,
          },
        });
        stopped++;
        continue;
      }

      const sent = [!!c.touch1SentAt, !!c.touch2SentAt, !!c.touch3SentAt, !!c.touch4SentAt] as const;
      const due = dueTouchIndex({ startedAt: c.startedAt, now, offsets: config.offsets, sent });

      if (due) {
        dueSends.push({ c, due }); // at most one touch per campaign per run
        continue;
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

  // Phase 2 — the expensive part: POST the due touches to Wabis CONCURRENTLY in
  // batches (each POST is ~1-2s), bounded by MAX_TOUCHES_PER_RUN and the wall-clock
  // deadline, so a large backlog drains fast without timing the function out.
  const toSend = dueSends.slice(0, MAX_TOUCHES_PER_RUN);
  for (let i = 0; i < toSend.length && Date.now() < deadline; i += SEND_CONCURRENCY) {
    const batch = toSend.slice(i, i + SEND_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ c, due }) => {
        try {
          const handled = await enqueueRemarketingTouch({
            campaignId: c.id,
            lead: c.lead,
            ownerUserId: c.ownerUserId,
            touchIndex: due,
            config,
            now,
            templateVars,
          });
          if (!handled) return false;
          await prisma.crmRemarketingCampaign.update({
            where: { id: c.id },
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
          return true;
        } catch (e) {
          console.error(`[crm-remarketing] send failed for campaign ${c.id}:`, e);
          return false;
        }
      }),
    );
    touchesSent += results.filter(Boolean).length;
  }

  return { touchesSent, completed, stopped };
}

// ── Bulk enrolment (one-off: touch every un-touched Re-marketing lead) ───────

export type EnrolRemainingResult = {
  /** Leads in Re-marketing that have never been sent touch 1 (capped by `limit`). */
  eligible: number;
  /** New campaigns opened (lead had none running). */
  opened: number;
  /** Existing young campaigns pulled back so touch 1 is due now. */
  backdated: number;
  /** Running campaigns already past the touch-1 offset — left for the scheduler. */
  alreadyDue: number;
  dryRun: boolean;
  /** True when more leads matched than `limit` — re-run to enrol the rest. */
  capped: boolean;
  sample: { name: string; phone: string }[];
};

/**
 * Enrol EVERY Re-marketing-stage lead that has never received touch 1 into the
 * drip, back-dating the campaign start so touch 1 is immediately due — then the
 * normal scheduler sends touch 1 (rate-capped, see MAX_TOUCHES_PER_RUN) and
 * touches 2/3/4 follow on the offset schedule while the lead stays in the stage.
 *
 * Leads already sent touch 1 (yesterday's batch, or any earlier) are excluded via
 * `remarketingCampaigns.none.touch1SentAt`. Phoneless and 131026-undeliverable
 * leads are skipped. This OPENS campaigns only — no message is sent here; the
 * scheduler (cron or manual "Run now") does the sending, so nothing blasts inside
 * this request. `dryRun` returns the count + a sample without writing.
 */
export async function enrolRemainingRemarketing(opts: {
  dryRun: boolean;
  limit?: number;
}): Promise<EnrolRemainingResult> {
  const limit = Math.min(Math.max(opts.limit ?? 2000, 1), 5000);
  const config = await getRemarketingConfig();
  const firstOffset = config.offsets[0] ?? 5;
  const now = new Date();
  const backdate = new Date(now.getTime() - firstOffset * 86_400_000);

  const empty: EnrolRemainingResult = {
    eligible: 0,
    opened: 0,
    backdated: 0,
    alreadyDue: 0,
    dryRun: opts.dryRun,
    capped: false,
    sample: [],
  };

  const reStatus = await prisma.crmLeadStatus.findUnique({
    where: { code: REMARKETING_STATUS_CODE },
    select: { id: true },
  });
  if (!reStatus) return empty;

  const leads = await prisma.lead.findMany({
    where: {
      statusId: reStatus.id,
      phoneE164: { not: null },
      whatsappUndeliverableAt: null,
      remarketingCampaigns: { none: { touch1SentAt: { not: null } } },
    },
    select: {
      id: true,
      candidateName: true,
      phone: true,
      assignedToId: true,
      remarketingCampaigns: {
        where: { status: "running" },
        select: { id: true, startedAt: true },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit + 1,
  });

  const capped = leads.length > limit;
  const targets = capped ? leads.slice(0, limit) : leads;

  const result: EnrolRemainingResult = {
    ...empty,
    eligible: targets.length,
    capped,
    sample: targets.slice(0, 10).map((l) => ({ name: (l.candidateName ?? "").trim(), phone: l.phone ?? "" })),
  };
  if (opts.dryRun) return result;

  for (const lead of targets) {
    try {
      const running = lead.remarketingCampaigns[0] ?? null;
      if (!running) {
        await prisma.$transaction([
          prisma.crmRemarketingCampaign.create({
            data: { leadId: lead.id, ownerUserId: lead.assignedToId, startedAt: backdate, status: "running" },
          }),
          prisma.lead.update({ where: { id: lead.id }, data: { remarketingStartedAt: backdate } }),
        ]);
        result.opened++;
        await recordLeadActivity({
          leadId: lead.id,
          type: "REMARKETING_STARTED",
          summary: "Re-marketing campaign enrolled (bulk touch-1 backfill)",
          metadata: { startedAt: backdate.toISOString(), bulk: true },
        });
      } else if (running.startedAt.getTime() > backdate.getTime()) {
        // Young campaign — pull its start back so touch 1 becomes due now.
        await prisma.crmRemarketingCampaign.update({ where: { id: running.id }, data: { startedAt: backdate } });
        await prisma.lead
          .update({ where: { id: lead.id }, data: { remarketingStartedAt: backdate } })
          .catch(() => undefined);
        result.backdated++;
      } else {
        result.alreadyDue++;
      }
    } catch (e) {
      console.error("[crm-remarketing] enrolRemainingRemarketing lead failed:", lead.id, e);
    }
  }
  return result;
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

// ── Inbound delivery status (Wabis delivery webhook → guard + report) ────────

/** WhatsApp/Meta message states we track, coarsened from Wabis's status strings. */
export type WaDeliveryStatus = "sent" | "delivered" | "read" | "failed";

/**
 * Coarsen whatever a Wabis delivery-status callback sends into one of our four
 * states. A present error code always means `failed` (a "sent"-then-131049 report
 * is a failure). Otherwise map on the status text. Returns null when nothing is
 * recognisable, so the caller can 400 rather than record a meaningless row.
 */
export function normalizeDeliveryStatus(
  status: string | null | undefined,
  errorCode?: string | null,
  errorMessage?: string | null,
): WaDeliveryStatus | null {
  if (parseErrorCode(errorCode) || parseErrorCode(errorMessage)) return "failed";
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("read")) return "read";
  if (s.includes("fail") || s.includes("undeliver") || s.includes("error") || s.includes("reject")) return "failed";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("sent") || s.includes("accept") || s.includes("queue")) return "sent";
  return null;
}

/** Pull a Meta error code (a 6-digit 131xxx-style number) out of free text. */
export function parseErrorCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const m = String(raw).match(/\b(1\d{5})\b/);
  return m ? m[1] : null;
}

/** One delivery-status event flattened out of a webhook payload. */
export type RawDeliveryEvent = {
  phone: string | null;
  status: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  campaignId: string | null;
  touch: number | null;
  leadId: string | null;
};

function firstString(obj: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

/** Read one delivery event out of a single status object (any of the shapes). */
function readEvent(s: Record<string, unknown>): RawDeliveryEvent {
  // Meta status objects carry failures in an `errors: [{ code, title, message }]`.
  const errors = Array.isArray(s.errors) ? (s.errors as Record<string, unknown>[]) : [];
  const err0 = errors[0] ?? null;
  const errorCode =
    firstString(s, ["error_code", "errorCode", "code"]) ??
    firstString(err0, ["code", "error_code"]) ??
    parseErrorCode(firstString(s, ["error", "error_message", "errorMessage"]));
  const touchRaw = firstString(s, ["touch", "touch_index", "touchIndex"]);
  return {
    phone: firstString(s, ["recipient_id", "wa_id", "phone", "mobile", "to", "number", "msisdn", "contact"]),
    status: firstString(s, ["status", "message_status", "delivery_status", "state", "event", "type"]),
    errorCode,
    errorMessage:
      firstString(s, ["error_message", "errorMessage", "reason", "description"]) ??
      firstString(err0, ["title", "message", "error_data"]),
    campaignId: firstString(s, ["campaign_id", "campaignId"]),
    touch: touchRaw && /^\d+$/.test(touchRaw) ? Number(touchRaw) : null,
    leadId: firstString(s, ["lead_id", "leadId"]),
  };
}

/**
 * Flatten whatever a Wabis "Message Status Change" webhook sends into zero or more
 * delivery events. Wabis's GLOBAL status callback forwards WhatsApp/Meta's native
 * envelope, so this must cope with all of:
 *   - the native Meta shape  entry[].changes[].value.statuses[]
 *   - a top-level `statuses` / `messages` / `data` array (or single object)
 *   - our own flat shape (a per-workflow HTTP-API block, or a test curl)
 * so a config that sends any of these still lands. Pure — unit-tested.
 */
export function extractDeliveryEvents(body: unknown): RawDeliveryEvent[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  const raw: Record<string, unknown>[] = [];

  // Native Meta envelope: entry[].changes[].value.statuses[]
  const entry = Array.isArray(b.entry) ? (b.entry as Record<string, unknown>[]) : [];
  for (const e of entry) {
    const changes = Array.isArray(e?.changes) ? (e.changes as Record<string, unknown>[]) : [];
    for (const c of changes) {
      const value = (c?.value ?? null) as Record<string, unknown> | null;
      const statuses = value && Array.isArray(value.statuses) ? (value.statuses as Record<string, unknown>[]) : [];
      for (const st of statuses) raw.push(st);
    }
  }

  // Top-level arrays some BSPs use.
  for (const key of ["statuses", "messages", "data"]) {
    const v = b[key];
    if (Array.isArray(v)) {
      for (const it of v) if (it && typeof it === "object") raw.push(it as Record<string, unknown>);
    } else if (key === "data" && v && typeof v === "object") {
      raw.push(v as Record<string, unknown>);
    }
  }

  // Fall back to treating the body itself as one flat event (our shape / test curl).
  if (raw.length === 0) raw.push(b);

  return raw.map(readEvent).filter((e) => e.phone || e.leadId);
}

export type DeliveryStatusResult =
  | { ok: true; action: "recorded" | "failed_stopped" | "ignored"; leadId?: string; waStatus?: WaDeliveryStatus; reason?: string }
  | { ok: false; reason: string };

/**
 * Handle a Wabis delivery-status callback for a re-marketing touch. Records the
 * async WhatsApp state on the matching delivery row, and — per the "any hard
 * failure stops the drip" policy — closes the lead's running campaign on a
 * `failed` status, permanently flagging the number when the code is a hard
 * undeliverable (see PERMANENT_UNDELIVERABLE_CODES). Delivered/read are recorded
 * only. Best-effort: a bad callback must never throw back at Wabis.
 *
 * The row is resolved precisely by (campaign_id, touch) echoed from our outbound
 * payload; failing that, by echoed lead_id, then by phone → most-recent touch.
 */
export async function handleWabisDeliveryStatus(input: {
  leadId?: string | null;
  campaignId?: string | null;
  touch?: number | null;
  phone?: string | null;
  status?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<DeliveryStatusResult> {
  try {
    const waStatus = normalizeDeliveryStatus(input.status, input.errorCode, input.errorMessage);
    if (!waStatus) return { ok: false, reason: "unrecognized_status" };
    const errorCode = parseErrorCode(input.errorCode) ?? parseErrorCode(input.errorMessage);
    const errorMessage = (input.errorMessage ?? "").trim().slice(0, 300) || null;

    // Resolve the exact delivery row when the callback echoes campaign_id + touch.
    let delivery: { id: string; leadId: string | null } | null = null;
    if (input.campaignId && input.touch) {
      const dedupeKey = `${REMARKETING_TOUCH_EVENT}:${input.campaignId}:${input.touch}`;
      delivery = await prisma.crmWebhookDelivery
        .findUnique({ where: { dedupeKey }, select: { id: true, leadId: true } })
        .catch(() => null);
    }

    // Resolve the lead: echoed id, the matched row's lead, then phone.
    let leadId = input.leadId?.trim() || delivery?.leadId || null;
    if (!leadId && input.phone) {
      const e164 = normalizePhone(input.phone);
      if (e164) {
        const lead = await prisma.lead.findFirst({
          where: { phoneE164: e164 },
          orderBy: { remarketingStartedAt: "desc" },
          select: { id: true },
        });
        leadId = lead?.id ?? null;
      }
    }

    // Fall back to the lead's most recent re-marketing touch when we had no exact
    // key — narrowed to the reported touch (payload.touch) when one was given, so
    // a touch-2 callback annotates the touch-2 row, not whatever was latest.
    if (!delivery && leadId) {
      delivery = await prisma.crmWebhookDelivery
        .findFirst({
          where: {
            leadId,
            event: REMARKETING_TOUCH_EVENT,
            ...(input.touch ? { payload: { path: ["touch"], equals: input.touch } } : {}),
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, leadId: true },
        })
        .catch(() => null);
    }

    const now = new Date();
    if (delivery) {
      await prisma.crmWebhookDelivery
        .update({
          where: { id: delivery.id },
          data: {
            waStatus,
            waStatusAt: now,
            waErrorCode: errorCode,
            waErrorMessage: errorMessage,
            ...(waStatus === "read" ? { readAt: now } : {}),
          },
        })
        .catch(() => undefined);
    }

    if (!leadId) {
      // Recorded on the row (if any) but no lead to guard — still a success.
      return { ok: true, action: delivery ? "recorded" : "ignored", waStatus, reason: "no_lead_matched" };
    }

    if (waStatus !== "failed") {
      return { ok: true, action: "recorded", leadId, waStatus };
    }

    // FAILED → stop any running campaign for this lead (any-hard-failure policy).
    const permanent = await applyHardDeliveryFailure({
      leadId,
      errorCode,
      errorMessage,
      touch: input.touch ?? null,
      now,
    });

    return { ok: true, action: "failed_stopped", leadId, waStatus, reason: errorCode ?? "failed" };
  } catch (e) {
    console.error("[crm-remarketing] handleWabisDeliveryStatus failed:", e);
    return { ok: false, reason: "error" };
  }
}

/**
 * What a hard delivery failure means for the lead, on EITHER transport.
 *
 * Extracted because the cloud path had none of it. Under Wabis a failed touch
 * stopped the campaign and — for a number that is simply not on WhatsApp —
 * flagged the lead so future campaigns skip it. Sending through our own WABA
 * bypassed all of that, so a dead number would have been messaged again on
 * every touch and again by the next campaign, which is both wasted spend and
 * exactly the behaviour Meta's quality rating punishes.
 *
 * Returns whether the number was flagged permanently.
 */
async function applyHardDeliveryFailure(input: {
  leadId: string;
  errorCode: string | null;
  errorMessage: string | null;
  touch: number | null;
  now: Date;
}): Promise<boolean> {
  const permanent = input.errorCode ? PERMANENT_UNDELIVERABLE_CODES.has(input.errorCode) : false;

  await prisma.crmRemarketingCampaign
    .updateMany({
      where: { leadId: input.leadId, status: "running" },
      data: {
        status: "stopped",
        endedReason: `delivery_failed${input.errorCode ? `_${input.errorCode}` : ""}`,
        endedAt: input.now,
      },
    })
    .catch(() => undefined);

  if (permanent) {
    await prisma.lead
      .update({
        where: { id: input.leadId },
        data: { whatsappUndeliverableAt: input.now, whatsappUndeliverableReason: input.errorCode },
      })
      .catch(() => undefined);
  }

  await recordLeadActivity({
    leadId: input.leadId,
    type: "REMARKETING_TOUCH_FAILED",
    summary: permanent
      ? `WhatsApp undeliverable (${input.errorCode}) — number flagged, re-marketing stopped`
      : `WhatsApp delivery failed${input.errorCode ? ` (${input.errorCode})` : ""} — re-marketing stopped`,
    metadata: {
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      touch: input.touch,
      permanent,
    },
  });

  return permanent;
}

// ── Wabis delivery-report backfill (one-time CSV import) ────────────────────

/** One recipient row distilled from a Wabis workflow CSV export. */
export type WabisReportRow = {
  phone: string;
  status: WaDeliveryStatus;
  errorCode: string | null;
  errorMessage: string | null;
};

/**
 * Minimal RFC-4180-ish CSV tokenizer: double-quoted fields, "" escapes, and
 * commas/newlines inside quotes (Wabis error messages contain both). Returns
 * rows of raw string cells.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = (text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Parse a Wabis WhatsApp-workflow CSV export into recipient rows. Columns are
 * resolved by HEADER NAME (case-insensitive substring) so a re-ordered export
 * still maps. The Excel phone form `="9199…"` is reduced to digits; the outcome
 * is derived from the Delivered/Read/Failed time columns and the error message
 * (a present error code always wins as `failed`).
 */
export function parseWabisDeliveryReport(csv: string): WabisReportRow[] {
  const rows = parseCsv(csv).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.findIndex((h) => h.includes(name));
  const iPhone = col("phone");
  const iDelivered = col("delivered");
  const iRead = col("read");
  const iFailed = col("failed");
  const iError = col("error");
  if (iPhone < 0) return [];

  const out: WabisReportRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const phone = (cells[iPhone] ?? "").replace(/\D/g, "");
    if (!phone) continue;
    const errorMessage = (iError >= 0 ? cells[iError] ?? "" : "").trim() || null;
    const errorCode = parseErrorCode(errorMessage);
    const at = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    let status: WaDeliveryStatus;
    if (errorCode || at(iFailed)) status = "failed";
    else if (at(iRead)) status = "read";
    else if (at(iDelivered)) status = "delivered";
    else status = "sent";
    out.push({ phone, status, errorCode, errorMessage });
  }
  return out;
}

export type DeliveryImportSummary = {
  parsed: number;
  matched: number;
  unmatched: number;
  failures: number;
  flagged: number;
  delivered: number;
  unmatchedPhones: string[];
};

/**
 * One-time backfill: replay a Wabis delivery-report CSV through the SAME handler
 * the live webhook uses, so historical failures land on their delivery rows (and
 * show in the Campaign Delivery report) and bad numbers get flagged — exactly as
 * if the webhook had been live. Admin-only; sequential to avoid a query storm.
 */
export async function importWabisDeliveryReport(opts: {
  csv: string;
  touch?: number | null;
}): Promise<DeliveryImportSummary> {
  const rows = parseWabisDeliveryReport(opts.csv);
  const touch = opts.touch && opts.touch >= 1 && opts.touch <= 4 ? opts.touch : null;
  const summary: DeliveryImportSummary = {
    parsed: rows.length,
    matched: 0,
    unmatched: 0,
    failures: 0,
    flagged: 0,
    delivered: 0,
    unmatchedPhones: [],
  };
  for (const row of rows) {
    const res = await handleWabisDeliveryStatus({
      phone: row.phone,
      touch,
      status: row.status,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
    });
    if (res.ok && res.leadId) {
      summary.matched++;
      if (row.status === "failed") summary.failures++;
      if (row.status === "delivered" || row.status === "read") summary.delivered++;
      if (row.errorCode && PERMANENT_UNDELIVERABLE_CODES.has(row.errorCode)) summary.flagged++;
    } else {
      summary.unmatched++;
      if (summary.unmatchedPhones.length < 100) summary.unmatchedPhones.push(row.phone);
    }
  }
  return summary;
}

// ── Test send (admin "Send test touch") ─────────────────────────────────────

/**
 * POST a sample re-marketing touch to the configured workflow URL, with no real
 * lead or campaign. Two jobs: prove the CRM → Wabis pipeline end-to-end, and give
 * Wabis a sample payload so its "Send Template Message" step can bind our field
 * names for mapping. Logged like any delivery (unique dedupe key) so it can never
 * collide with — or suppress — a real touch.
 */
/**
 * The test send, on the transport that is actually live.
 *
 * It used to fire through Wabis whichever transport was configured, so after the
 * cutover "Send test touch" would prove the wrong thing entirely — a real
 * WhatsApp message down a path the drip no longer uses, reporting success while
 * the live path stayed untested. This is the ONE place a template can be tried
 * before it reaches a candidate, which makes getting it wrong worse than not
 * having it.
 */
async function sendTestCloudTouch(opts: {
  phone: string;
  touch: number;
  config: RemarketingConfig;
}): Promise<{ ok: boolean; status: number | null; body: string; error?: string }> {
  const template = opts.config.templates[opts.touch - 1] ?? null;
  if (!template) {
    return { ok: false, status: null, body: "", error: `Set a template for touch ${opts.touch} and save it first.` };
  }
  const toE164 = normalizePhone(opts.phone);
  if (!toE164) {
    return { ok: false, status: null, body: "", error: "Enter a valid mobile number to send the test to." };
  }

  const key = `${template.name}:${template.language}`;
  const vars = await loadTemplateVariableCounts(opts.config);
  if (!vars) {
    return { ok: false, status: null, body: "", error: "Could not read the approved template list from Meta. Check the Cloud API credentials." };
  }
  const variableCount = vars.get(key);
  if (variableCount === undefined) {
    return { ok: false, status: null, body: "", error: `"${key}" is not an approved template on this WhatsApp account.` };
  }

  // A stub lead, clearly marked. Real values would be a nicer preview and a worse
  // test: the point is to prove the template and its parameter count, and a
  // recognisable placeholder makes an accidental send to a candidate obvious.
  const built = buildTouchParams({
    variableCount,
    tokens: opts.config.templateParams[opts.touch - 1] ?? [],
    from: {
      name: "Test Candidate",
      agent: "Test Agent",
      agentPhone: "+910000000000",
      service: "Test Service",
      source: "Test",
      country: "Test",
    },
  });
  if (!built.ok) {
    return { ok: false, status: null, body: "", error: `Cannot send — ${built.detail}.` };
  }

  const result = await cloudProvider.sendTemplate({
    toE164,
    template: key,
    params: built.params,
    endpointUrl: null,
  });
  return {
    ok: result.ok,
    status: result.status,
    body: result.ok ? `Sent ${key} to ${toE164}` : result.body,
    error: result.ok ? undefined : result.body,
  };
}

export async function sendTestRemarketingTouch(opts: {
  phone: string;
  touch?: number;
}): Promise<{ ok: boolean; status: number | null; body: string; error?: string }> {
  const config = await getRemarketingConfig();
  const touch = opts.touch && opts.touch >= 1 && opts.touch <= 4 ? opts.touch : 1;

  if (config.transport === "cloud") {
    return sendTestCloudTouch({ phone: opts.phone, touch, config });
  }

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
