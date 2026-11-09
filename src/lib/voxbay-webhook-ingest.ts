// Voxbay CDR webhook — the DB half. The route verifies and parses a delivery;
// this files the call: VoxbayCall row, lead link, Timeline entry, and the
// delivery's VoxbayWebhookEvent row, all in one transaction so an event marked
// 'processed' always means the call is on file. An incoming call from a number
// the CRM doesn't know creates its lead first (createVoxbayLead).
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { computeDedupeKey, normalizePhone } from "./crm";
import { getAssignableBdes, resolveDefaultStatus } from "./crm-leads";
import { assignLeadTo } from "./crm-assign";
import { MISSED_CALL_LABEL, resolveVoxbayAssignee } from "./crm-voxbay-reconcile";
import { pickThreadLead } from "./wa/thread-lead";
import { logger } from "./logger";
import {
  CALL_MATCH_TOLERANCE_MS,
  callRowToCdr,
  cdrToCallFields,
  indexExistingCalls,
  normalizeVoxbayOutcome,
  storedCallOutcome,
  voxbayCallActivity,
  type VoxbayCdr,
} from "./voxbay-webhook";

type Db = Prisma.TransactionClient | typeof prisma;

export type VoxbayEventFields = {
  eventId: string | null;
  eventType: string | null;
  attempt: number | null;
  isTest: boolean;
  signatureOk: boolean;
  callId: string | null;
  /** The parsed body; null when it wasn't JSON. */
  rawBody: unknown;
  status: "processed" | "duplicate" | "error" | "test";
  error?: string | null;
};

/**
 * Write a delivery's audit row. A verified delivery upserts on its event id, so
 * its retries share one row; an unverified one (`eventId` null) always appends.
 */
export async function recordVoxbayEvent(db: Db, e: VoxbayEventFields): Promise<void> {
  const data = {
    eventType: e.eventType,
    attempt: e.attempt,
    isTest: e.isTest,
    signatureOk: e.signatureOk,
    callId: e.callId,
    rawBody: e.rawBody == null ? Prisma.DbNull : (e.rawBody as Prisma.InputJsonValue),
    status: e.status,
    error: e.error ?? null,
  };
  if (!e.eventId) {
    await db.voxbayWebhookEvent.create({ data });
    return;
  }
  await db.voxbayWebhookEvent.upsert({
    where: { eventId: e.eventId },
    create: { eventId: e.eventId, ...data },
    update: data,
  });
}

/**
 * The DesGro user behind Voxbay's agent: by email (the login's, then the
 * employee record's), then by the employee's phone, then by name through the
 * same first-name → BDE rule the reconcile import uses. DesGro keeps no Voxbay
 * extension per user, so `agent_extension` is stored but can't be matched.
 * Each step resolves only when it lands on exactly one user.
 */
export async function resolveVoxbayAgentUserId(cdr: Pick<VoxbayCdr, "agentEmail" | "agentPhone" | "agentName">): Promise<string | null> {
  const email = cdr.agentEmail?.trim();
  if (email) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (user) return user.id;
    const emps = await prisma.employee.findMany({
      where: {
        userId: { not: null },
        OR: [{ officialEmail: { equals: email, mode: "insensitive" } }, { email: { equals: email, mode: "insensitive" } }],
      },
      select: { userId: true },
      take: 2,
    });
    if (emps.length === 1) return emps[0].userId;
  }

  const phone = normalizePhone(cdr.agentPhone);
  if (phone) {
    const emps = await prisma.employee.findMany({
      where: { userId: { not: null }, phone: { not: null } },
      select: { userId: true, phone: true },
    });
    const ids = [...new Set(emps.filter((e) => normalizePhone(e.phone) === phone).map((e) => e.userId))];
    if (ids.length === 1) return ids[0];
  }

  if (cdr.agentName) {
    const hit = resolveVoxbayAssignee([cdr.agentName], await getAssignableBdes());
    if (hit) return hit.userId;
  }
  return null;
}

/**
 * The lead a call on this number is filed under, chosen by the same rule as a
 * WhatsApp thread's (src/lib/wa/thread-lead.ts): a real lead over a flagged
 * duplicate, an owned one over an unowned one, then the oldest. Both phone
 * columns are matched.
 */
