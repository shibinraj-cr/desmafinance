/**
 * WhatsApp Reply Tracker — the queries. The rules live in ./reply-tracker.
 *
 * Two independent reads:
 *
 *   1. WAITING NOW — every open thread the inbox would show under
 *      **Needs reply** (`awaitingReply`), with when the wait started.
 *   2. THE PERIOD — every exchange a candidate started inside the chosen days,
 *      and whether/when a person answered it.
 *
 * Only threads with an inbound message in the period are read, so the bulk of
 * one-way automated traffic never loads. Within those threads every message is
 * read: automated sends do not answer anything, but they mark an unanswered
 * exchange as "bot replied" (see ./reply-state).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { waMessageText } from "./message-label";
import {
  DAY_MS,
  exchangeState,
  pairExchanges,
  waitingSince,
  type BotRow,
  type ExchangeRow,
  type ReplyTrackerData,
  type ThreadInfo,
  type TrackerMessage,
  type TrackerRangeKey,
  type WaitingRow,
} from "./reply-tracker";

/** Threads waiting right now. The worst day on record is far below this. */
const MAX_WAITING = 3_000;
/** Threads with an inbound message in the period. */
const MAX_THREADS = 8_000;
/** Inbound + human-reply messages across those threads. */
const MAX_MESSAGES = 80_000;
/**
 * How far before the period to read, so an exchange that began just before it
 * is recognised as already running rather than counted as new.
 */
const LOOKBACK_MS = 3 * DAY_MS;
/** How far back to look for the start of a current wait. Older waits show from their earliest message in range. */
const WAIT_LOOKBACK_MS = 30 * DAY_MS;
const CHUNK = 5_000;
const TEXT_LIMIT = 160;

function clip(text: string | null): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > TEXT_LIMIT ? `${t.slice(0, TEXT_LIMIT - 1)}…` : t;
}

