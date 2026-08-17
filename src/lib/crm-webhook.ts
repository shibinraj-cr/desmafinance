/**
 * Outbound CRM webhooks — today a single consumer: the Wabis WhatsApp
 * automation.
 *
 * When a lead is assigned to a consultant we POST the lead (plus the
 * consultant's name and number) to a Wabis Webhook Workflow. Wabis creates the
 * WhatsApp subscriber, routes it to the matching agent, and sends one reusable
 * approved template whose `#!agent!#` / `#!agent_phone!#` variables are filled
 * from our payload. Wabis does NOT expose the assigned agent as a template
 * variable, which is why the name and phone must be sent explicitly rather than
 * inferred on their side.
 *
 * Delivery uses a transactional outbox (CrmWebhookDelivery): persist first,
 * attempt inline once, let the cron drain retry. On Vercel, work started after
 * the response is not guaranteed to finish, so an in-request retry/backoff loop
 * can be killed mid-sleep — the row in the database is what actually survives.
 *
 * Routing is per consultant. Wabis's "assign conversation to a user" action is
 * static per workflow, so one callback URL can only ever reach one agent —
 * each consultant therefore has their own WabisWebhookEndpoint row, with a
 * default endpoint as the fallback for anyone unmapped.
 *
 * A reassignment deliberately DOES send again: the new consultant's workflow is
 * what moves the conversation into their Wabis inbox, so staying silent would
 * leave the chat with the previous owner while the CRM says otherwise. The cost
 * is a second introduction to the candidate, which is the accepted trade.
 *
 * What must never happen is the *same* consultant introducing themselves twice.
 * Two mechanisms carry that: the `dedupeKey` unique index (lead + consultant)
 * and the conditional claim in `attemptDelivery` (one in-flight attempt per
 * row).
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { normalizePhone } from "./crm";
import {
  getSetting,
  WABIS_WEBHOOK_ENABLED_KEY,
  WABIS_WEBHOOK_SECRET_KEY,
  WABIS_REMARKETING_ENABLED_KEY,
  WA_LEAD_ASSIGNED_CLOUD_KEY,
} from "./app-settings";
import { cloudProvider, isCloudConfigured } from "./wa/cloud-provider";

export const LEAD_ASSIGNED_EVENT = "lead_assigned";
/**
 * The study-abroad counsellor intro, fired manually from the per-lead button
 * (see /api/crm/leads/[id]/wabis/study-abroad). Consultant-routed exactly like
 * `lead_assigned`, but through the assigned consultant's `study_abroad` Wabis
 * workflow (a separate template), so the two events double as endpoint
 * `purpose` values.
 */
export const STUDY_ABROAD_EVENT = "study_abroad";
/**
 * A lead that couldn't be sent at all (no usable phone). Recorded under its own
 * event so it reads as a diagnostic rather than a delivery: it must not occupy
 * the lead's dedupe key, or fixing the number and reassigning would stay
 * silently blocked forever.
 */
export const LEAD_SKIPPED_EVENT = "lead_assigned_skipped";
export const TEST_EVENT = "test";

/**
 * Events that route to a consultant's own Wabis workflow, keyed by endpoint
 * `purpose`. For these the event string IS the purpose, and an unsent retry
 * re-resolves the destination (see attemptDelivery / refreshDeliveryTarget).
 */
export const CONSULTANT_ROUTED_EVENTS: ReadonlySet<string> = new Set([LEAD_ASSIGNED_EVENT, STUDY_ABROAD_EVENT]);
/**
 * A scheduled Re-marketing nurturing touch-point (see src/lib/crm-remarketing.ts).
 * Rides the same outbox/drain as lead-assignment, but is gated by its own
 * `wabis_remarketing_enabled` switch — dedupe key `remarketing_touch:<campaignId>:<n>`.
 */
export const REMARKETING_TOUCH_EVENT = "remarketing_touch";

/**
 * The Meta-approved template the lead-assignment intro sends once it's cut over
 * to the Cloud API. Language pinned to `en_US` — confirmed live (2026-08-17):
 * the bare name with no suffix defaults to `"en"` and Meta rejected it with
 * `132001: template name (desgro_template(en_US)) does not exist in en`, i.e.
 * this exact template is only approved under `en_US`.
 *
 * Confirmed live (2026-08-17) via the approved body text itself (CRM → lead →
 * WhatsApp tab → Start conversation → template picker):
 *
 *   Hi, This is *{{1}}* from DESMA International. … please contact me
 *   directly: Call: {{2}}  WhatsApp: {{3}} … Regards, *{{4}}*
 *
 * Four slots, but only two distinct values — agent name and agent phone, each
 * repeated: {{1}}=agent, {{2}}=agent_phone, {{3}}=agent_phone, {{4}}=agent.
 * Not the 2-variable guess this constant originally shipped with (inferred
 * from Wabis's `#!agent!#`/`#!agent_phone!#` naming, which turned out to only
 * describe which VALUES get used, not how many template slots they fill).
 */
export const LEAD_ASSIGNED_CLOUD_TEMPLATE = "desgro_template:en_US";

/**
 * One timeout for every attempt, inline or retried — and they must stay equal.
 *
 * Aborting only cancels our side of the connection: Wabis has already received
 * the request and will finish creating the subscriber and sending the template.
 * So if the inline attempt gave up *earlier* than the retry, any Wabis latency
 * between the two values would produce a timed-out first attempt followed by a
 * successful retry — i.e. every candidate introduced twice, deterministically.
 * A single value makes that window empty.
 *
 * 8s is the compromise: far above Wabis's sub-second normal response, and the
 * longest an assign click should ever wait when Wabis is unresponsive.
 */
const REQUEST_TIMEOUT_MS = 8_000;
/**
 * How long a claimed delivery stays claimed. If the instance dies mid-attempt
 * the lease simply expires and the row becomes eligible again — with its
 * attempt already counted, so a repeatedly-killed delivery still terminates
 * instead of being retried forever.
 */