export async function findLeadForCall(phoneE164: string | null): Promise<string | null> {
  if (!phoneE164) return null;
  const leads = await prisma.lead.findMany({
    where: { OR: [{ phoneE164 }, { altPhoneE164: phoneE164 }] },
    select: { id: true, assignedToId: true, createdAt: true, status: { select: { code: true } } },
  });
  const picked = pickThreadLead(
    leads.map((l) => ({ id: l.id, assignedToId: l.assignedToId, statusCode: l.status?.code ?? null, createdAt: l.createdAt })),
  );
  return picked?.id ?? null;
}

/** The lead source Voxbay leads carry: the same row the reconcile import files under. */
export async function resolveVoxbaySourceId(): Promise<string> {
  const source = await prisma.leadPulseSource.upsert({
    where: { code: "voxbay" },
    create: { code: "voxbay", label: "Voxbay", displayOrder: 6, active: true },
    update: {},
    select: { id: true },
  });
  return source.id;
}

/**
 * Idempotency key for a lead created from a call. `Lead.externalKey` is unique,
 * so two deliveries racing on one new number create one lead between them, as
 * with WhatsApp's `wa:` leads.
 */
export function voxbayLeadExternalKey(phoneE164: string): string {
  return `voxbay:${phoneE164}`;
}

/**
 * Create the lead for a number that phoned in and isn't in the CRM: source
 * Voxbay, default stage, unassigned (assignVoxbayLead decides that), named by
 * the caller name Voxbay knows or else the number. Same campaign and extra
 * fields as the reconcile import's Voxbay leads.
 *
 * `createdAt` back-dates a lead made by the backfill to when the call arrived.
 * Returns null only when no default stage is configured.
 */
export async function createVoxbayLead(opts: {
  phoneE164: string;
  phone: string | null;
  name: string | null;
  handledBy: string;
  createdAt?: Date;
}): Promise<{ id: string; created: boolean } | null> {
  const [defStatus, sourceId] = await Promise.all([resolveDefaultStatus(), resolveVoxbaySourceId()]);
  if (!defStatus) return null;

  const externalKey = voxbayLeadExternalKey(opts.phoneE164);
  const createdAt = opts.createdAt ?? new Date();
  const inserted = await prisma.lead.createMany({
    data: [
      {
        candidateName: opts.name?.trim() || opts.phoneE164,
        phone: opts.phone ?? opts.phoneE164,
        phoneE164: opts.phoneE164,
        dedupeKey: computeDedupeKey(null, opts.phoneE164),
        externalKey,
        statusId: defStatus.id,
        sourceId,
        campaign: "Voxbay call",
        extra: { "Voxbay caller": opts.phone ?? opts.phoneE164, "Voxbay handled by": opts.handledBy },
        createdAt,
        lastActivityAt: createdAt,
      },
    ],
    skipDuplicates: true,
  });
  const lead = await prisma.lead.findUnique({ where: { externalKey }, select: { id: true } });
  if (!lead) return null;

  // Only the request that inserted writes the entry, so a lost race doesn't
  // put a second "Created from…" row on the Timeline.
  if (inserted.count > 0) {
    await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: "LEAD_CREATED",
        summary: "Created from an incoming Voxbay call",
        metadata: { channel: "voxbay", phoneE164: opts.phoneE164 },
        occurredAt: createdAt,
      },
    });
  }
  return { id: lead.id, created: inserted.count > 0 };
}

const ASSIGNMENT_TYPES = ["ASSIGNED", "REASSIGNED", "UNASSIGNED"];

/**
 * Give a Voxbay-created lead to the BDE who answered a call from its number,
 * through the CRM's own assignment, so it gets what every assignment gets: the
 * quality-rating due date, the notification, the WhatsApp intro (when the
 * BDE's roster switch allows) and the thread owner.
 *
 * Only while the lead has never been assigned: a lead that came from a missed
 * call goes to whoever answers that number next, but once anyone has assigned
 * or unassigned it, the call never overrides them. Only an active L1/L2 BDE
 * qualifies; for anyone else the lead waits for the marketing manager. Checked
 * against the lead rather than "did this request create it", so a Voxbay retry
 * after a failed write still assigns.
 *
 * Best-effort: the call is already filed, so a failure is logged, not thrown.
 */
