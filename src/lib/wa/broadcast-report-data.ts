/**
 * Broadcast Report — the queries. The rules live in ./broadcast-report; this
 * file only gathers what they need, in a fixed number of queries however many
 * campaigns or recipients are in range.
 *
 * Only people who replied are loaded in detail. Everyone else is counted by the
 * database, grouped by campaign, current owner and delivery state, so a
 * 20,000-recipient month costs a few hundred rows, not 20,000.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { isOptOutMessage } from "./inbound";
import {
  MAX_REPLY_WINDOW_DAYS,
  attributeReply,
  deliveryOutcome,
  ownerChangeAfter,
  stageMoveAfter,
  type BroadcastReportData,
  type FunnelGroup,
  type LeadEvent,
  type ReplyRow,
  type ThreadEvent,
} from "./broadcast-report";

/** Campaigns per page — more than a year of sending at today's pace. */
const MAX_CAMPAIGNS = 300;
/** Recipients whose number has written in since their send. */
const MAX_REPLY_CANDIDATES = 20_000;
/** Messages across those threads. */
const MAX_MESSAGES = 60_000;
/** Kept short: the page shows a line, the thread has the rest. */
const TEXT_LIMIT = 200;

/** The lead-timeline events the report reads. */
const LEAD_EVENT_TYPES = ["STATUS_CHANGED", "ASSIGNED", "REASSIGNED", "UNASSIGNED", "CALL_LOGGED"];

function clip(text: string | null): string | null {
  if (!text) return null;
  const t = text.trim();
  return t.length > TEXT_LIMIT ? `${t.slice(0, TEXT_LIMIT - 1)}…` : t;
}