const CLAIM_LEASE_MINUTES = 5;
/** Response/error text kept for the settings log. Enough to read a stack trace. */
const MAX_RESPONSE_CHARS = 2_000;
/**
 * Backoff before retry N (index = attempts already made). Three attempts total,
 * spread over ~15 minutes — long enough to ride out a Wabis restart, short
 * enough that a consultant's intro message isn't stale when it lands.
 */
const BACKOFF_MINUTES = [2, 12];

// ── Pure helpers (unit-tested; no I/O) ──────────────────────────────────────

/**
 * The subscriber number as Wabis wants it: full international, country code, no
 * `+`, spaces or dashes — e.g. `919876543210`. Runs through the CRM's shared
 * `normalizePhone` first so a bare 10-digit Indian mobile picks up +91 and a
 * leading-zero access code (`00`, `009…`) is stripped, exactly as everywhere
 * else in the CRM. Null when the number can't be normalised — there is nothing
 * useful to send Wabis without a valid subscriber number.
 */
export function toWabisPhone(raw: string | null | undefined): string | null {
  const e164 = normalizePhone(raw);
  if (!e164) return null;
  const digits = e164.replace(/\D/g, "");
  return digits || null;
}

/**
 * The consultant's number as it should *read inside the WhatsApp message* —
 * E.164 with the leading `+` kept (`+919000000001`). This is display text, not
 * a routing key, so it deliberately differs from `toWabisPhone`. Falls back to
 * the raw string when it can't be normalised, so an admin who typed a
 * deliberately formatted number still gets what they typed.
 */
export function toAgentPhone(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  return normalizePhone(trimmed) ?? trimmed;
}

/**
 * Format an instant as an IST timestamp with an explicit offset, e.g.
 * `2026-07-21T14:24:00+05:30`. India has no DST, so the offset is a constant —
 * computing the wall-clock by shifting the epoch is exact, and avoids
 * `Intl.DateTimeFormat` round-tripping just to reassemble a string.
 */
export function istTimestamp(date: Date): string {
  const IST_OFFSET_MIN = 330;
  const shifted = new Date(date.getTime() + IST_OFFSET_MIN * 60_000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
    `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}+05:30`
  );
}

/**
 * Is this a usable Wabis workflow callback URL?
 *
 * https is required — the payload carries a candidate's name and number. The
 * host/path shape is checked only loosely: Wabis callback URLs look like
 * `https://<host>/webhook/whatsapp-workflow/<ids>`, but hard-coding
 * `bot.wabis.in` would break a self-hosted or rebranded instance for no real
 * safety gain, so anything https with a `/webhook/` path is accepted.
 */
export function isWabisWebhookUrl(raw: string): boolean {
  const t = (raw ?? "").trim();
  if (!/^https:\/\/\S+$/i.test(t)) return false;
  try {
    return new URL(t).pathname.includes("/webhook/");
  } catch {
    return false;
  }
}

/**
 * How one consultant's messages route and read: which Wabis workflow to POST
 * to, and the name/phone the template should show. Mirrors the columns of
 * WabisWebhookEndpoint that the delivery path actually needs.
 */
export type WabisEndpoint = {
  id: string;
  label: string;
  webhookUrl: string;
  agentName: string | null;
  agentPhone: string | null;
  consultantId: string | null;
  isDefault: boolean;
  purpose: string;
};

/**
 * The consultant's Wabis identity. `LeadPulseRole.displayName` / `.phone` are
 * the source of truth — they already drive the CRM's `{consultant_phone}` merge
 * field. The endpoint's `agentName` / `agentPhone` override them only for the
 * mismatch case: Wabis registered the agent under a different spelling, or they
 * answer on a different number.
 *
 * An override phone is used *verbatim*. It is the field whose whole purpose is
 * to control how the number reads inside the WhatsApp message, so normalising it
 * would be the tool second-guessing an explicit instruction — and would corrupt
 * anything E.164 can't express, such as a landline with an extension.
 */
export function resolveAgent(input: {
  displayName: string | null | undefined;
  phone: string | null | undefined;
  endpoint?: Pick<WabisEndpoint, "agentName" | "agentPhone"> | null;
}): { agent: string; agentPhone: string } {
  const overrideName = input.endpoint?.agentName?.trim();
  const overridePhone = input.endpoint?.agentPhone?.trim();
  return {
    agent: (overrideName || input.displayName || "").trim(),
    agentPhone: overridePhone || toAgentPhone(input.phone),
  };
}

export type LeadAssignedPayload = {
  name: string;
  phone: string;
  email: string;
  agent: string;
  agent_phone: string;
  consultant: string;
  source: string;
  service: string;
  status: string;
  lead_id: string;
  assigned_at: string;
};

/**
 * Build the exact JSON Wabis expects. Every key is always present — Wabis binds
 * its field mapping from a sample payload, so a key that vanishes when a lead
 * happens to have no service would silently unmap that field. Unknown values
 * are therefore the empty string, never `null` or omitted.
 *
 * Returns null when the lead has no normalisable phone: Wabis keys the
 * subscriber on the number, so there is no subscriber to create without one.
 */
export function buildLeadAssignedPayload(input: {
  leadId: string;
  candidateName: string | null | undefined;
  phone: string | null | undefined;
  email: string | null | undefined;
  source: string | null | undefined;
  service: string | null | undefined;
  status: string | null | undefined;
  assignedAt: Date;
  agent: string;
  agentPhone: string;
}): LeadAssignedPayload | null {
  const phone = toWabisPhone(input.phone);
  if (!phone) return null;
  return {
    name: (input.candidateName ?? "").trim(),
    phone,
    email: (input.email ?? "").trim(),
    agent: input.agent,
    agent_phone: input.agentPhone,
    // Same value as `agent`, sent under the CRM's own vocabulary so a Wabis
    // operator reading a raw payload can tell which system named the person.
    consultant: input.agent,
    source: (input.source ?? "").trim(),
    service: (input.service ?? "").trim(),
    status: (input.status ?? "").trim(),
    lead_id: input.leadId,
    assigned_at: istTimestamp(input.assignedAt),
  };
}

