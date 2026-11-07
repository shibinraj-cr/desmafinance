// Voxbay CDR webhook — the DB half. The route verifies and parses a delivery;
// this files the call: VoxbayCall row, lead link, Timeline entry, and the
// delivery's VoxbayWebhookEvent row, all in one transaction so an event marked
// 'processed' always means the call is on file.
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { normalizePhone } from "./crm";
import { getAssignableBdes } from "./crm-leads";
import { resolveVoxbayAssignee } from "./crm-voxbay-reconcile";
import { pickThreadLead } from "./wa/thread-lead";
import {
  CALL_MATCH_TOLERANCE_MS,
  cdrToCallFields,
  indexExistingCalls,
  normalizeVoxbayOutcome,
  voxbayCallSummary,
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

export type IngestResult = {
  status: "processed" | "duplicate";
  callRowId: string;
  leadId: string | null;
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
  const [agentUserId, matchedLeadId] = await Promise.all([resolveVoxbayAgentUserId(cdr), findLeadForCall(fields.phoneE164)]);

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
        const summary = voxbayCallSummary(cdr, !agentUserId);
        const metadata = {
          voxbayCallId: cdr.callId,
          direction: cdr.direction,
          outcome: normalizeVoxbayOutcome(cdr),
          callStatus: cdr.callStatus,
          durationSec: cdr.conversationDurationSec ?? 0,
          agentName: cdr.agentName,
          recordingUrl: cdr.recordingUrl,
        };
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
      }

      const status = existing ? "duplicate" : "processed";
      await recordVoxbayEvent(tx, {
        ...event,
        isTest: false,
        signatureOk: true,
        callId: cdr.callId,
        status,
      });
      return { status, callRowId: rowId, leadId } as IngestResult;
    });

  try {
    return await run();
  } catch (e) {
    // Two deliveries of one call racing to create it: the loser's unique
    // violation means the row now exists, so one more pass updates it.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return run();
    throw e;
  }
}