export async function loadBroadcastReport(opts: {
  /** Campaigns that started sending in [from, to). */
  from: Date;
  to: Date | null;
  /** Restrict to leads this user owns now; null = everyone. */
  ownerScope: string | null;
}): Promise<BroadcastReportData> {
  const empty: BroadcastReportData = {
    campaigns: [],
    groups: [],
    replies: [],
    people: {},
    generatedAt: Date.now(),
    truncated: false,
  };

  const campaignRows = await prisma.waBroadcast.findMany({
    where: { startedAt: { gte: opts.from, ...(opts.to ? { lt: opts.to } : {}) } },
    orderBy: { startedAt: "desc" },
    take: MAX_CAMPAIGNS,
    select: { id: true, name: true, templateName: true, status: true, startedAt: true },
  });
  if (campaignRows.length === 0) return empty;
  const campaignIds = campaignRows.map((c) => c.id);
  const ids = Prisma.join(campaignIds);
  const scope = opts.ownerScope ? Prisma.sql`AND l."assignedToId" = ${opts.ownerScope}` : Prisma.empty;

  // Everyone, counted. LEFT JOIN: a recipient whose lead was deleted still
  // counts as a send, with no owner.
  const grouped = await prisma.$queryRaw<
    Array<{ campaignId: string; ownerId: string | null; status: string; waStatus: string | null; n: number }>
  >(Prisma.sql`
    SELECT r."broadcastId" AS "campaignId", l."assignedToId" AS "ownerId", r.status, r."waStatus", COUNT(*)::int AS n
    FROM "WaBroadcastRecipient" r
    LEFT JOIN "Lead" l ON l.id = r."leadId"
    WHERE r."broadcastId" IN (${ids}) ${scope}
    GROUP BY 1, 2, 3, 4
  `);
  const groupMap = new Map<string, FunnelGroup>();
  for (const g of grouped) {
    const outcome = deliveryOutcome(g.status, g.waStatus);
    const key = `${g.campaignId}|${g.ownerId ?? ""}|${outcome}`;
    const row = groupMap.get(key) ?? { campaignId: g.campaignId, ownerId: g.ownerId, outcome, n: 0 };
    row.n += Number(g.n);
    groupMap.set(key, row);
  }
  const groups = [...groupMap.values()];

  // Reply candidates: a successful send whose number has messaged us since.
  // `lastInboundAt >= sentAt` is a cheap pre-filter on the thread row; the exact
  // attribution happens below, against the messages themselves.
  const candidates = await prisma.$queryRaw<
    Array<{
      id: string;
      campaignId: string;
      leadId: string | null;
      phoneE164: string;
      sentAt: Date;
      status: string;
      waStatus: string | null;
      conversationId: string;
    }>
  >(Prisma.sql`
    SELECT r.id, r."broadcastId" AS "campaignId", r."leadId", r."phoneE164", r."sentAt", r.status, r."waStatus",
           c.id AS "conversationId"
    FROM "WaBroadcastRecipient" r
    JOIN "WaConversation" c ON c."phoneE164" = r."phoneE164"
    LEFT JOIN "Lead" l ON l.id = r."leadId"
    WHERE r."broadcastId" IN (${ids})
      AND r.status = 'sent'
      AND r."sentAt" IS NOT NULL
      AND (r."waStatus" IS NULL OR r."waStatus" <> 'failed')
      AND c."lastInboundAt" >= r."sentAt"
      ${scope}
    ORDER BY r."sentAt" ASC
    LIMIT ${MAX_REPLY_CANDIDATES}
  `);

  const campaigns = campaignRows.map((c) => ({
    id: c.id,
    name: c.name,
    templateName: c.templateName,
    status: c.status,
    startedAt: (c.startedAt ?? new Date(0)).getTime(),
  }));

  const ownerIds = new Set<string>();
  for (const g of groups) if (g.ownerId) ownerIds.add(g.ownerId);

  if (candidates.length === 0) {
    return { ...empty, campaigns, groups, people: await peopleFor(ownerIds) };
  }

  const phones = [...new Set(candidates.map((c) => c.phoneE164))];
  const conversationIds = [...new Set(candidates.map((c) => c.conversationId))];
  const leadIds = [...new Set(candidates.map((c) => c.leadId).filter((x): x is string => !!x))];
  const minSent = new Date(Math.min(...candidates.map((c) => c.sentAt.getTime())));

  const [laterSends, messages, leads, leadEvents] = await Promise.all([
    // Every broadcast that reached these numbers, from ANY campaign — including
    // ones outside the range — so a reply is never credited to an older
    // campaign when a newer one is what they answered.
    prisma.waBroadcastRecipient.findMany({
      where: { phoneE164: { in: phones }, status: "sent", sentAt: { gte: minSent } },
      select: { phoneE164: true, sentAt: true, broadcastId: true },
    }),
    // Their messages, and ours that a PERSON sent. Automated sends (assignment
    // intro, drip, the campaign bubble the mirror injects) have no author.
    prisma.waMessage.findMany({
      where: {
        conversationId: { in: conversationIds },
        occurredAt: { gte: minSent },
        OR: [{ direction: "in" }, { direction: "out", sentById: { not: null } }],
      },
      orderBy: { occurredAt: "asc" },
      take: MAX_MESSAGES,
      select: { conversationId: true, direction: true, type: true, body: true, occurredAt: true, sentById: true },
    }),
    prisma.lead.findMany({
      where: { id: { in: leadIds } },
      select: { id: true, candidateName: true, assignedToId: true, status: { select: { label: true } } },
    }),
    prisma.leadActivity.findMany({
      where: { leadId: { in: leadIds }, type: { in: LEAD_EVENT_TYPES }, occurredAt: { gte: minSent } },
      orderBy: { occurredAt: "asc" },
      select: { leadId: true, type: true, summary: true, metadata: true, occurredAt: true, actorId: true },
    }),
  ]);

  const sendsByPhone = new Map<string, Array<{ at: number; campaignId: string }>>();
  for (const s of laterSends) {
    if (!s.sentAt) continue;
    const list = sendsByPhone.get(s.phoneE164) ?? [];
    list.push({ at: s.sentAt.getTime(), campaignId: s.broadcastId });
    sendsByPhone.set(s.phoneE164, list);
  }
  for (const list of sendsByPhone.values()) list.sort((a, b) => a.at - b.at);

  const threadEvents = new Map<string, ThreadEvent[]>();
  for (const m of messages) {
    const list = threadEvents.get(m.conversationId) ?? [];
    const at = m.occurredAt.getTime();
    if (m.direction === "in") list.push({ kind: "in", at, text: m.body ?? (m.type !== "text" ? `[${m.type}]` : null) });
    else if (m.sentById) list.push({ kind: "out", at, by: m.sentById });
    threadEvents.set(m.conversationId, list);
  }

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const eventsByLead = new Map<string, LeadEvent[]>();
  const callsByLead = new Map<string, ThreadEvent[]>();
  for (const e of leadEvents) {
    const at = e.occurredAt.getTime();
    if (e.type === "CALL_LOGGED") {
      if (!e.actorId) continue;
      const list = callsByLead.get(e.leadId) ?? [];
      list.push({ kind: "call", at, by: e.actorId });
      callsByLead.set(e.leadId, list);
      continue;
    }
    const list = eventsByLead.get(e.leadId) ?? [];
    list.push({ at, type: e.type, summary: e.summary, metadata: e.metadata, actorId: e.actorId });
    eventsByLead.set(e.leadId, list);
  }

  const replies: ReplyRow[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    // One row per campaign per number, even if two leads on the number were sent.
    const dedupe = `${c.campaignId}|${c.phoneE164}`;
    if (seen.has(dedupe)) continue;

    const sentAt = c.sentAt.getTime();
    const next = (sendsByPhone.get(c.phoneE164) ?? []).find((s) => s.at > sentAt && s.campaignId !== c.campaignId);
    const facts = attributeReply({
      sentAt,
      nextSendAt: next?.at ?? null,
      windowDays: MAX_REPLY_WINDOW_DAYS,
      events: [...(threadEvents.get(c.conversationId) ?? []), ...(c.leadId ? callsByLead.get(c.leadId) ?? [] : [])],
      isOptOut: isOptOutMessage,
    });
    if (!facts) continue;
    seen.add(dedupe);

    const lead = c.leadId ? leadById.get(c.leadId) : undefined;
    const events = c.leadId ? eventsByLead.get(c.leadId) ?? [] : [];
    const row: ReplyRow = {
      ...facts,
      firstText: clip(facts.firstText),
      lastText: clip(facts.lastText),
      id: c.id,
      campaignId: c.campaignId,
      leadId: c.leadId,
      conversationId: c.conversationId,
      candidateName: lead?.candidateName ?? "(lead removed)",
      phone: c.phoneE164,
      ownerId: lead?.assignedToId ?? null,
      stageNow: lead?.status?.label ?? null,
      delivery: deliveryOutcome(c.status, c.waStatus),
      sentAt,
      move: stageMoveAfter(events, facts.firstReplyAt),
      ownerChange: ownerChangeAfter(events, facts.firstReplyAt),
    };
    replies.push(row);
    if (row.ownerId) ownerIds.add(row.ownerId);
    if (row.firstResponseBy) ownerIds.add(row.firstResponseBy);
    if (row.ownerChange?.fromId) ownerIds.add(row.ownerChange.fromId);
    if (row.ownerChange?.toId) ownerIds.add(row.ownerChange.toId);
  }

  return {
    campaigns,
    groups,
    replies,
    people: await peopleFor(ownerIds),
    generatedAt: Date.now(),
    truncated:
      campaignRows.length === MAX_CAMPAIGNS ||
      candidates.length === MAX_REPLY_CANDIDATES ||
      messages.length === MAX_MESSAGES,
  };
}

/** Roster name when the person is on the sales roster, else their login. */
async function peopleFor(ids: Set<string>): Promise<Record<string, string>> {
  if (ids.size === 0) return {};
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, username: true, leadPulseRole: { select: { displayName: true } } },
  });
  return Object.fromEntries(users.map((u) => [u.id, u.leadPulseRole?.displayName || u.username]));
}