/**
 * `desgro_template`'s four body slots, confirmed against the approved text
 * (see `LEAD_ASSIGNED_CLOUD_TEMPLATE`) — two distinct values, each used twice:
 * the agent's name opens and signs the message ({{1}}, {{4}}), their phone is
 * given for both the call-me and WhatsApp-me lines ({{2}}, {{3}}).
 */
export function buildLeadAssignedCloudParams(agent: string, agentPhone: string): Record<string, string> {
  return { "1": agent, "2": agentPhone, "3": agentPhone, "4": agent };
}

/**
 * Idempotency key. Scoped to lead *and* consultant, so the same lead can never
 * message the same consultant twice — while a genuine reassignment to someone
 * else (when re-fire is enabled) is still a distinct, sendable event.
 */
export function leadAssignedDedupeKey(leadId: string, assigneeUserId: string): string {
  return `${LEAD_ASSIGNED_EVENT}:${leadId}:${assigneeUserId}`;
}

/** Backoff for the next retry, or null once attempts are exhausted. */
export function nextAttemptDelayMinutes(attemptsMade: number): number | null {
  return BACKOFF_MINUTES[attemptsMade - 1] ?? null;
}

// ── Configuration ───────────────────────────────────────────────────────────

export type WabisWebhookConfig = {
  enabled: boolean;
  secret: string | null;
};

/**
 * Global on/off and the optional outbound secret. Destinations no longer live
 * here — each consultant's workflow URL is a WabisWebhookEndpoint row, because
 * Wabis can only bind one agent per workflow.
 */
export async function getWabisWebhookConfig(): Promise<WabisWebhookConfig> {
  const [enabled, secret] = await Promise.all([
    getSetting(WABIS_WEBHOOK_ENABLED_KEY).catch(() => null),
    getSetting(WABIS_WEBHOOK_SECRET_KEY).catch(() => null),
  ]);
  return { enabled: enabled === "1", secret: secret?.trim() || null };
}

/**
 * Whether the lead-assignment intro should go out through the Cloud API
 * instead of Wabis. Requires both: the dedicated switch (an admin decision,
 * independent of the broader `WA_PROVIDER_KEY` cutover) AND working Cloud
 * credentials — a switch flipped ahead of configuration must not start
 * silently failing every assignment.
 */
export async function isLeadAssignedCloudEnabled(): Promise<boolean> {
  const flag = await getSetting(WA_LEAD_ASSIGNED_CLOUD_KEY).catch(() => null);
  if (flag !== "1") return false;
  return isCloudConfigured();
}

const endpointSelect = {
  id: true,
  label: true,
  webhookUrl: true,
  agentName: true,
  agentPhone: true,
  consultantId: true,
  isDefault: true,
  purpose: true,
} as const;

/**
 * Pick the workflow that should carry a consultant's leads: their own endpoint,
 * else the default, else nothing.
 *
 * Kept pure and separate from the query so the precedence rule — the bit that
 * decides whose WhatsApp inbox a candidate lands in — is directly testable.
 */
export function pickEndpoint<T extends { consultantId: string | null; isDefault: boolean }>(
  activeEndpoints: readonly T[],
  consultantId: string,
): T | null {
  return (
    activeEndpoints.find((e) => e.consultantId === consultantId) ??
    activeEndpoints.find((e) => e.isDefault) ??
    null
  );
}

/**
 * Which Wabis workflow should carry this consultant's leads.
 *
 * Returning null is a legitimate outcome, not an error — an admin may simply not
 * have mapped this consultant yet. The caller records that as a skipped delivery
 * so it surfaces in the settings UI instead of vanishing into a server log.
 *
 * One query for the whole (small) active set, rather than a query per candidate
 * rule; the choice itself is `pickEndpoint`.
 *
 * Scoped by `purpose`: the assignment intro and the study-abroad intro are
 * separate Wabis workflows, so a consultant's `study_abroad` endpoint is
 * resolved independently of their `lead_assigned` one.
 */
export async function resolveEndpointForConsultant(
  consultantId: string,
  purpose: string = LEAD_ASSIGNED_EVENT,
): Promise<WabisEndpoint | null> {
  const active = await prisma.wabisWebhookEndpoint.findMany({
    where: { isActive: true, purpose },
    select: endpointSelect,
  });
  return pickEndpoint(active, consultantId);
}

// ── Delivery ────────────────────────────────────────────────────────────────

type PostResult = { ok: boolean; status: number | null; body: string };

/**
 * Make a sink's response safe to store. Postgres `text` rejects NUL bytes, so an
 * unsanitised body could make the row permanently un-updatable — which would
 * wedge the whole queue behind it, since the drain retries oldest-first.
 */
function sanitizeResponse(body: string): string {
  // eslint-disable-next-line no-control-regex
  return body.replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, MAX_RESPONSE_CHARS);
}

/**
 * Did this response actually mean "delivered"?
 *
 * Wabis answers HTTP 200 even when it rejects the request, carrying the real
 * outcome in the body as `{"status":0,"message":"…"}` — so trusting the status
 * code alone records a hard rejection as a successful send, hides it from the
 * log, and skips the retry. An unparseable or empty body with a 2xx is still
 * treated as success, since that is what a plain acknowledgement looks like.
 */
export function isDeliveredResponse(httpOk: boolean, body: string): boolean {
  if (!httpOk) return false;
  const text = body.trim();
  if (!text) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return true; // not JSON — the HTTP status is all we have to go on
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return true;
  const o = parsed as Record<string, unknown>;
  if ("status" in o && (o.status === 0 || o.status === false || o.status === "0")) return false;
  if (o.success === false) return false;
  if ("error" in o && o.error) return false;
  return true;
}