function chunks<T>(xs: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

const PAIRING_SELECT = { conversationId: true, direction: true, occurredAt: true, sentById: true } as const;

async function pairingMessages(conversationIds: string[], since: Date): Promise<{ byThread: Map<string, TrackerMessage[]>; truncated: boolean }> {
  const byThread = new Map<string, TrackerMessage[]>();
  let loaded = 0;
  let truncated = false;
  for (const ids of chunks(conversationIds)) {
    if (loaded >= MAX_MESSAGES) {
      truncated = true;
      break;
    }
    const rows = await prisma.waMessage.findMany({
      where: { conversationId: { in: ids }, occurredAt: { gte: since } },
      orderBy: [{ conversationId: "asc" }, { occurredAt: "asc" }],
      take: MAX_MESSAGES - loaded,
      select: PAIRING_SELECT,
    });
    loaded += rows.length;
    if (loaded >= MAX_MESSAGES) truncated = true;
    for (const m of rows) {
      const list = byThread.get(m.conversationId) ?? [];
      list.push({ direction: m.direction, occurredAt: m.occurredAt.getTime(), sentById: m.sentById });
      byThread.set(m.conversationId, list);
    }
  }
  return { byThread, truncated };
}

type OpenThread = WaitingRow & { autoAt: number | null; autoTemplate: string | null; lastMessageAt: number | null };

/**
 * Open threads carrying one of the two reply-state flags (see ./reply-state),
 * with when the unanswered exchange began and, for bot-replied ones, the
 * automated message that followed it.
 */
async function loadOpenThreads(
  flag: "awaitingReply" | "autoReplied",
  visibility: Prisma.WaConversationWhereInput,
  nowMs: number,
): Promise<{ rows: OpenThread[]; truncated: boolean }> {
  const convs = await prisma.waConversation.findMany({
    where: { AND: [{ [flag]: true }, { status: { not: "closed" } }, ...nonEmpty(visibility)] },
    orderBy: [{ lastInboundAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    take: MAX_WAITING,
    select: {
      id: true,
      phoneE164: true,
      assignedToId: true,
      lastInboundAt: true,
      lastMessageAt: true,
      sourceCampaign: true,
      lead: { select: { id: true, candidateName: true, status: { select: { label: true } } } },
      messages: {
        orderBy: { occurredAt: "desc" },
        // Enough to reach their last message past a couple of bot sends.
        take: 5,
        select: { body: true, type: true, unsupportedType: true, direction: true, mediaId: true, templateName: true, sentById: true },
      },
    },
  });
  let truncated = convs.length >= MAX_WAITING;

  const msgs = await pairingMessages(
    convs.map((c) => c.id),
    new Date(nowMs - WAIT_LOOKBACK_MS),
  );
  if (msgs.truncated) truncated = true;

  const rows: OpenThread[] = [];
  for (const c of convs) {
    const lastInboundAt = c.lastInboundAt?.getTime() ?? null;
    if (lastInboundAt === null) continue;
    const w = waitingSince(msgs.byThread.get(c.id) ?? []);
    const newestIn = c.messages.find((m) => m.direction === "in");
    const newestAuto = c.messages.find((m) => m.direction === "out" && !m.sentById);
    rows.push({
      conversationId: c.id,
      phoneE164: c.phoneE164,
      leadId: c.lead?.id ?? null,
      candidateName: c.lead?.candidateName ?? null,
      stage: c.lead?.status?.label ?? null,
      ownerId: c.assignedToId,
      // The flag says waiting; the messages say since when. If the pairing
      // disagrees (a reply sent outside the CRM, history before the window),
      // the flag wins and the wait is dated from the latest message.
      since: w?.since ?? lastInboundAt,
      lastInboundAt,
      inboundCount: w?.inboundCount ?? 1,
      preview: newestIn ? clip(waMessageText({ ...newestIn, hasMedia: !!newestIn.mediaId })) : null,
      sourceCampaign: c.sourceCampaign,
      autoAt: w?.autoAt ?? null,
      autoTemplate: newestAuto ? (newestAuto.templateName?.split(":")[0] ?? newestAuto.type) : null,
      lastMessageAt: c.lastMessageAt?.getTime() ?? null,
    });
  }
  return { rows, truncated };
}

function nonEmpty(where: Prisma.WaConversationWhereInput): Prisma.WaConversationWhereInput[] {
  return Object.keys(where).length ? [where] : [];
}

export async function loadReplyTracker(input: {
  range: { key: TrackerRangeKey; from: number; to: number };
  /** conversationVisibilityWhere for the viewer — {} for oversight roles. */
  visibility: Prisma.WaConversationWhereInput;
  now?: Date;
}): Promise<ReplyTrackerData> {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const { range, visibility } = input;
  let truncated = false;

  // ---- 1. Waiting now, and bot-replied -----------------------------------
  const [waitingRaw, botRaw] = await Promise.all([
    loadOpenThreads("awaitingReply", visibility, nowMs),
    loadOpenThreads("autoReplied", visibility, nowMs),
  ]);
  if (waitingRaw.truncated || botRaw.truncated) truncated = true;
  const waiting: WaitingRow[] = waitingRaw.rows;
  const botReplied: BotRow[] = botRaw.rows.map((r) => ({
    ...r,
    // The flag says a bot spoke after them; the messages say when. Fall back to
    // the thread's clock if the message window does not reach that far.
    autoAt: r.autoAt ?? r.lastMessageAt ?? r.lastInboundAt,
    autoTemplate: r.autoTemplate,
  }));

  // ---- 2. The period -------------------------------------------------------
  const from = new Date(range.from);
  const to = new Date(range.to);
  const active = await prisma.waMessage.groupBy({
    by: ["conversationId"],
    where: { direction: "in", occurredAt: { gte: from, lt: to }, ...(Object.keys(visibility).length ? { conversation: visibility } : {}) },
    orderBy: { conversationId: "asc" },
    take: MAX_THREADS,
  });
  if (active.length >= MAX_THREADS) truncated = true;
  const activeIds = active.map((a) => a.conversationId);

  const [periodMsgs, convMeta] = await Promise.all([
    pairingMessages(activeIds, new Date(range.from - LOOKBACK_MS)),
    (async () => {
      const out: Array<{
        id: string;
        phoneE164: string;
        status: string;
        assignedToId: string | null;
        lead: { id: string; candidateName: string; status: { label: string } | null } | null;
      }> = [];
      for (const ids of chunks(activeIds)) {
        out.push(
          ...(await prisma.waConversation.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              phoneE164: true,
              status: true,
              assignedToId: true,
              lead: { select: { id: true, candidateName: true, status: { select: { label: true } } } },
            },
          })),
        );
      }
      return out;
    })(),
  ]);
  if (periodMsgs.truncated) truncated = true;

  const exchanges: ExchangeRow[] = [];
  const threads: Record<string, ThreadInfo> = {};
  for (const c of convMeta) {
    threads[c.id] = {
      phoneE164: c.phoneE164,
      leadId: c.lead?.id ?? null,
      candidateName: c.lead?.candidateName ?? null,
      stage: c.lead?.status?.label ?? null,
    };
    for (const ex of pairExchanges(periodMsgs.byThread.get(c.id) ?? [])) {
      if (ex.askedAt < range.from || ex.askedAt >= range.to) continue;
      exchanges.push({
        conversationId: c.id,
        ownerId: c.assignedToId,
        askedAt: ex.askedAt,
        answeredAt: ex.answeredAt,
        answeredById: ex.answeredById,
        inboundCount: ex.inboundCount,
        state: exchangeState(ex, c.status),
      });
    }
  }

  // ---- Names ---------------------------------------------------------------
  const userIds = new Set<string>();
  for (const w of [...waiting, ...botReplied]) if (w.ownerId) userIds.add(w.ownerId);
  for (const e of exchanges) {
    if (e.ownerId) userIds.add(e.ownerId);
    if (e.answeredById) userIds.add(e.answeredById);
  }
  const users = userIds.size
    ? await prisma.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, username: true, leadPulseRole: { select: { displayName: true } } },
      })
    : [];
  const people: Record<string, string> = {};
  for (const u of users) people[u.id] = u.leadPulseRole?.displayName ?? u.username;

  return {
    generatedAt: nowMs,
    range,
    waiting,
    botReplied,
    exchanges,
    threads,
    people,
    truncated,
  };
}