export async function assignVoxbayLead(leadId: string, agentUserId: string): Promise<boolean> {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { assignedToId: true, externalKey: true } });
    if (!lead || lead.assignedToId || !lead.externalKey?.startsWith("voxbay:")) return false;
    const [everAssigned, roster] = await Promise.all([
      prisma.leadActivity.count({ where: { leadId, type: { in: ASSIGNMENT_TYPES } } }),
      getAssignableBdes(),
    ]);
    if (everAssigned || !roster.some((r) => r.userId === agentUserId)) return false;
    await assignLeadTo(leadId, agentUserId, agentUserId);
    return true;
  } catch (e) {
    logger.warn("voxbay_lead_assign_failed", { leadId, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

const STORED_CALL_SELECT = {
  id: true,
  voxbayCallId: true,
  direction: true,
  sourceNumber: true,
  contactName: true,
  callStatus: true,
  didNumber: true,
  totalDurationSec: true,
  answeredDurationSec: true,
  callRecordFile: true,
  callStartTime: true,
  callConnectedTime: true,
  callEndTime: true,
  agentName: true,
  agentEmail: true,
  extNumber: true,
  agentPhone: true,
  deptName: true,
  userStatus: true,
  agentUserId: true,
  phoneE164: true,
  createdAt: true,
} satisfies Prisma.VoxbayCallSelect;
type StoredCall = Prisma.VoxbayCallGetPayload<{ select: typeof STORED_CALL_SELECT }>;

/**
 * File a number's earlier unlinked webhook calls under its lead, each with its
 * Timeline entry — the calls that came in before the number had a lead.
 */
async function linkUnmatchedCalls(db: Db, leadId: string, phoneE164: string, exceptId?: string): Promise<number> {
  const rows = await db.voxbayCall.findMany({
    where: { phoneE164, leadId: null, leadUnmatched: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: STORED_CALL_SELECT,
  });
  if (!rows.length) return 0;
  await db.voxbayCall.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { leadId, leadUnmatched: false },
  });
  await db.leadActivity.createMany({
    data: rows.map((r) => {
      const { summary, metadata } = voxbayCallActivity(callRowToCdr(r), r.agentUserId, storedCallOutcome(r));
      return { leadId, actorId: r.agentUserId, type: "VOXBAY_CALL", summary, metadata, occurredAt: r.callStartTime ?? r.createdAt };
    }),
  });
  return rows.length;
}

export type IngestResult = {
  status: "processed" | "duplicate";
  callRowId: string;
  leadId: string | null;
  leadCreated: boolean;
};

/**
 * File one verified CDR.
 *
 * The call row is found by Voxbay call id, else by the report's signature, else
 * by number + start time (see indexExistingCalls), so neither a retry nor a
 * report upload of the same call adds a second row:
 *   - a row the webhook made is overwritten with the latest delivery;
 *   - a row a report upload made keeps the report's own columns (its user_status
 *     is Voxbay's authoritative answer) and gains only what the report lacks:
 *     call id, direction, end time, recording, agent and lead.
 *
 * An INCOMING call from a number no lead has creates one (createVoxbayLead),
 * assigned to the BDE who answered (assignVoxbayLead); a missed call's lead is
 * left unassigned. An outgoing call to an unknown number creates nothing — we
 * dialled them, they didn't enquire — and stays flagged `leadUnmatched` until
 * the number gets a lead, when it's filed under it with the number's other
 * earlier calls.
 *
 * A lead link, once made, is kept, so a call never hops between two leads. The
 * Timeline entry is written when the call first links to a lead and refreshed
 * on later deliveries. It does NOT bump `lastActivityAt` and is not a work
 * type (src/lib/crm-team.ts), so it moves no SLA clock, score or report: the
 * BDE still logs the call's outcome with Log call.
 *
 * Throws on any DB failure; the route answers 500 and Voxbay retries.
 */
export async function ingestVoxbayCdr(
  cdr: VoxbayCdr,
  event: Omit<VoxbayEventFields, "status" | "error" | "callId" | "isTest" | "signatureOk">,
): Promise<IngestResult> {
  const fields = cdrToCallFields(cdr);
  // Reads that don't need the transaction's snapshot — kept out of it so the
  // transaction stays short.
  const [agentUserId, foundLeadId] = await Promise.all([resolveVoxbayAgentUserId(cdr), findLeadForCall(fields.phoneE164)]);
  const answered = normalizeVoxbayOutcome(cdr) === "answered";

  // Created before the transaction and idempotent on the number, so a retry
  // after a failed transaction finds this lead instead of making another.
  let matchedLeadId = foundLeadId;
  let leadCreated = false;
  if (!matchedLeadId && cdr.direction === "incoming" && fields.phoneE164) {
    const lead = await createVoxbayLead({
      phoneE164: fields.phoneE164,
      phone: cdr.phone,
      name: cdr.name,
      handledBy: answered && cdr.agentName ? cdr.agentName : MISSED_CALL_LABEL,
    });
    matchedLeadId = lead?.id ?? null;
    leadCreated = !!lead?.created;
  }

  const run = () =>
    prisma.$transaction(async (tx) => {
      const near = fields.callStartTime
        ? {
            gte: new Date(fields.callStartTime.getTime() - CALL_MATCH_TOLERANCE_MS),
            lte: new Date(fields.callStartTime.getTime() + CALL_MATCH_TOLERANCE_MS),
          }
        : null;
      const candidates = await tx.voxbayCall.findMany({
        where: {
          OR: [
            { voxbayCallId: fields.voxbayCallId },
            ...(fields.signature ? [{ signature: fields.signature }] : []),
            ...(fields.phoneE164 && near ? [{ source: "upload", phoneE164: fields.phoneE164, callStartTime: near }] : []),
          ],
        },
        select: {
          id: true,
          voxbayCallId: true,
          signature: true,
          phoneE164: true,
          callStartTime: true,
          source: true,
          direction: true,
          leadId: true,
        },
      });
      // Another webhook call is only ever the same call by its id: a transfer
      // can produce two CDRs for one number in the same second. The looser
      // keys are for finding a report row, which may lack the id.
      const existing =
        candidates.find((c) => c.voxbayCallId === fields.voxbayCallId) ??
        indexExistingCalls(candidates.filter((c) => c.source === "upload" && c.direction === fields.direction))({
          ...fields,
          voxbayCallId: null,
        });
      // `signature` is unique; when another row already holds it, this one goes
      // without rather than failing every retry on the constraint.
      const signatureFree = !candidates.some((c) => c.signature === fields.signature && c.id !== existing?.id);

      const leadId = existing?.leadId ?? matchedLeadId;
      const link = { leadId, leadUnmatched: !leadId, agentUserId };

      let rowId: string;
      if (!existing) {
        const row = await tx.voxbayCall.create({
          data: { ...fields, signature: signatureFree ? fields.signature : null, ...link, source: "webhook" },
          select: { id: true },
        });
        rowId = row.id;
      } else if (existing.source === "webhook") {
        // A later delivery for the same call (e.g. the recording became ready):
        // it's the newer word on everything.
        const { signature, ...rest } = fields;
        await tx.voxbayCall.update({
          where: { id: existing.id },
          data: { ...rest, ...(existing.signature || !signatureFree ? {} : { signature }), ...link },
        });
        rowId = existing.id;
      } else {
        await tx.voxbayCall.update({
          where: { id: existing.id },
          data: {
            ...(existing.voxbayCallId ? {} : { voxbayCallId: fields.voxbayCallId }),
            ...(existing.phoneE164 ? {} : { phoneE164: fields.phoneE164 }),
            direction: fields.direction,
            callEndTime: fields.callEndTime,
            callRecordFile: fields.callRecordFile ?? undefined,
            agentEmail: fields.agentEmail,
            agentPhone: fields.agentPhone,
            ...link,
          },
        });
        rowId = existing.id;
      }

      if (leadId) {
        const { summary, metadata } = voxbayCallActivity(cdr, agentUserId);
        const refreshed = existing?.leadId
          ? await tx.leadActivity.updateMany({
              where: { leadId, type: "VOXBAY_CALL", metadata: { path: ["voxbayCallId"], equals: cdr.callId } },
              data: { summary, metadata, actorId: agentUserId },
            })
          : { count: 0 };
        if (refreshed.count === 0) {
          await tx.leadActivity.create({
            data: {
              leadId,
              actorId: agentUserId,
              type: "VOXBAY_CALL",
              summary,
              metadata,
              occurredAt: cdr.callStartTime ?? new Date(),
            },
          });
        }
        if (fields.phoneE164) await linkUnmatchedCalls(tx, leadId, fields.phoneE164, rowId);
      }

      const status = existing ? "duplicate" : "processed";
      await recordVoxbayEvent(tx, {
        ...event,
        isTest: false,
        signatureOk: true,
        callId: cdr.callId,
        status,
      });
      return { status, callRowId: rowId, leadId, leadCreated } as IngestResult;
    });

  let result: IngestResult;
  try {
    result = await run();
  } catch (e) {
    // Two deliveries of one call racing to create it: the loser's unique
    // violation means the row now exists, so one more pass updates it.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    result = await run();
  }
  if (answered && agentUserId && result.leadId) await assignVoxbayLead(result.leadId, agentUserId);
  return result;
}

export type VoxbayBackfillRow = {
  /** Last four digits only — the report is printed to a terminal. */
  phone: string;
  calls: number;
  action: "create" | "link";
  assignTo: string | null;
};

/**
 * One-off catch-up for calls filed before incoming calls created leads: every
 * number with unlinked webhook calls gets the lead a live call would now give
 * it — an existing lead if one has appeared since, else a new Voxbay lead
 * back-dated to its first call's arrival — and all its calls are filed under
 * it. A number with only OUTGOING calls and no lead is left alone, as live.
 * The new lead goes to the BDE who answered, when exactly one BDE did.
 *
 * Dry run unless `apply`. Run by prisma/backfill-voxbay-leads.ts.
 */
export async function backfillVoxbayLeads(apply: boolean): Promise<VoxbayBackfillRow[]> {
  const rows = await prisma.voxbayCall.findMany({
    where: { leadUnmatched: true, leadId: null, phoneE164: { not: null } },
    select: STORED_CALL_SELECT,
    orderBy: { createdAt: "asc" },
  });
  const byPhone = new Map<string, StoredCall[]>();
  for (const r of rows) byPhone.set(r.phoneE164!, [...(byPhone.get(r.phoneE164!) ?? []), r]);
  const roster = await getAssignableBdes();
  const nameOf = new Map(roster.map((r) => [r.userId, r.displayName]));

  const report: VoxbayBackfillRow[] = [];
  for (const [phoneE164, calls] of byPhone) {
    const existingLeadId = await findLeadForCall(phoneE164);
    const incoming = calls.filter((c) => c.direction === "incoming");
    if (!existingLeadId && !incoming.length) continue;

    const answeredBy = [
      ...new Set(
        incoming
          .filter((c) => storedCallOutcome(c) === "answered" && c.agentUserId && nameOf.has(c.agentUserId))
          .map((c) => c.agentUserId!),
      ),
    ];
    const assignee = !existingLeadId && answeredBy.length === 1 ? answeredBy[0] : null;
    report.push({
      phone: `…${phoneE164.slice(-4)}`,
      calls: calls.length,
      action: existingLeadId ? "link" : "create",
      assignTo: assignee ? (nameOf.get(assignee) ?? null) : null,
    });
    if (!apply) continue;

    const first = incoming[0];
    const leadId =
      existingLeadId ??
      (
        await createVoxbayLead({
          phoneE164,
          phone: first.sourceNumber,
          name: incoming.find((c) => c.contactName)?.contactName ?? null,
          handledBy: assignee ? (calls.find((c) => c.agentUserId === assignee)?.agentName ?? MISSED_CALL_LABEL) : MISSED_CALL_LABEL,
          createdAt: first.createdAt,
        })
      )?.id;
    if (!leadId) continue;
    await prisma.$transaction((tx) => linkUnmatchedCalls(tx, leadId, phoneE164));
    if (assignee) await assignVoxbayLead(leadId, assignee);
  }
  return report;
}