/** One HTTP attempt. Never throws — a transport failure is a result, not an error. */
export async function postWebhook(
  url: string,
  payload: unknown,
  secret: string | null,
): Promise<PostResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { "x-webhook-secret": secret } : {}),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await res.text().catch(() => "");
    const clean = sanitizeResponse(body);
    return { ok: isDeliveredResponse(res.ok, clean), status: res.status, body: clean };
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : "request failed";
    return { ok: false, status: null, body: sanitizeResponse(msg) };
  }
}

/**
 * Re-point an unsent delivery at whichever workflow currently owns this
 * consultant, rewriting the agent identity in the payload to match.
 *
 * The lead's own details stay as captured — they describe the lead at the moment
 * it was assigned — but `agent`, `agent_phone` and `consultant` come from the
 * endpoint, so sending an old endpoint's agent through a new endpoint's workflow
 * would introduce the candidate to the wrong person. Null when the consultant
 * has no route at all.
 */
async function refreshDeliveryTarget(
  assigneeUserId: string,
  payload: unknown,
  purpose: string,
): Promise<{ url: string; payload: unknown; endpointLabel: string | null } | null> {
  const endpoint = await resolveEndpointForConsultant(assigneeUserId, purpose);
  if (!endpoint) return null;

  const role = await prisma.leadPulseRole.findUnique({
    where: { userId: assigneeUserId },
    select: { displayName: true, phone: true },
  });
  const { agent, agentPhone } = resolveAgent({
    displayName: role?.displayName,
    phone: role?.phone,
    endpoint,
  });

  const base = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  return {
    url: endpoint.webhookUrl,
    endpointLabel: endpoint.label,
    payload: { ...(base as Record<string, unknown>), agent, agent_phone: agentPhone, consultant: agent },
  };
}

/**
 * The Cloud-API half of `attemptDelivery`, for `LEAD_ASSIGNED_EVENT` rows once
 * `isLeadAssignedCloudEnabled()` is true. Split out because it shares nothing
 * with the Wabis path below it: no per-consultant endpoint to resolve (the
 * Cloud API addresses the candidate directly), no `postWebhook`/secret, and a
 * richer result (`retryable`) worth actually using instead of always spending
 * every attempt on a permanent rejection (bad template name, wrong param count).
 *
 * Takes the already-claimed row (the caller's `updateMany` claim covers this
 * path too), so it only ever records the outcome, never re-claims.
 */
async function attemptCloudLeadAssignedDelivery(row: {
  id: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}): Promise<boolean> {
  const payload = row.payload as Partial<LeadAssignedPayload> | null;
  const digits = payload?.phone?.trim();
  const finishedAt = new Date();

  if (!digits) {
    await prisma.crmWebhookDelivery.update({
      where: { id: row.id },
      data: { status: "failed", nextAttemptAt: null, responseBody: "No phone on the queued payload." },
    });
    return false;
  }

  const result = await cloudProvider.sendTemplate({
    // `digits` is Wabis-shaped (no `+`) from buildLeadAssignedPayload; Cloud API
    // wants E.164, and the digits already carry the country code.
    toE164: `+${digits}`,
    template: LEAD_ASSIGNED_CLOUD_TEMPLATE,
    params: buildLeadAssignedCloudParams(payload?.agent ?? "", payload?.agent_phone ?? ""),
    endpointUrl: null,
  });

  if (result.ok) {
    await prisma.crmWebhookDelivery.update({
      where: { id: row.id },
      data: {
        status: "sent",
        deliveredAt: finishedAt,
        nextAttemptAt: null,
        responseStatus: result.status,
        responseBody: result.providerMessageId ? `wamid: ${result.providerMessageId}` : result.body,
      },
    });
    return true;
  }

  // A non-retryable result (bad template/params, invalid number) will never
  // succeed on retry — burning the remaining attempts on it just delays the
  // "failed" state an admin needs to see.
  const exhausted = row.attempts >= row.maxAttempts || result.retryable === false;
  const delay = exhausted ? null : nextAttemptDelayMinutes(row.attempts);
  await prisma.crmWebhookDelivery.update({
    where: { id: row.id },
    data: {
      status: delay === null ? "failed" : "pending",
      nextAttemptAt: delay === null ? null : new Date(finishedAt.getTime() + delay * 60_000),
      responseStatus: result.status,
      responseBody: result.body,
    },
  });
  return false;
}

/**
 * Attempt one pending delivery and record the outcome. Returns true only when
 * *this* call delivered it.
 *
 * The row is claimed with a conditional `updateMany` before the request goes
 * out — the inline attempt and a cron tick can otherwise pick up the same row
 * at the same instant and message the candidate twice, and their two writes
 * would each be computed from the same stale read. Claiming increments the
 * attempt counter up front, so a delivery whose instance is killed mid-flight
 * still converges on 'failed' rather than being resent on every tick forever.
 */
export async function attemptDelivery(deliveryId: string): Promise<boolean> {
  const now = new Date();
  const claim = await prisma.crmWebhookDelivery.updateMany({
    where: {
      id: deliveryId,
      status: "pending",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: {
      attempts: { increment: 1 },
      lastAttemptAt: now,
      // Hold the row for the lease window so nothing else picks it up mid-flight.
      nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MINUTES * 60_000),
    },
  });
  // Someone else owns this attempt (or the row is already settled).
  if (claim.count !== 1) return false;

  const row = await prisma.crmWebhookDelivery.findUnique({ where: { id: deliveryId } });
  if (!row) return false;

  // Cut-over path: the assignment intro only, gated by its own switch (see
  // `isLeadAssignedCloudEnabled`) so this can go live without touching
  // study-abroad, the re-marketing drip, or the broader wa_provider cutover.
  if (row.event === LEAD_ASSIGNED_EVENT && (await isLeadAssignedCloudEnabled())) {
    return attemptCloudLeadAssignedDelivery(row);
  }

  // A row that hasn't landed yet has no history to protect, so its destination
  // and agent identity are re-resolved before every attempt. Without this, an
  // admin who fixes a misrouted consultant — the single most likely reason a
  // delivery failed — would still see the retry go to the retired workflow, and
  // carry the retired endpoint's agent name into the right inbox. Frozen values
  // are only correct once a row is 'sent'.
  let target: { url: string; payload: unknown; endpointLabel: string | null } = {
    url: row.url,
    payload: row.payload,
    endpointLabel: row.endpointLabel,
  };
  if (CONSULTANT_ROUTED_EVENTS.has(row.event) && row.assigneeUserId) {
    // For consultant-routed events the event string is the endpoint purpose.
    const refreshed = await refreshDeliveryTarget(row.assigneeUserId, row.payload, row.event);
    if (!refreshed) {
      await prisma.crmWebhookDelivery.update({
        where: { id: row.id },
        data: {
          status: "failed",
          nextAttemptAt: null,
          responseBody:
            "Not sent — no Wabis workflow is mapped to this consultant, and no default endpoint is configured.",
        },
      });
      return false;
    }
    target = refreshed;
    if (refreshed.url !== row.url || refreshed.endpointLabel !== row.endpointLabel) {
      await prisma.crmWebhookDelivery.update({
        where: { id: row.id },
        data: { url: refreshed.url, endpointLabel: refreshed.endpointLabel, payload: refreshed.payload as object },
      });
    }
  }

  const cfg = await getWabisWebhookConfig();
  const result = await postWebhook(target.url, target.payload, cfg.secret);
  const finishedAt = new Date();

  if (result.ok) {
    await prisma.crmWebhookDelivery.update({
      where: { id: row.id },
      data: {
        status: "sent",
        deliveredAt: finishedAt,
        nextAttemptAt: null,
        responseStatus: result.status,
        responseBody: result.body,
      },
    });
    return true;
  }

  // `row.attempts` already counts this attempt — it was incremented by the claim.
  const delay = row.attempts >= row.maxAttempts ? null : nextAttemptDelayMinutes(row.attempts);
  await prisma.crmWebhookDelivery.update({
    where: { id: row.id },
    data: {
      status: delay === null ? "failed" : "pending",
      nextAttemptAt: delay === null ? null : new Date(finishedAt.getTime() + delay * 60_000),
      responseStatus: result.status,
      responseBody: result.body,
    },
  });
  return false;
}

/**
 * Enqueue (and immediately attempt) the lead-assignment webhook.
 *
 * Best-effort by contract: this never throws and never fails the assignment
 * that triggered it — mirrors `notifyLeadAssigned` / `recordLeadActivity`. A
 * duplicate `dedupeKey` is the normal no-op path, not an error.
 *
 * "Only the first assignment sends" is enforced here, by asking whether this
 * lead has *ever* produced a delivery — not by looking at whether the lead was
 * assigned a moment ago. Those differ: unassigning a lead and then giving it to
 * someone else looks like a first assignment to the column, but is a second
 * introduction to the candidate, which is exactly what the flag exists to stop.
 */
export async function enqueueLeadAssignedWebhook(opts: {
  leadId: string;
  assigneeUserId: string;
  candidateName: string | null | undefined;
  phone: string | null | undefined;
  email: string | null | undefined;
  source: string | null | undefined;
  service: string | null | undefined;
  status: string | null | undefined;
  assignedAt: Date | null | undefined;
  agentDisplayName: string | null | undefined;
  agentPhone: string | null | undefined;
}): Promise<void> {
  try {
    const dedupeKey = leadAssignedDedupeKey(opts.leadId, opts.assigneeUserId);
    // Cheap pre-check: the unique index is the real guard (below), this just
    // avoids building a payload for the overwhelmingly common repeat case.
    // Scoped to lead+consultant, which is also what makes a reassignment send:
    // the new consultant's workflow is what moves the WhatsApp conversation into
    // their Wabis inbox, so suppressing it would strand the chat with the
    // previous owner. Bouncing a lead back to someone it already reached stays
    // silent.
    const existing = await prisma.crmWebhookDelivery.findUnique({
      where: { dedupeKey },
      select: { id: true },
    });
    if (existing) return;

    // Checked before the Wabis-specific gates below: once this is on, the intro
    // no longer needs `wabis_webhook_enabled` (a switch an admin winding Wabis
    // down will naturally turn off) or a per-consultant WabisWebhookEndpoint —
    // Cloud addresses the candidate directly, no per-agent workflow to map.
    if (await isLeadAssignedCloudEnabled()) {
      await enqueueLeadAssignedCloudDelivery(dedupeKey, opts);
      return;
    }

    const cfg = await getWabisWebhookConfig();
    if (!cfg.enabled) return;

    const endpoint = await resolveEndpointForConsultant(opts.assigneeUserId);

    if (!endpoint) {
      // Nothing to send to. Recorded rather than logged-and-forgotten, so the
      // settings page can show the admin exactly which consultant is unmapped.
      await prisma.crmWebhookDelivery
        .create({
          data: {
            event: LEAD_SKIPPED_EVENT,
            dedupeKey: `${LEAD_SKIPPED_EVENT}:${randomUUID()}`,
            leadId: opts.leadId,
            assigneeUserId: opts.assigneeUserId,
            url: "",
            payload: {},
            status: "failed",
            attempts: 0,
            maxAttempts: 0,
            responseBody:
              "Not sent — no Wabis workflow is mapped to this consultant, and no default endpoint is configured.",
          },
        })
        .catch(() => undefined);
      return;
    }

    const { agent, agentPhone } = resolveAgent({
      displayName: opts.agentDisplayName,
      phone: opts.agentPhone,
      endpoint,
    });
    const payload = buildLeadAssignedPayload({
      leadId: opts.leadId,
      candidateName: opts.candidateName,
      phone: opts.phone,
      email: opts.email,
      source: opts.source,
      service: opts.service,
      status: opts.status,
      assignedAt: opts.assignedAt ?? new Date(),
      agent,
      agentPhone,
    });

    if (!payload) {
      // Unsendable rather than transiently failed — record it so the reason is
      // visible in the settings log instead of vanishing into the server logs.
      // Keyed uniquely and under the skipped event, so once someone fixes the
      // lead's number a reassignment can still send for real.
      await prisma.crmWebhookDelivery
        .create({
          data: {
            event: LEAD_SKIPPED_EVENT,
            dedupeKey: `${LEAD_SKIPPED_EVENT}:${randomUUID()}`,
            leadId: opts.leadId,
            assigneeUserId: opts.assigneeUserId,
            url: endpoint.webhookUrl,
            endpointLabel: endpoint.label,
            payload: {},
            status: "failed",
            attempts: 0,
            maxAttempts: 0,
            responseBody: "Not sent — the lead has no phone number Wabis can use as a subscriber.",
          },
        })
        .catch(() => undefined);
      return;
    }

    const created = await prisma.crmWebhookDelivery.create({
      data: {
        event: LEAD_ASSIGNED_EVENT,
        dedupeKey,
        leadId: opts.leadId,
        assigneeUserId: opts.assigneeUserId,
        url: endpoint.webhookUrl,
        endpointLabel: endpoint.label,
        payload,
      },
      select: { id: true },
    });

    await attemptDelivery(created.id);
  } catch (e) {
    console.error("[crm-webhook] lead-assignment webhook not enqueued:", e);
    // The unique-constraint race (two assigns landing together, both trying to
    // create the same dedupeKey) is expected and not worth recording — the
    // other request already owns this delivery, so losing is the correct
    // outcome, and a row already exists for anyone checking the log.
    //
    // Anything else is a genuine bug, and until now it vanished completely: no
    // row, no visible error anywhere, just a console.error only Vercel's own
    // logs would ever show — which is exactly how a real failure here read as
    // "nothing sent, no trace" instead of a diagnosable error. Recorded the
    // same way an unmapped consultant already is, so it surfaces in the same
    // delivery log (CRM → Settings → Integrations) instead of staying invisible.
    const isDedupeRace = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
    if (!isDedupeRace) {
      await prisma.crmWebhookDelivery
        .create({
          data: {
            event: LEAD_SKIPPED_EVENT,
            dedupeKey: `${LEAD_SKIPPED_EVENT}:${randomUUID()}`,
            leadId: opts.leadId,
            assigneeUserId: opts.assigneeUserId,
            url: "",
            payload: {},
            status: "failed",
            attempts: 0,
            maxAttempts: 0,
            responseBody: `Not sent — unexpected error: ${e instanceof Error ? e.message : String(e)}`,
          },
        })
        .catch(() => undefined);
    }
  }
}

/**
 * The Cloud-API half of `enqueueLeadAssignedWebhook`. No endpoint to resolve —
 * Cloud sends to the candidate's number directly — so the only unsendable case
 * left is a lead with no usable phone. `dedupeKey` is passed in rather than
 * recomputed, so this stays the single dedupe check for both transports.
 */
async function enqueueLeadAssignedCloudDelivery(
  dedupeKey: string,
  opts: {
    leadId: string;
    assigneeUserId: string;
    candidateName: string | null | undefined;
    phone: string | null | undefined;
    email: string | null | undefined;
    source: string | null | undefined;
    service: string | null | undefined;
    status: string | null | undefined;
    assignedAt: Date | null | undefined;
    agentDisplayName: string | null | undefined;
    agentPhone: string | null | undefined;
  },
): Promise<void> {
  const { agent, agentPhone } = resolveAgent({
    displayName: opts.agentDisplayName,
    phone: opts.agentPhone,
  });
  const payload = buildLeadAssignedPayload({
    leadId: opts.leadId,
    candidateName: opts.candidateName,
    phone: opts.phone,
    email: opts.email,
    source: opts.source,
    service: opts.service,
    status: opts.status,
    assignedAt: opts.assignedAt ?? new Date(),
    agent,
    agentPhone,
  });

  if (!payload) {
    await prisma.crmWebhookDelivery
      .create({
        data: {
          event: LEAD_SKIPPED_EVENT,
          dedupeKey: `${LEAD_SKIPPED_EVENT}:${randomUUID()}`,
          leadId: opts.leadId,
          assigneeUserId: opts.assigneeUserId,
          url: "",
          payload: {},
          status: "failed",
          attempts: 0,
          maxAttempts: 0,
          responseBody: "Not sent — the lead has no phone number the Cloud API can use.",
        },
      })
      .catch(() => undefined);
    return;
  }

  const created = await prisma.crmWebhookDelivery.create({
    data: {
      event: LEAD_ASSIGNED_EVENT,
      dedupeKey,
      leadId: opts.leadId,
      assigneeUserId: opts.assigneeUserId,
      // Descriptive, not dereferenced — attemptDelivery routes this event to
      // the Cloud path by (event, isLeadAssignedCloudEnabled()), never by url.
      url: `cloud:${LEAD_ASSIGNED_CLOUD_TEMPLATE}`,
      endpointLabel: "WhatsApp Cloud API",
      payload,
    },
    select: { id: true },
  });

  await attemptDelivery(created.id);
}

/** Outcome of a study-abroad send, shaped for a direct user-facing message. */
export type StudyAbroadSendResult = {
  ok: boolean;
  state: "sent" | "queued" | "already_sent" | "no_endpoint" | "no_phone" | "disabled" | "error";
  message: string;
};

/**
 * Fire the study-abroad counsellor intro for one lead, through the ASSIGNED
 * consultant's `study_abroad` Wabis workflow.
 *
 * Unlike the lead-assignment webhook this is a manual, user-triggered action, so
 * it returns a concrete result the button can show — including the "already
 * sent" case, which is a success to report, not a silent no-op. Idempotent on
 * (lead, consultant): a second click on the same pairing won't re-message the
 * candidate, but a genuine reassignment to a new consultant is a new pairing and
 * will send.
 */
export async function enqueueStudyAbroadWebhook(opts: {
  leadId: string;
  assigneeUserId: string;
  candidateName: string | null | undefined;
  phone: string | null | undefined;
  email: string | null | undefined;
  source: string | null | undefined;
  service: string | null | undefined;
  status: string | null | undefined;
  agentDisplayName: string | null | undefined;
  agentPhone: string | null | undefined;
}): Promise<StudyAbroadSendResult> {
  try {
    const cfg = await getWabisWebhookConfig();
    if (!cfg.enabled) {
      return { ok: false, state: "disabled", message: "The WhatsApp automation is switched off in CRM settings." };
    }

    const dedupeKey = `${STUDY_ABROAD_EVENT}:${opts.leadId}:${opts.assigneeUserId}`;
    const existing = await prisma.crmWebhookDelivery.findUnique({
      where: { dedupeKey },
      select: { id: true, status: true },
    });
    if (existing) {
      // A row for this pairing already exists. If it landed (or is mid-flight),
      // the candidate has it / will have it — don't re-message. If it *failed*
      // (e.g. Wabis was down through all retries), a fresh click re-fires it
      // rather than dead-ending: the outbox reuses the dedupe key, so there is
      // no other recovery path for a manual send.
      if (existing.status === "sent") {
        return { ok: true, state: "already_sent", message: "The study-abroad intro was already sent to this lead." };
      }
      if (existing.status === "pending") {
        return { ok: true, state: "queued", message: "A study-abroad intro to this lead is already queued." };
      }
      const retry = await requeueDelivery(existing.id);
      if (!retry.requeued) return { ok: false, state: "error", message: retry.reason ?? "Couldn't re-send." };
      return retry.delivered
        ? { ok: true, state: "sent", message: "Study-abroad intro sent." }
        : { ok: true, state: "queued", message: "Study-abroad intro queued — it'll be retried automatically." };
    }

    const endpoint = await resolveEndpointForConsultant(opts.assigneeUserId, STUDY_ABROAD_EVENT);
    if (!endpoint) {
      return {
        ok: false,
        state: "no_endpoint",
        message: "No study-abroad Wabis workflow is mapped to this consultant (and no default). Add one in CRM → Settings.",
      };
    }

    const { agent, agentPhone } = resolveAgent({
      displayName: opts.agentDisplayName,
      phone: opts.agentPhone,
      endpoint,
    });
    const payload = buildLeadAssignedPayload({
      leadId: opts.leadId,
      candidateName: opts.candidateName,
      phone: opts.phone,
      email: opts.email,
      source: opts.source,
      service: opts.service,
      status: opts.status,
      assignedAt: new Date(),
      agent,
      agentPhone,
    });
    if (!payload) {
      return { ok: false, state: "no_phone", message: "This lead has no phone number Wabis can use as a subscriber." };
    }

    const created = await prisma.crmWebhookDelivery.create({
      data: {
        event: STUDY_ABROAD_EVENT,
        dedupeKey,
        leadId: opts.leadId,
        assigneeUserId: opts.assigneeUserId,
        url: endpoint.webhookUrl,
        endpointLabel: endpoint.label,
        payload,
      },
      select: { id: true },
    });

    const delivered = await attemptDelivery(created.id);
    return delivered
      ? { ok: true, state: "sent", message: "Study-abroad intro sent." }
      : { ok: true, state: "queued", message: "Study-abroad intro queued — it'll be retried automatically if Wabis was briefly unreachable." };
  } catch (e) {
    // A dedupeKey race (double-click) lands here; the other request owns the send.
    console.error("[crm-webhook] study-abroad webhook not enqueued:", e);
    return { ok: false, state: "error", message: "Could not send right now. Please try again in a moment." };
  }
}

/**
 * Retry deliveries the inline attempt didn't land. Driven by Vercel Cron
 * (/api/cron/crm-webhooks) — this is what makes the outbox worth having.
 */
export async function drainWebhookQueue(
  limit = 50,
): Promise<{ attempted: number; sent: number; errored: number; skipped?: string }> {
  // The queue is shared by two independently-toggled Wabis features: the
  // lead-assignment intro (this module) and the re-marketing drip
  // (crm-remarketing). Each is a kill switch that must also stop work already
  // queued — so we drain only the event types whose own feature is enabled.
  // Switching one off freezes its backlog (rows stay pending, resume when it is
  // switched back on) without silencing the other.
  const cfg = await getWabisWebhookConfig();
  const remarketingEnabled =
    (await getSetting(WABIS_REMARKETING_ENABLED_KEY).catch(() => null)) === "1";
  const events: string[] = [];
  // The study-abroad intro rides the same on/off switch as the assignment intro.
  if (cfg.enabled) events.push(LEAD_ASSIGNED_EVENT, STUDY_ABROAD_EVENT);
  // The assignment intro also drains once it's cloud-routed, independent of the
  // Wabis switch above — an admin winding Wabis down will turn `cfg.enabled`
  // off, and a backlog of cloud-routed retries must not freeze because of it.
  else if (await isLeadAssignedCloudEnabled()) events.push(LEAD_ASSIGNED_EVENT);
  if (remarketingEnabled) events.push(REMARKETING_TOUCH_EVENT);
  if (events.length === 0) return { attempted: 0, sent: 0, errored: 0, skipped: "automation disabled" };

  const due = await prisma.crmWebhookDelivery.findMany({
    where: {
      status: "pending",
      event: { in: events },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let sent = 0;
  let failed = 0;
  // Sequential on purpose: a webhook sink that is struggling should see one
  // request at a time, not a burst of the whole backlog.
  for (const row of due) {
    try {
      if (await attemptDelivery(row.id)) sent++;
    } catch (e) {
      // Isolate the row. The drain is oldest-first, so letting one bad row throw
      // would re-select it at the head of every future tick and starve the whole
      // queue behind it.
      failed++;
      console.error(`[crm-webhook] delivery ${row.id} errored during drain:`, e);
    }
  }
  return { attempted: due.length, sent, errored: failed };
}

/**
 * Post a sample payload to the configured URL so an admin can verify the wiring
 * (and load Wabis's field mapping) without assigning a real lead. Logged like
 * any other delivery, with a unique dedupe key so tests never suppress or
 * collide with a real send.
 */
export async function sendTestWebhook(opts: {
  endpointId: string;
  phone: string;
}): Promise<{ ok: boolean; status: number | null; body: string; error?: string }> {
  const cfg = await getWabisWebhookConfig();
  const endpoint = await prisma.wabisWebhookEndpoint.findUnique({
    where: { id: opts.endpointId },
    select: endpointSelect,
  });
  if (!endpoint) return { ok: false, status: null, body: "", error: "That endpoint no longer exists." };
  const url = endpoint.webhookUrl;

  const payload = buildLeadAssignedPayload({
    leadId: "test-lead",
    candidateName: "Test Candidate",
    // The admin supplies the number: a test drives Wabis all the way through to
    // sending a real WhatsApp message, so a hard-coded placeholder would mean
    // messaging whoever happens to own it.
    phone: opts.phone,
    email: "test@example.com",
    source: "Test",
    service: "",
    status: "Not Yet Started",
    assignedAt: new Date(),
    // The endpoint's own agent name, so the test exercises the real routing
    // rather than a placeholder that matches no Wabis agent.
    agent: endpoint.agentName?.trim() || "Test Agent",
    agentPhone: endpoint.agentPhone?.trim() || "+910000000000",
  });
  if (!payload) {
    return { ok: false, status: null, body: "", error: "Enter a valid mobile number to send the test to." };
  }

  const result = await postWebhook(url, payload, cfg.secret);
  await prisma.crmWebhookDelivery
    .create({
      data: {
        event: TEST_EVENT,
        // Unique per test send — a test must never occupy a real lead's key.
        dedupeKey: `${TEST_EVENT}:${randomUUID()}`,
        url,
        endpointLabel: endpoint.label,
        payload,
        status: result.ok ? "sent" : "failed",
        attempts: 1,
        maxAttempts: 1,
        lastAttemptAt: new Date(),
        deliveredAt: result.ok ? new Date() : null,
        responseStatus: result.status,
        responseBody: result.body,
      },
    })
    .catch(() => undefined);

  return result;
}

/**
 * Reset a delivery and try again — the "re-fire" escape hatch for a send that
 * failed for an external reason (Wabis down, template not yet approved). The
 * dedupe key is kept, so re-firing is still bounded to one live delivery per
 * lead+consultant.
 *
 * The destination and agent identity are refreshed by `attemptDelivery` on every
 * attempt, so a retry automatically follows the consultant's current workflow
 * rather than the one that just failed.
 *
 * Refuses rows with no payload (the leads that had no usable phone) — re-posting
 * an empty body would register a broken subscriber in Wabis. There, fix the
 * lead's number and reassign; the skipped row doesn't block that.
 *
 * Also refuses once the lead has moved on. The payload is frozen at enqueue
 * time, so retrying a row whose lead now belongs to someone else would route the
 * subscriber to the old consultant and introduce them as the candidate's
 * contact — worse than not sending at all.
 */
export async function requeueDelivery(
  id: string,
): Promise<{ requeued: boolean; delivered: boolean; reason?: string }> {
  const refuse = (reason: string) => ({ requeued: false, delivered: false, reason });

  const row = await prisma.crmWebhookDelivery.findUnique({ where: { id } });
  if (!row) return refuse("That delivery no longer exists.");
  const payload = row.payload as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object" || !payload.phone) {
    return refuse("This lead had no usable phone number — fix the number on the lead and reassign it.");
  }

  // Only the consultant-routed events resolve a per-consultant endpoint; a
  // re-marketing touch carries an assigneeUserId too but sends on a global URL,
  // so it must not be judged against the (non-existent) per-consultant workflow.
  // A cloud-routed assignment intro has no Wabis endpoint by design — judging it
  // against one would refuse every retry with a "no workflow mapped" reason that
  // has nothing to do with why it actually failed.
  const cloudRouted = row.event === LEAD_ASSIGNED_EVENT && (await isLeadAssignedCloudEnabled());
  if (
    !cloudRouted &&
    CONSULTANT_ROUTED_EVENTS.has(row.event) &&
    row.assigneeUserId &&
    !(await resolveEndpointForConsultant(row.assigneeUserId, row.event))
  ) {
    return refuse("No Wabis workflow is mapped to this consultant, and there is no default endpoint.");
  }

  if (row.leadId && row.assigneeUserId) {
    const lead = await prisma.lead.findUnique({
      where: { id: row.leadId },
      select: { assignedToId: true },
    });
    if (!lead) return refuse("That lead no longer exists.");
    if (lead.assignedToId !== row.assigneeUserId) {
      return refuse("This lead has since been reassigned — re-sending would name the previous consultant.");
    }
  }

  await prisma.crmWebhookDelivery.update({
    where: { id },
    data: {
      status: "pending",
      attempts: 0,
      maxAttempts: Math.max(1, row.maxAttempts),
      nextAttemptAt: null,
      responseStatus: null,
      responseBody: null,
    },
  });
  // A failed attempt here isn't a refusal — the row is queued either way, and
  // the cron drain will keep trying.
  return { requeued: true, delivered: await attemptDelivery(id) };
}
